import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { DollarSign, Search, Filter, Zap, RefreshCw, Mail } from 'lucide-react'
import { fetchBids, fetchProjects, updateBid } from '../lib/supabase'
import { format } from 'date-fns'

export default function Bids() {
  const [bids, setBids] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [resendingId, setResendingId] = useState(null)

  useEffect(() => {
    loadData()
  }, [statusFilter])

  async function loadData() {
    setLoading(true)
    try {
      const [bidsData, projectsData] = await Promise.all([
        fetchBids({ status: statusFilter !== 'all' ? statusFilter : undefined }),
        fetchProjects('bidding')
      ])
      setBids(bidsData || [])
      setProjects(projectsData || [])
    } catch (error) {
      console.error('Error loading bids:', error)
    } finally {
      setLoading(false)
    }
  }

  async function resendInvitation(bid) {
    if (!bid.subcontractor?.email) {
      alert('No email address found for this subcontractor')
      return
    }

    setResendingId(bid.id)
    try {
      const response = await fetch('/api/send-bid-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_email: bid.subcontractor.email,
          to_name: bid.subcontractor.contact_name || bid.subcontractor.company_name,
          subject: `Invitation to Bid: ${bid.bid_item?.project?.name}`,
          project_name: bid.bid_item?.project?.name,
          project_location: bid.bid_item?.project?.location,
          bid_due_date: bid.bid_item?.project?.bid_date,
          bid_items: [{
            trade: bid.bid_item?.trade?.name || 'General',
            description: bid.bid_item?.description || '',
            quantity: bid.bid_item?.quantity || '',
            unit: bid.bid_item?.unit || ''
          }],
          sender_company: 'Clipper Construction',
          project_id: bid.bid_item?.project?.id,
          subcontractor_id: bid.subcontractor.id,
          bid_item_ids: [bid.bid_item?.id].filter(Boolean)
        })
      })

      const result = await response.json()
      if (response.ok) {
        // Update the invitation_sent_at timestamp
        await updateBid(bid.id, {
          invitation_sent_at: new Date().toISOString()
        })
        alert('Invitation resent successfully!')
        loadData() // Refresh the list
      } else {
        alert(`Failed to send: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error resending invitation:', error)
      alert('Failed to resend invitation. Please try again.')
    } finally {
      setResendingId(null)
    }
  }

  const filteredBids = bids.filter(bid => {
    const matchesSearch =
      bid.subcontractor?.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bid.bid_item?.description?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesProject = projectFilter === 'all' ||
      bid.bid_item?.project?.id === projectFilter

    return matchesSearch && matchesProject
  })

  const statusColors = {
    invited: 'badge-warning',
    submitted: 'badge-primary',
    accepted: 'badge-success',
    rejected: 'badge-danger',
    withdrawn: 'bg-gray-100 text-gray-800'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bids</h1>
          <p className="text-gray-600">Track and manage subcontractor bids</p>
        </div>
        <Link to="/bids/quick-entry" className="btn btn-primary flex items-center gap-2 self-start">
          <Zap className="h-4 w-4" />
          Quick Entry
        </Link>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search bids..."
              className="input pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            className="input w-full md:w-44"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="invited">Invited</option>
            <option value="submitted">Submitted</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            className="input w-full md:w-56"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="all">All Projects</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bids Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : filteredBids.length > 0 ? (
        <div className="card table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Subcontractor</th>
                <th>Project</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBids.map(bid => (
                <tr key={bid.id}>
                  <td>
                    <Link
                      to={`/subcontractors/${bid.subcontractor?.id}`}
                      className="font-medium text-primary-600 hover:underline"
                    >
                      {bid.subcontractor?.company_name || 'Unknown'}
                    </Link>
                  </td>
                  <td>
                    <Link
                      to={`/projects/${bid.bid_item?.project?.id}`}
                      className="text-gray-900 hover:underline"
                    >
                      {bid.bid_item?.project?.name || 'Unknown'}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate text-gray-600">
                    {bid.bid_item?.description}
                  </td>
                  <td className="font-medium">
                    {bid.amount ? `$${Number(bid.amount).toLocaleString()}` : '-'}
                  </td>
                  <td>
                    <span className={`badge ${statusColors[bid.status] || 'bg-gray-100 text-gray-800'}`}>
                      {bid.status}
                    </span>
                  </td>
                  <td className="text-gray-600">
                    {bid.submitted_at
                      ? format(new Date(bid.submitted_at), 'MMM d')
                      : bid.invitation_sent_at
                      ? `Sent ${format(new Date(bid.invitation_sent_at), 'MMM d')}`
                      : '-'}
                  </td>
                  <td>
                    {bid.status === 'invited' && (
                      <button
                        onClick={() => resendInvitation(bid)}
                        disabled={resendingId === bid.id}
                        className="btn btn-sm bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center gap-1"
                        title="Resend invitation email"
                      >
                        {resendingId === bid.id ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Mail className="h-3 w-3" />
                        )}
                        {resendingId === bid.id ? 'Sending...' : 'Resend'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-12 text-center">
          <DollarSign className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No bids found</h3>
          <p className="text-gray-500 mb-4">
            {searchTerm ? 'Try adjusting your search' : 'Start by inviting subcontractors to bid on your projects'}
          </p>
          <Link to="/projects" className="btn btn-primary">
            View Projects
          </Link>
        </div>
      )}
    </div>
  )
}

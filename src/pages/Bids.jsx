import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { DollarSign, Search, Filter, Zap, RefreshCw, Mail, Trash2, CheckSquare, Square } from 'lucide-react'
import { fetchBids, fetchProjects, updateBid, deleteBids, fetchDrawingsForProject } from '../lib/supabase'
import { format } from 'date-fns'

export default function Bids() {
  const [bids, setBids] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [resendingId, setResendingId] = useState(null)
  const [selectedBids, setSelectedBids] = useState(new Set())
  const [deleting, setDeleting] = useState(false)

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
      setSelectedBids(new Set()) // Clear selection on reload
    } catch (error) {
      console.error('Error loading bids:', error)
    } finally {
      setLoading(false)
    }
  }

  // Group bids by subcontractor + project for combined resend
  function groupBidsForResend(bidIds) {
    const groups = {}
    for (const bidId of bidIds) {
      const bid = bids.find(b => b.id === bidId)
      if (!bid || bid.status !== 'invited') continue

      const key = `${bid.subcontractor?.id}-${bid.bid_item?.project?.id}`
      if (!groups[key]) {
        groups[key] = {
          subcontractor: bid.subcontractor,
          project: bid.bid_item?.project,
          bids: []
        }
      }
      groups[key].bids.push(bid)
    }
    return Object.values(groups)
  }

  async function resendInvitations(bidIds) {
    const groups = groupBidsForResend(bidIds)

    if (groups.length === 0) {
      alert('No invited bids selected to resend')
      return
    }

    setResendingId('bulk')
    let successCount = 0
    let errorCount = 0

    for (const group of groups) {
      if (!group.subcontractor?.email) {
        console.log(`Skipping ${group.subcontractor?.company_name} - no email`)
        errorCount++
        continue
      }

      try {
        // Fetch drawings for this project
        let drawingIds = []
        if (group.project?.id) {
          const drawings = await fetchDrawingsForProject(group.project.id)
          drawingIds = drawings?.map(d => d.id) || []
        }

        // Combine all bid items for this sub/project
        const bidItems = group.bids.map(bid => ({
          trade: bid.bid_item?.trade?.name || 'General',
          description: bid.bid_item?.description || '',
          quantity: bid.bid_item?.quantity || '',
          unit: bid.bid_item?.unit || ''
        }))

        const response = await fetch('/api/send-bid-invitation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to_email: group.subcontractor.email,
            to_name: group.subcontractor.contact_name || group.subcontractor.company_name,
            subject: `Invitation to Bid: ${group.project?.name}`,
            project_name: group.project?.name,
            project_location: group.project?.location,
            bid_due_date: group.project?.bid_date,
            bid_items: bidItems,
            sender_company: 'Clipper Construction',
            project_id: group.project?.id,
            subcontractor_id: group.subcontractor.id,
            bid_item_ids: group.bids.map(b => b.bid_item?.id).filter(Boolean),
            drawing_ids: drawingIds,
            include_drawing_links: true
          })
        })

        const result = await response.json()
        if (response.ok) {
          // Update invitation_sent_at for all bids in this group
          for (const bid of group.bids) {
            await updateBid(bid.id, {
              invitation_sent_at: new Date().toISOString()
            })
          }
          successCount++
        } else {
          console.error(`Failed to send to ${group.subcontractor.email}:`, result.error)
          errorCount++
        }
      } catch (error) {
        console.error('Error resending invitation:', error)
        errorCount++
      }
    }

    setResendingId(null)

    if (successCount > 0 && errorCount === 0) {
      alert(`Successfully sent ${successCount} invitation(s) with all trades and drawings!`)
    } else if (successCount > 0) {
      alert(`Sent ${successCount} invitation(s), ${errorCount} failed`)
    } else {
      alert('Failed to send invitations. Please try again.')
    }

    loadData()
  }

  async function deleteSelectedBids() {
    if (selectedBids.size === 0) return

    if (!confirm(`Are you sure you want to delete ${selectedBids.size} bid invitation(s)? This cannot be undone.`)) {
      return
    }

    setDeleting(true)
    try {
      await deleteBids(Array.from(selectedBids))
      alert(`Deleted ${selectedBids.size} bid(s)`)
      loadData()
    } catch (error) {
      console.error('Error deleting bids:', error)
      alert('Failed to delete bids. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  function toggleSelectBid(bidId) {
    const newSelected = new Set(selectedBids)
    if (newSelected.has(bidId)) {
      newSelected.delete(bidId)
    } else {
      newSelected.add(bidId)
    }
    setSelectedBids(newSelected)
  }

  function toggleSelectAll() {
    if (selectedBids.size === filteredBids.length) {
      setSelectedBids(new Set())
    } else {
      setSelectedBids(new Set(filteredBids.map(b => b.id)))
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

  // Count selected invited bids for resend button
  const selectedInvitedCount = Array.from(selectedBids).filter(id => {
    const bid = bids.find(b => b.id === id)
    return bid?.status === 'invited'
  }).length

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

      {/* Bulk Actions */}
      {selectedBids.size > 0 && (
        <div className="card p-4 bg-blue-50 border-blue-200">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-blue-800 font-medium">
              {selectedBids.size} bid(s) selected
            </span>
            <div className="flex gap-2">
              {selectedInvitedCount > 0 && (
                <button
                  onClick={() => resendInvitations(Array.from(selectedBids))}
                  disabled={resendingId === 'bulk'}
                  className="btn btn-sm bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1"
                >
                  {resendingId === 'bulk' ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  {resendingId === 'bulk' ? 'Sending...' : `Resend ${selectedInvitedCount} Invitation(s)`}
                </button>
              )}
              <button
                onClick={deleteSelectedBids}
                disabled={deleting}
                className="btn btn-sm bg-red-600 text-white hover:bg-red-700 flex items-center gap-1"
              >
                {deleting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {deleting ? 'Deleting...' : 'Delete Selected'}
              </button>
              <button
                onClick={() => setSelectedBids(new Set())}
                className="btn btn-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Clear Selection
              </button>
            </div>
          </div>
        </div>
      )}

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
                <th className="w-10">
                  <button
                    onClick={toggleSelectAll}
                    className="p-1 hover:bg-gray-100 rounded"
                    title={selectedBids.size === filteredBids.length ? "Deselect all" : "Select all"}
                  >
                    {selectedBids.size === filteredBids.length && filteredBids.length > 0 ? (
                      <CheckSquare className="h-5 w-5 text-blue-600" />
                    ) : (
                      <Square className="h-5 w-5 text-gray-400" />
                    )}
                  </button>
                </th>
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
                <tr key={bid.id} className={selectedBids.has(bid.id) ? 'bg-blue-50' : ''}>
                  <td>
                    <button
                      onClick={() => toggleSelectBid(bid.id)}
                      className="p-1 hover:bg-gray-100 rounded"
                    >
                      {selectedBids.has(bid.id) ? (
                        <CheckSquare className="h-5 w-5 text-blue-600" />
                      ) : (
                        <Square className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                  </td>
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
                        onClick={() => resendInvitations([bid.id])}
                        disabled={resendingId !== null}
                        className="btn btn-sm bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center gap-1"
                        title="Resend invitation email with all trades and drawings"
                      >
                        {resendingId === 'bulk' ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Mail className="h-3 w-3" />
                        )}
                        Resend
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

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Edit, Plus, FileText, Users, DollarSign,
  Calendar, MapPin, Building2, Download, ChevronDown, ChevronRight, Trash2,
  Search, Mail, Check, X
} from 'lucide-react'
import { fetchProject, fetchTrades, createBidItem, fetchSubcontractors, createBid } from '../lib/supabase'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export default function ProjectDetail() {
  const { id } = useParams()
  const [project, setProject] = useState(null)
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedTrades, setExpandedTrades] = useState({})
  const [showAddItem, setShowAddItem] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [subcontractors, setSubcontractors] = useState([])

  useEffect(() => {
    loadProject()
    loadTrades()
  }, [id])

  async function loadProject() {
    try {
      const data = await fetchProject(id)
      setProject(data)

      // Auto-expand trades with bid items
      const expanded = {}
      data?.bid_items?.forEach(item => {
        if (item.trade) {
          expanded[item.trade.id] = true
        }
      })
      setExpandedTrades(expanded)
    } catch (error) {
      console.error('Error loading project:', error)
      toast.error('Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  async function loadTrades() {
    try {
      const data = await fetchTrades()
      setTrades(data || [])
    } catch (error) {
      console.error('Error loading trades:', error)
    }
  }

  async function loadSubcontractors() {
    try {
      const data = await fetchSubcontractors()
      setSubcontractors(data || [])
    } catch (error) {
      console.error('Error loading subcontractors:', error)
    }
  }

  function toggleTrade(tradeId) {
    setExpandedTrades(prev => ({
      ...prev,
      [tradeId]: !prev[tradeId]
    }))
  }

  // Group bid items by trade
  const bidItemsByTrade = project?.bid_items?.reduce((acc, item) => {
    const tradeId = item.trade?.id
    if (!acc[tradeId]) {
      acc[tradeId] = {
        trade: item.trade,
        items: []
      }
    }
    acc[tradeId].items.push(item)
    return acc
  }, {}) || {}

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Project not found</h2>
        <Link to="/projects" className="text-primary-600 hover:underline mt-2 inline-block">
          Back to projects
        </Link>
      </div>
    )
  }

  const statusColors = {
    bidding: 'badge-primary',
    awarded: 'badge-success',
    in_progress: 'bg-purple-100 text-purple-800',
    completed: 'bg-gray-100 text-gray-800',
    lost: 'badge-danger'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            to="/projects"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Projects
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            <span className={`badge ${statusColors[project.status] || 'bg-gray-100 text-gray-800'}`}>
              {project.status.replace('_', ' ')}
            </span>
          </div>
          {project.project_number && (
            <p className="text-gray-600">#{project.project_number}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </button>
          <button className="btn btn-outline flex items-center gap-2">
            <Edit className="h-4 w-4" />
            Edit
          </button>
        </div>
      </div>

      {/* Project Info Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {project.location && (
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Location</p>
                <p className="font-medium text-gray-900">{project.location}</p>
              </div>
            </div>
          </div>
        )}

        {project.bid_date && (
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Bid Date</p>
                <p className="font-medium text-gray-900">
                  {format(new Date(project.bid_date), 'MMM d, yyyy')}
                </p>
              </div>
            </div>
          </div>
        )}

        {project.client_name && (
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Client</p>
                <p className="font-medium text-gray-900">{project.client_name}</p>
              </div>
            </div>
          </div>
        )}

        {project.estimated_value && (
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Estimated Value</p>
                <p className="font-medium text-gray-900">
                  ${Number(project.estimated_value).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Description */}
      {project.description && (
        <div className="card p-4">
          <h3 className="font-semibold text-gray-900 mb-2">Description</h3>
          <p className="text-gray-600 whitespace-pre-wrap">{project.description}</p>
        </div>
      )}

      {/* Bid Items by Trade */}
      <div className="card">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Bid Items by Trade</h2>
          <div className="flex gap-2">
            <button
              onClick={() => {
                loadSubcontractors()
                setShowInviteModal(true)
              }}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Users className="h-4 w-4" />
              Invite Subs
            </button>
            <button
              onClick={() => setShowAddItem(true)}
              className="btn btn-primary flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Bid Item
            </button>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {Object.keys(bidItemsByTrade).length > 0 ? (
            Object.values(bidItemsByTrade).map(({ trade, items }) => (
              <div key={trade.id}>
                <button
                  onClick={() => toggleTrade(trade.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {expandedTrades[trade.id] ? (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="font-medium text-gray-900">
                      Div {trade.division_code}: {trade.name}
                    </span>
                    <span className="badge bg-gray-100 text-gray-600">
                      {items.length} item{items.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </button>

                {expandedTrades[trade.id] && (
                  <div className="bg-gray-50 border-t border-gray-100">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Description</th>
                          <th>Est. Cost</th>
                          <th>Bids</th>
                          <th>Lowest</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(item => {
                          const submittedBids = item.bids?.filter(b => b.status === 'submitted') || []
                          const lowestBid = submittedBids.length > 0
                            ? Math.min(...submittedBids.map(b => Number(b.amount) || Infinity))
                            : null

                          return (
                            <tr key={item.id}>
                              <td className="font-medium">{item.item_number || '-'}</td>
                              <td className="max-w-xs truncate">{item.description}</td>
                              <td>
                                {item.estimated_cost
                                  ? `$${Number(item.estimated_cost).toLocaleString()}`
                                  : '-'}
                              </td>
                              <td>{submittedBids.length}</td>
                              <td className="text-green-600 font-medium">
                                {lowestBid && lowestBid !== Infinity
                                  ? `$${lowestBid.toLocaleString()}`
                                  : '-'}
                              </td>
                              <td>
                                <span className={`badge ${
                                  item.status === 'open' ? 'badge-primary' :
                                  item.status === 'awarded' ? 'badge-success' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {item.status}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-gray-500">
              <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="mb-2">No bid items yet</p>
              <button
                onClick={() => setShowAddItem(true)}
                className="text-primary-600 hover:underline"
              >
                Add your first bid item
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add Bid Item Modal */}
      {showAddItem && (
        <AddBidItemModal
          projectId={id}
          trades={trades}
          bidDate={project.bid_date}
          onClose={() => setShowAddItem(false)}
          onSuccess={() => {
            setShowAddItem(false)
            loadProject()
          }}
        />
      )}

      {/* Invite Subcontractors Modal */}
      {showInviteModal && (
        <InviteSubsModal
          projectId={id}
          project={project}
          bidItems={project.bid_items || []}
          subcontractors={subcontractors}
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => {
            setShowInviteModal(false)
            loadProject()
          }}
        />
      )}
    </div>
  )
}

function AddBidItemModal({ projectId, trades, bidDate, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    trade_id: '',
    item_number: '',
    description: '',
    scope_details: '',
    quantity: '',
    unit: '',
    estimated_cost: '',
    bid_due_date: bidDate || ''
  })

  async function handleSubmit(e) {
    e.preventDefault()

    if (!form.trade_id || !form.description) {
      toast.error('Trade and description are required')
      return
    }

    setLoading(true)
    try {
      await createBidItem({
        project_id: projectId,
        ...form,
        estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : null,
        bid_due_date: form.bid_due_date || null
      })
      toast.success('Bid item added')
      onSuccess()
    } catch (error) {
      console.error('Error creating bid item:', error)
      toast.error('Failed to add bid item')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Add Bid Item</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid gap-4 grid-cols-2">
            <div className="col-span-2">
              <label className="label">Trade *</label>
              <select
                className="input"
                value={form.trade_id}
                onChange={(e) => setForm(prev => ({ ...prev, trade_id: e.target.value }))}
                required
              >
                <option value="">Select trade...</option>
                {trades.map(trade => (
                  <option key={trade.id} value={trade.id}>
                    {trade.division_code} - {trade.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Item Number</label>
              <input
                type="text"
                className="input"
                value={form.item_number}
                onChange={(e) => setForm(prev => ({ ...prev, item_number: e.target.value }))}
                placeholder="e.g., 03-01"
              />
            </div>

            <div>
              <label className="label">Due Date</label>
              <input
                type="date"
                className="input"
                value={form.bid_due_date}
                onChange={(e) => setForm(prev => ({ ...prev, bid_due_date: e.target.value }))}
              />
            </div>

            <div className="col-span-2">
              <label className="label">Description *</label>
              <input
                type="text"
                className="input"
                value={form.description}
                onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="e.g., Cast-in-place concrete foundations"
                required
              />
            </div>

            <div className="col-span-2">
              <label className="label">Scope Details</label>
              <textarea
                className="input"
                rows={2}
                value={form.scope_details}
                onChange={(e) => setForm(prev => ({ ...prev, scope_details: e.target.value }))}
                placeholder="Detailed scope of work..."
              />
            </div>

            <div>
              <label className="label">Quantity</label>
              <input
                type="text"
                className="input"
                value={form.quantity}
                onChange={(e) => setForm(prev => ({ ...prev, quantity: e.target.value }))}
                placeholder="e.g., 500"
              />
            </div>

            <div>
              <label className="label">Unit</label>
              <input
                type="text"
                className="input"
                value={form.unit}
                onChange={(e) => setForm(prev => ({ ...prev, unit: e.target.value }))}
                placeholder="e.g., CY, SF, EA"
              />
            </div>

            <div>
              <label className="label">Estimated Cost ($)</label>
              <input
                type="number"
                className="input"
                value={form.estimated_cost}
                onChange={(e) => setForm(prev => ({ ...prev, estimated_cost: e.target.value }))}
                min="0"
                step="0.01"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function InviteSubsModal({ projectId, bidItems, subcontractors, project, onClose, onSuccess }) {
  const [step, setStep] = useState(1) // 1: Search & Select Items, 2: Select Subs, 3: Review & Send
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItems, setSelectedItems] = useState([])
  const [selectedSubs, setSelectedSubs] = useState([])
  const [loading, setLoading] = useState(false)
  const [sendEmails, setSendEmails] = useState(true)

  // Filter bid items by search query
  const filteredItems = bidItems.filter(item => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      item.description?.toLowerCase().includes(query) ||
      item.trade?.name?.toLowerCase().includes(query) ||
      item.item_number?.toLowerCase().includes(query) ||
      item.scope_details?.toLowerCase().includes(query)
    )
  })

  // Group filtered items by trade
  const itemsByTrade = filteredItems.reduce((acc, item) => {
    const tradeId = item.trade?.id || 'unknown'
    if (!acc[tradeId]) {
      acc[tradeId] = { trade: item.trade, items: [] }
    }
    acc[tradeId].items.push(item)
    return acc
  }, {})

  // Get relevant subcontractors based on selected items' trades
  const selectedTradeIds = [...new Set(
    selectedItems.map(id => bidItems.find(item => item.id === id)?.trade?.id).filter(Boolean)
  )]

  const relevantSubs = subcontractors.filter(sub =>
    sub.trades?.some(({ trade }) => selectedTradeIds.includes(trade.id))
  )

  // Group subcontractors by their trades
  const subsByTrade = relevantSubs.reduce((acc, sub) => {
    sub.trades?.forEach(({ trade }) => {
      if (selectedTradeIds.includes(trade.id)) {
        if (!acc[trade.id]) {
          acc[trade.id] = { trade, subs: [] }
        }
        if (!acc[trade.id].subs.find(s => s.id === sub.id)) {
          acc[trade.id].subs.push(sub)
        }
      }
    })
    return acc
  }, {})

  function selectAllFiltered() {
    const filteredIds = filteredItems.map(item => item.id)
    setSelectedItems(prev => [...new Set([...prev, ...filteredIds])])
  }

  function clearSelection() {
    setSelectedItems([])
  }

  function selectAllSubs() {
    setSelectedSubs(relevantSubs.map(sub => sub.id))
  }

  async function handleInvite() {
    if (selectedItems.length === 0 || selectedSubs.length === 0) {
      toast.error('Select at least one item and one subcontractor')
      return
    }

    setLoading(true)
    let successCount = 0
    let emailsSent = 0

    try {
      // Get selected items and subs data
      const selectedItemsData = selectedItems.map(id => bidItems.find(item => item.id === id))
      const selectedSubsData = selectedSubs.map(id => subcontractors.find(sub => sub.id === id))

      // Create bid invitations
      for (const itemId of selectedItems) {
        for (const subId of selectedSubs) {
          try {
            await createBid({
              bid_item_id: itemId,
              subcontractor_id: subId,
              status: 'invited',
              invitation_sent_at: new Date().toISOString()
            })
            successCount++
          } catch (err) {
            console.error('Error creating bid:', err)
          }
        }
      }

      // Send emails if enabled
      if (sendEmails) {
        for (const sub of selectedSubsData) {
          if (!sub.email) continue

          const subItems = selectedItemsData.filter(item =>
            sub.trades?.some(({ trade }) => trade.id === item.trade?.id)
          )

          if (subItems.length === 0) continue

          try {
            const response = await fetch('/api/send-bid-invitation', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to_email: sub.email,
                to_name: sub.contact_name || sub.company_name,
                subject: `Invitation to Bid: ${project?.name}`,
                project_name: project?.name,
                project_location: project?.location,
                bid_due_date: project?.bid_date,
                bid_items: subItems.map(item => ({
                  trade: item.trade?.name,
                  description: item.description,
                  quantity: item.quantity,
                  unit: item.unit
                })),
                sender_company: 'Clipper Construction'
              })
            })

            const result = await response.json()
            if (response.ok) {
              emailsSent++
            } else {
              console.error('Email send failed:', result.error)
            }
          } catch (err) {
            console.error('Error sending email to', sub.email, err)
          }
        }
      }

      const msg = sendEmails
        ? `Created ${successCount} invitation(s), sent ${emailsSent} email(s)`
        : `Created ${successCount} invitation(s)`
      toast.success(msg)
      onSuccess()
    } catch (error) {
      console.error('Error creating invitations:', error)
      toast.error('Failed to create invitations')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Invite Subcontractors to Bid</h2>
            <p className="text-sm text-gray-500">
              {step === 1 && 'Step 1: Search and select bid items'}
              {step === 2 && 'Step 2: Select subcontractors'}
              {step === 3 && 'Step 3: Review and send'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Step 1: Search & Select Items */}
        {step === 1 && (
          <>
            <div className="p-4 border-b border-gray-200">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search bid items by keyword (e.g., concrete, electrical, drywall...)"
                  className="input pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={selectAllFiltered}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  Select all {filteredItems.length} matching
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={clearSelection}
                  className="text-sm text-gray-600 hover:text-gray-700"
                >
                  Clear selection
                </button>
                <span className="ml-auto text-sm text-gray-500">
                  {selectedItems.length} selected
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {Object.keys(itemsByTrade).length > 0 ? (
                Object.values(itemsByTrade).map(({ trade, items }) => (
                  <div key={trade?.id || 'unknown'} className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-gray-900">
                        {trade ? `Div ${trade.division_code}: ${trade.name}` : 'Unknown Trade'}
                      </span>
                      <span className="text-sm text-gray-500">({items.length})</span>
                      <button
                        onClick={() => {
                          const tradeItemIds = items.map(i => i.id)
                          const allSelected = tradeItemIds.every(id => selectedItems.includes(id))
                          if (allSelected) {
                            setSelectedItems(prev => prev.filter(id => !tradeItemIds.includes(id)))
                          } else {
                            setSelectedItems(prev => [...new Set([...prev, ...tradeItemIds])])
                          }
                        }}
                        className="text-xs text-primary-600 hover:underline ml-2"
                      >
                        {items.every(i => selectedItems.includes(i.id)) ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    <div className="border rounded-lg divide-y">
                      {items.map(item => (
                        <label
                          key={item.id}
                          className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50 ${
                            selectedItems.includes(item.id) ? 'bg-primary-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedItems.includes(item.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedItems([...selectedItems, item.id])
                              } else {
                                setSelectedItems(selectedItems.filter(id => id !== item.id))
                              }
                            }}
                            className="mt-1 rounded border-gray-300"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {item.item_number && (
                                <span className="text-sm font-medium text-gray-500">
                                  #{item.item_number}
                                </span>
                              )}
                              <span className="font-medium text-gray-900">{item.description}</span>
                            </div>
                            {(item.quantity || item.scope_details) && (
                              <p className="text-sm text-gray-500 mt-1">
                                {item.quantity && `Qty: ${item.quantity} ${item.unit || ''}`}
                                {item.quantity && item.scope_details && ' • '}
                                {item.scope_details && item.scope_details.substring(0, 100)}
                              </p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  {searchQuery ? 'No items match your search' : 'No bid items available'}
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 2: Select Subcontractors */}
        {step === 2 && (
          <>
            <div className="p-4 border-b border-gray-200">
              <p className="text-sm text-gray-600 mb-2">
                Showing subcontractors for selected trades: {selectedTradeIds.length} trade(s)
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAllSubs}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  Select all {relevantSubs.length} subs
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setSelectedSubs([])}
                  className="text-sm text-gray-600 hover:text-gray-700"
                >
                  Clear selection
                </button>
                <span className="ml-auto text-sm text-gray-500">
                  {selectedSubs.length} selected
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {Object.keys(subsByTrade).length > 0 ? (
                Object.values(subsByTrade).map(({ trade, subs }) => (
                  <div key={trade.id} className="mb-4">
                    <div className="font-medium text-gray-900 mb-2">
                      Div {trade.division_code}: {trade.name}
                    </div>
                    <div className="border rounded-lg divide-y">
                      {subs.map(sub => (
                        <label
                          key={sub.id}
                          className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 ${
                            selectedSubs.includes(sub.id) ? 'bg-primary-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedSubs.includes(sub.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSubs([...selectedSubs, sub.id])
                              } else {
                                setSelectedSubs(selectedSubs.filter(id => id !== sub.id))
                              }
                            }}
                            className="rounded border-gray-300"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{sub.company_name}</span>
                              {sub.is_preferred && (
                                <span className="badge badge-success text-xs">Preferred</span>
                              )}
                            </div>
                            {sub.email && (
                              <p className="text-sm text-gray-500">{sub.email}</p>
                            )}
                          </div>
                          {sub.email ? (
                            <Mail className="h-4 w-4 text-green-500" />
                          ) : (
                            <span className="text-xs text-gray-400">No email</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No subcontractors found for the selected trades.
                  <br />
                  <Link to="/subcontractors/new" className="text-primary-600 hover:underline">
                    Add subcontractors
                  </Link>
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 3: Review & Send */}
        {step === 3 && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-2">Summary</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• {selectedItems.length} bid item(s) selected</li>
                <li>• {selectedSubs.length} subcontractor(s) selected</li>
                <li>• {selectedItems.length * selectedSubs.length} total invitation(s) will be created</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-gray-900 mb-2">Selected Bid Items</h3>
              <div className="border rounded-lg max-h-32 overflow-y-auto">
                {selectedItems.map(id => {
                  const item = bidItems.find(i => i.id === id)
                  return (
                    <div key={id} className="p-2 border-b last:border-b-0 text-sm">
                      <span className="font-medium">{item?.trade?.name}</span>: {item?.description}
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <h3 className="font-medium text-gray-900 mb-2">Selected Subcontractors</h3>
              <div className="border rounded-lg max-h-32 overflow-y-auto">
                {selectedSubs.map(id => {
                  const sub = subcontractors.find(s => s.id === id)
                  return (
                    <div key={id} className="p-2 border-b last:border-b-0 text-sm flex items-center justify-between">
                      <span>{sub?.company_name}</span>
                      {sub?.email ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {sub.email}
                        </span>
                      ) : (
                        <span className="text-gray-400">No email</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={sendEmails}
                onChange={(e) => setSendEmails(e.target.checked)}
                className="rounded border-gray-300"
              />
              <div>
                <span className="font-medium">Send email invitations</span>
                <p className="text-sm text-gray-500">
                  Automatically email bid requests to subcontractors with email addresses
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex justify-between items-center">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="btn btn-secondary"
              >
                Back
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            {step < 3 ? (
              <button
                className="btn btn-primary"
                onClick={() => setStep(step + 1)}
                disabled={step === 1 ? selectedItems.length === 0 : selectedSubs.length === 0}
              >
                Continue
              </button>
            ) : (
              <button
                className="btn btn-success flex items-center gap-2"
                onClick={handleInvite}
                disabled={loading}
              >
                {loading ? (
                  'Sending...'
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    Send {selectedItems.length * selectedSubs.length} Invitation(s)
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

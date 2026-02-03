import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { DollarSign, Search, Filter, Zap, RefreshCw, Mail, Trash2, CheckSquare, Square, Inbox, Check, X, Eye, Split, Layers } from 'lucide-react'
import { fetchBids, fetchProjects, updateBid, deleteBids, fetchDrawingsForProject, fetchBidResponses, updateBidResponse } from '../lib/supabase'
import { format } from 'date-fns'

export default function Bids() {
  const [bids, setBids] = useState([])
  const [bidResponses, setBidResponses] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [resendingId, setResendingId] = useState(null)
  const [selectedBids, setSelectedBids] = useState(new Set())
  const [deleting, setDeleting] = useState(false)
  const [expandedResponse, setExpandedResponse] = useState(null)
  const [lumpSumModal, setLumpSumModal] = useState(null) // { response, matchingBids }

  useEffect(() => {
    loadData()
  }, [statusFilter])

  async function loadData() {
    setLoading(true)
    try {
      const [bidsData, projectsData, responsesData] = await Promise.all([
        fetchBids({ status: statusFilter !== 'all' ? statusFilter : undefined }),
        fetchProjects('bidding'),
        fetchBidResponses('pending_review')
      ])
      setBids(bidsData || [])
      setProjects(projectsData || [])
      setBidResponses(responsesData || [])
      setSelectedBids(new Set()) // Clear selection on reload
    } catch (error) {
      console.error('Error loading bids:', error)
    } finally {
      setLoading(false)
    }
  }

  // Check if response has usable line items (with amounts)
  function hasUsableLineItems(response) {
    const lineItems = response.line_items || []
    return lineItems.some(item => (item.total || item.unit_price) > 0)
  }

  async function handleApproveResponse(response, splitMethod = null) {
    // Find ALL matching bids for this subcontractor/project
    const matchingBids = bids.filter(b =>
      b.subcontractor?.id === response.subcontractor_id &&
      b.bid_item?.project?.id === response.project_id &&
      b.status === 'invited'
    )

    if (matchingBids.length === 0) {
      alert('Could not find any matching bids to update. The response will be marked as approved.')
      await updateBidResponse(response.id, {
        status: 'approved',
        reviewed_at: new Date().toISOString()
      })
      loadData()
      return
    }

    const lineItems = response.line_items || []
    const hasLineItemPricing = hasUsableLineItems(response)

    // If lump sum with multiple bids and no split method chosen, show options
    if (!hasLineItemPricing && matchingBids.length > 1 && !splitMethod) {
      setLumpSumModal({ response, matchingBids })
      return
    }

    try {
      let updatedCount = 0

      if (hasLineItemPricing && matchingBids.length > 0) {
        // LINE ITEM PRICING: Match each line item to its corresponding bid
        const remainingBids = [...matchingBids]

        for (const lineItem of lineItems) {
          const lineItemTrade = lineItem.trade?.toLowerCase() || ''
          const lineItemDesc = lineItem.description?.toLowerCase() || ''
          const lineItemAmount = lineItem.total || lineItem.unit_price || 0

          if (lineItemAmount <= 0) continue

          // Find best matching bid
          let bestMatch = null
          let bestScore = 0

          for (const bid of remainingBids) {
            const bidTrade = bid.bid_item?.trade?.name?.toLowerCase() || ''
            const bidDesc = bid.bid_item?.description?.toLowerCase() || ''

            let score = 0
            // Check trade match
            if (lineItemTrade && bidTrade && (
              lineItemTrade.includes(bidTrade) ||
              bidTrade.includes(lineItemTrade)
            )) {
              score += 10
            }
            // Check description overlap
            if (lineItemDesc && bidDesc) {
              const lineWords = lineItemDesc.split(/\s+/)
              const bidWords = bidDesc.split(/\s+/)
              const matchingWords = lineWords.filter(w =>
                w.length > 3 && bidWords.some(bw => bw.includes(w) || w.includes(bw))
              )
              score += matchingWords.length
            }

            if (score > bestScore) {
              bestScore = score
              bestMatch = bid
            }
          }

          // Update the matched bid
          if (bestMatch && lineItemAmount > 0) {
            await updateBid(bestMatch.id, {
              amount: lineItemAmount,
              status: 'submitted',
              submitted_at: new Date().toISOString()
            })
            updatedCount++
            // Remove from remaining bids
            const idx = remainingBids.indexOf(bestMatch)
            if (idx > -1) remainingBids.splice(idx, 1)
          }
        }
      } else if (response.total_amount && matchingBids.length > 0) {
        // LUMP SUM PRICING: Apply based on split method
        if (splitMethod === 'even' || matchingBids.length === 1) {
          // Split evenly across all bid items
          const splitAmount = Math.round((response.total_amount / matchingBids.length) * 100) / 100

          for (const bid of matchingBids) {
            await updateBid(bid.id, {
              amount: splitAmount,
              status: 'submitted',
              submitted_at: new Date().toISOString(),
              notes: matchingBids.length > 1 ? `Split from lump sum of $${response.total_amount.toLocaleString()}` : null
            })
            updatedCount++
          }
        } else if (splitMethod === 'full') {
          // Apply full amount to first bid, mark others as included
          const lumpSumId = crypto.randomUUID()

          for (let i = 0; i < matchingBids.length; i++) {
            const bid = matchingBids[i]
            if (i === 0) {
              // First bid gets the full amount
              await updateBid(bid.id, {
                amount: response.total_amount,
                status: 'submitted',
                submitted_at: new Date().toISOString(),
                notes: `Lump sum for ${matchingBids.length} items`
              })
            } else {
              // Other bids marked as included in lump sum
              await updateBid(bid.id, {
                amount: 0,
                status: 'submitted',
                submitted_at: new Date().toISOString(),
                notes: `Included in lump sum (see ${matchingBids[0].bid_item?.trade?.name || 'first item'})`
              })
            }
            updatedCount++
          }
        }
      }

      // Mark response as approved
      await updateBidResponse(response.id, {
        status: 'approved',
        reviewed_at: new Date().toISOString()
      })

      setLumpSumModal(null)

      const methodText = hasLineItemPricing
        ? 'line items'
        : splitMethod === 'even'
          ? 'split evenly'
          : 'lump sum'
      alert(`Bid response approved! Updated ${updatedCount} bid(s) (${methodText}).`)
      loadData()
    } catch (error) {
      console.error('Error approving response:', error)
      alert('Failed to approve response')
    }
  }

  async function handleRejectResponse(responseId) {
    if (!confirm('Are you sure you want to reject this bid response?')) return

    try {
      await updateBidResponse(responseId, {
        status: 'rejected',
        reviewed_at: new Date().toISOString()
      })
      loadData()
    } catch (error) {
      console.error('Error rejecting response:', error)
      alert('Failed to reject response')
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

      {/* Incoming Bid Responses */}
      {bidResponses.length > 0 && (
        <div className="card border-2 border-green-200 bg-green-50">
          <div className="p-4 border-b border-green-200">
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-green-600" />
              <h2 className="text-lg font-semibold text-green-800">
                Incoming Bid Responses ({bidResponses.length})
              </h2>
            </div>
            <p className="text-sm text-green-600 mt-1">
              These bids were received via email and parsed by AI. Review and approve to update bid amounts.
            </p>
          </div>
          <div className="divide-y divide-green-200">
            {bidResponses.map(response => (
              <div key={response.id} className="p-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900">
                        {response.subcontractor?.company_name || response.inbound_email?.from_name || 'Unknown'}
                      </span>
                      <span className="text-gray-400">•</span>
                      <span className="text-gray-600">
                        {response.project?.name || 'Unknown Project'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span className="font-bold text-2xl text-green-700">
                        ${response.total_amount?.toLocaleString() || '0'}
                      </span>
                      {hasUsableLineItems(response) ? (
                        <span className="badge bg-blue-100 text-blue-700 flex items-center gap-1">
                          <Split className="h-3 w-3" />
                          {response.line_items.length} line item(s)
                        </span>
                      ) : (
                        <span className="badge bg-purple-100 text-purple-700 flex items-center gap-1">
                          <Layers className="h-3 w-3" />
                          Lump Sum
                        </span>
                      )}
                      <span className={`badge ${response.ai_confidence_score >= 0.8 ? 'badge-success' : response.ai_confidence_score >= 0.5 ? 'badge-warning' : 'badge-danger'}`}>
                        {Math.round((response.ai_confidence_score || 0) * 100)}% confidence
                      </span>
                      <span className="text-gray-400">
                        {response.inbound_email?.received_at && format(new Date(response.inbound_email.received_at), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    {/* Expandable details */}
                    {expandedResponse === response.id && (
                      <div className="mt-3 p-3 bg-white rounded border text-sm space-y-2">
                        {response.line_items?.length > 0 && (
                          <div>
                            <strong>Line Items:</strong>
                            <ul className="list-disc list-inside ml-2">
                              {response.line_items.map((item, i) => (
                                <li key={i}>
                                  {item.description}: ${item.total?.toLocaleString() || item.unit_price?.toLocaleString() || 'N/A'}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {response.scope_included && (
                          <div><strong>Includes:</strong> {response.scope_included}</div>
                        )}
                        {response.scope_excluded && (
                          <div><strong>Excludes:</strong> {response.scope_excluded}</div>
                        )}
                        {response.clarifications && (
                          <div><strong>Clarifications:</strong> {response.clarifications}</div>
                        )}
                        {response.lead_time && (
                          <div><strong>Lead Time:</strong> {response.lead_time}</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setExpandedResponse(expandedResponse === response.id ? null : response.id)}
                      className="btn btn-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
                    >
                      <Eye className="h-4 w-4" />
                      {expandedResponse === response.id ? 'Hide' : 'Details'}
                    </button>
                    <button
                      onClick={() => handleApproveResponse(response)}
                      className="btn btn-sm bg-green-600 text-white hover:bg-green-700 flex items-center gap-1"
                    >
                      <Check className="h-4 w-4" />
                      Approve
                    </button>
                    <button
                      onClick={() => handleRejectResponse(response.id)}
                      className="btn btn-sm bg-red-100 text-red-600 hover:bg-red-200 flex items-center gap-1"
                    >
                      <X className="h-4 w-4" />
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Lump Sum Options Modal */}
      {lumpSumModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Lump Sum Bid</h2>
              <p className="text-gray-600 mt-1">
                This subcontractor submitted a lump sum of <strong>${lumpSumModal.response.total_amount?.toLocaleString()}</strong> for {lumpSumModal.matchingBids.length} bid items.
              </p>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">How would you like to apply this amount?</p>

              <div className="space-y-3">
                {/* Split Evenly Option */}
                <button
                  onClick={() => handleApproveResponse(lumpSumModal.response, 'even')}
                  className="w-full p-4 border-2 rounded-lg text-left hover:border-blue-500 hover:bg-blue-50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Split className="h-6 w-6 text-blue-600 mt-0.5" />
                    <div>
                      <div className="font-semibold text-gray-900">Split Evenly</div>
                      <p className="text-sm text-gray-600 mt-1">
                        Divide ${lumpSumModal.response.total_amount?.toLocaleString()} equally across {lumpSumModal.matchingBids.length} items
                      </p>
                      <p className="text-sm font-medium text-blue-600 mt-1">
                        = ${Math.round((lumpSumModal.response.total_amount / lumpSumModal.matchingBids.length) * 100 / 100).toLocaleString()} per item
                      </p>
                    </div>
                  </div>
                </button>

                {/* Full Amount Option */}
                <button
                  onClick={() => handleApproveResponse(lumpSumModal.response, 'full')}
                  className="w-full p-4 border-2 rounded-lg text-left hover:border-purple-500 hover:bg-purple-50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <Layers className="h-6 w-6 text-purple-600 mt-0.5" />
                    <div>
                      <div className="font-semibold text-gray-900">Keep as Lump Sum</div>
                      <p className="text-sm text-gray-600 mt-1">
                        Apply full ${lumpSumModal.response.total_amount?.toLocaleString()} to first item, mark others as "included"
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        Good when items are bundled and can't be separated
                      </p>
                    </div>
                  </div>
                </button>
              </div>

              {/* Show the bid items this will affect */}
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs font-medium text-gray-500 mb-2">AFFECTED BID ITEMS:</p>
                <ul className="text-sm text-gray-700 space-y-1">
                  {lumpSumModal.matchingBids.map(bid => (
                    <li key={bid.id} className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                      {bid.bid_item?.trade?.name}: {bid.bid_item?.description?.substring(0, 50)}...
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setLumpSumModal(null)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

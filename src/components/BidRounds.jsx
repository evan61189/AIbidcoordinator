import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  Layers, Plus, Upload, FileText, ChevronDown, ChevronRight,
  Calendar, Clock, DollarSign, Users, RefreshCw, Check, X,
  ArrowRight, TrendingUp, TrendingDown, Minus, Download, Eye
} from 'lucide-react'
import toast from 'react-hot-toast'
import BidLeveling from './BidLeveling'

/**
 * BidRounds Component
 * Manages pricing rounds within a project as drawings mature
 */
export default function BidRounds({ projectId, projectName }) {
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedRound, setExpandedRound] = useState(null)
  const [showNewRoundModal, setShowNewRoundModal] = useState(false)
  const [uploadingDrawings, setUploadingDrawings] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (projectId) {
      loadRounds()
    }
  }, [projectId])

  async function loadRounds() {
    setLoading(true)
    try {
      // Load rounds with their drawings and bid items counts
      const { data: roundsData, error } = await supabase
        .from('bid_rounds')
        .select(`
          *,
          drawings:drawings(count),
          bid_items:bid_items(count)
        `)
        .eq('project_id', projectId)
        .order('round_number', { ascending: true })

      if (error) throw error

      // Also get response counts
      const roundsWithResponses = await Promise.all((roundsData || []).map(async (round) => {
        const { count } = await supabase
          .from('bid_round_responses')
          .select('*', { count: 'exact', head: true })
          .eq('bid_round_id', round.id)

        return {
          ...round,
          response_count: count || 0
        }
      }))

      setRounds(roundsWithResponses)

      // Auto-expand the active round
      const activeRound = roundsWithResponses.find(r => r.status === 'active')
      if (activeRound) {
        setExpandedRound(activeRound.id)
      }
    } catch (error) {
      console.error('Error loading rounds:', error)
      toast.error('Failed to load bid rounds')
    } finally {
      setLoading(false)
    }
  }

  async function createNewRound(name, copyBidItems = true) {
    try {
      // Get the latest round number
      const maxRound = rounds.reduce((max, r) => Math.max(max, r.round_number), 0)

      // Mark current active round as superseded
      const activeRound = rounds.find(r => r.status === 'active')
      if (activeRound) {
        await supabase
          .from('bid_rounds')
          .update({ status: 'superseded' })
          .eq('id', activeRound.id)
      }

      // Create new round
      const { data: newRound, error } = await supabase
        .from('bid_rounds')
        .insert({
          project_id: projectId,
          round_number: maxRound + 1,
          name: name || `Round ${maxRound + 1}`,
          status: 'active'
        })
        .select()
        .single()

      if (error) throw error

      // Copy bid items from previous round if requested
      if (copyBidItems && activeRound) {
        const { data: prevItems } = await supabase
          .from('bid_items')
          .select('*')
          .eq('bid_round_id', activeRound.id)

        if (prevItems && prevItems.length > 0) {
          const newItems = prevItems.map(item => ({
            project_id: projectId,
            bid_round_id: newRound.id,
            trade_id: item.trade_id,
            item_number: item.item_number,
            description: item.description,
            scope_details: item.scope_details,
            quantity: item.quantity,
            unit: item.unit,
            estimated_cost: item.estimated_cost,
            bid_due_date: item.bid_due_date,
            notes: item.notes,
            ai_generated: item.ai_generated,
            ai_confidence: item.ai_confidence,
            status: 'open'
          }))

          await supabase.from('bid_items').insert(newItems)
        }
      }

      toast.success(`Created ${newRound.name}`)
      setShowNewRoundModal(false)
      loadRounds()
      return newRound
    } catch (error) {
      console.error('Error creating round:', error)
      toast.error('Failed to create bid round')
    }
  }

  async function handleDrawingUpload(roundId, files) {
    if (!files || files.length === 0) return

    setUploadingDrawings(true)
    setUploadProgress({ current: 0, total: files.length })

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setUploadProgress({ current: i + 1, total: files.length, filename: file.name })

        const formData = new FormData()
        formData.append('file', file)
        formData.append('project_id', projectId)
        formData.append('bid_round_id', roundId)
        formData.append('project_name', projectName)
        formData.append('process_with_ai', 'true')

        const response = await fetch('/api/upload-drawing', {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.details || 'Upload failed')
        }

        const result = await response.json()
        console.log(`Uploaded ${file.name}:`, result)
      }

      toast.success(`Uploaded ${files.length} drawing(s)`)
      loadRounds()
    } catch (error) {
      console.error('Upload error:', error)
      toast.error(`Upload failed: ${error.message}`)
    } finally {
      setUploadingDrawings(false)
      setUploadProgress(null)
    }
  }

  function formatCurrency(amount) {
    if (!amount && amount !== 0) return '-'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)
  }

  function formatDate(dateString) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const statusColors = {
    active: 'bg-green-100 text-green-800',
    closed: 'bg-gray-100 text-gray-800',
    superseded: 'bg-yellow-100 text-yellow-800'
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Loading bid rounds...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold">Bid Rounds</h2>
            <span className="text-sm text-gray-500">({rounds.length} rounds)</span>
          </div>
          <button
            onClick={() => setShowNewRoundModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" />
            New Round
          </button>
        </div>

        {rounds.length === 0 ? (
          <div className="p-8 text-center">
            <Layers className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No Bid Rounds Yet</h3>
            <p className="text-sm text-gray-500 mb-4">
              Create your first bid round to start uploading drawings and collecting bids.
            </p>
            <button
              onClick={() => setShowNewRoundModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Create First Round
            </button>
          </div>
        ) : (
          <div className="divide-y">
            {rounds.map((round) => (
              <div key={round.id} className="border-b last:border-b-0">
                {/* Round Header */}
                <button
                  onClick={() => setExpandedRound(expandedRound === round.id ? null : round.id)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
                >
                  <div className="flex items-center gap-4">
                    {expandedRound === round.id ? (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    )}
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{round.name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${statusColors[round.status]}`}>
                          {round.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500">
                        {round.drawing_revision && `${round.drawing_revision} • `}
                        Created {formatDate(round.created_at)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{round.drawings?.[0]?.count || 0}</div>
                      <div className="text-gray-500">Drawings</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{round.bid_items?.[0]?.count || 0}</div>
                      <div className="text-gray-500">Bid Items</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{round.response_count}</div>
                      <div className="text-gray-500">Responses</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-green-600">{formatCurrency(round.lowest_total)}</div>
                      <div className="text-gray-500">Lowest</div>
                    </div>
                  </div>
                </button>

                {/* Expanded Round Content */}
                {expandedRound === round.id && (
                  <div className="px-6 pb-6 pt-2 bg-gray-50 border-t">
                    {/* Actions */}
                    <div className="flex gap-2 mb-4">
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        multiple
                        accept=".pdf,.png,.jpg,.jpeg"
                        onChange={(e) => handleDrawingUpload(round.id, Array.from(e.target.files))}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingDrawings || round.status === 'superseded'}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border rounded hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Upload className="w-4 h-4" />
                        {uploadingDrawings ? 'Uploading...' : 'Upload Drawings'}
                      </button>
                      <button
                        onClick={() => {/* View drawings */}}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border rounded hover:bg-gray-50"
                      >
                        <Eye className="w-4 h-4" />
                        View Drawings
                      </button>
                    </div>

                    {/* Upload Progress */}
                    {uploadProgress && (
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
                        <div className="flex items-center gap-2 text-sm text-blue-800">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Uploading {uploadProgress.current} of {uploadProgress.total}...
                          {uploadProgress.filename && (
                            <span className="text-blue-600">{uploadProgress.filename}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Round Details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="bg-white p-3 rounded border">
                        <div className="text-xs text-gray-500 mb-1">Due Date</div>
                        <div className="font-medium">{formatDate(round.due_date) || 'Not set'}</div>
                      </div>
                      <div className="bg-white p-3 rounded border">
                        <div className="text-xs text-gray-500 mb-1">Drawing Revision</div>
                        <div className="font-medium">{round.drawing_revision || 'Not specified'}</div>
                      </div>
                      <div className="bg-white p-3 rounded border">
                        <div className="text-xs text-gray-500 mb-1">Lowest Bid</div>
                        <div className="font-medium text-green-600">{formatCurrency(round.lowest_total)}</div>
                      </div>
                      <div className="bg-white p-3 rounded border">
                        <div className="text-xs text-gray-500 mb-1">Average Bid</div>
                        <div className="font-medium">{formatCurrency(round.average_total)}</div>
                      </div>
                    </div>

                    {round.description && (
                      <div className="mb-4 p-3 bg-white rounded border">
                        <div className="text-xs text-gray-500 mb-1">Notes</div>
                        <div className="text-sm">{round.description}</div>
                      </div>
                    )}

                    {/* Bid Responses for this round */}
                    <RoundResponses roundId={round.id} projectName={projectName} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pricing Comparison Across Rounds */}
      {rounds.length > 1 && (
        <RoundComparison rounds={rounds} projectId={projectId} />
      )}

      {/* New Round Modal */}
      {showNewRoundModal && (
        <NewRoundModal
          existingRounds={rounds}
          onClose={() => setShowNewRoundModal(false)}
          onSubmit={createNewRound}
        />
      )}
    </div>
  )
}

/**
 * Round Responses Component - Shows bid responses for a specific round
 */
function RoundResponses({ roundId, projectName }) {
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadResponses()
  }, [roundId])

  async function loadResponses() {
    try {
      const { data, error } = await supabase
        .from('bid_round_responses')
        .select(`
          *,
          subcontractor:subcontractor_id (id, company_name, contact_name, email)
        `)
        .eq('bid_round_id', roundId)
        .order('total_amount', { ascending: true })

      if (error) throw error
      setResponses(data || [])
    } catch (error) {
      console.error('Error loading responses:', error)
    } finally {
      setLoading(false)
    }
  }

  function formatCurrency(amount) {
    if (!amount && amount !== 0) return '-'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Loading responses...</div>
  }

  if (responses.length === 0) {
    return (
      <div className="text-sm text-gray-500 p-4 bg-white rounded border text-center">
        No bid responses yet for this round.
      </div>
    )
  }

  const lowestAmount = Math.min(...responses.filter(r => r.total_amount).map(r => r.total_amount))

  return (
    <div className="bg-white rounded border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left p-3 font-medium">Subcontractor</th>
            <th className="text-right p-3 font-medium">Amount</th>
            <th className="text-center p-3 font-medium">Status</th>
            <th className="text-center p-3 font-medium">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {responses.map((response) => (
            <tr key={response.id} className="hover:bg-gray-50">
              <td className="p-3">
                <div className="font-medium">{response.subcontractor?.company_name}</div>
                <div className="text-xs text-gray-500">{response.subcontractor?.email}</div>
              </td>
              <td className="p-3 text-right">
                <div className={`font-medium ${response.total_amount === lowestAmount ? 'text-green-600' : ''}`}>
                  {formatCurrency(response.total_amount)}
                </div>
                {response.total_amount === lowestAmount && (
                  <span className="text-xs text-green-600">Lowest</span>
                )}
              </td>
              <td className="p-3 text-center">
                <span className={`px-2 py-1 rounded-full text-xs ${
                  response.status === 'approved' ? 'bg-green-100 text-green-800' :
                  response.status === 'rejected' ? 'bg-red-100 text-red-800' :
                  response.status === 'awarded' ? 'bg-purple-100 text-purple-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {response.status?.replace('_', ' ')}
                </span>
              </td>
              <td className="p-3 text-center">
                {response.price_change_percent ? (
                  <div className={`flex items-center justify-center gap-1 ${
                    response.price_change_percent < 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {response.price_change_percent < 0 ? (
                      <TrendingDown className="w-4 h-4" />
                    ) : response.price_change_percent > 0 ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : (
                      <Minus className="w-4 h-4" />
                    )}
                    {Math.abs(response.price_change_percent).toFixed(1)}%
                  </div>
                ) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Round Comparison Component - Compare pricing across rounds
 */
function RoundComparison({ rounds, projectId }) {
  const [comparisonData, setComparisonData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadComparison()
  }, [rounds])

  async function loadComparison() {
    try {
      // Get all subcontractors who have responded in any round
      const { data } = await supabase
        .from('bid_round_responses')
        .select(`
          bid_round_id,
          total_amount,
          subcontractor:subcontractor_id (id, company_name)
        `)
        .in('bid_round_id', rounds.map(r => r.id))

      // Group by subcontractor
      const bySubcontractor = {}
      data?.forEach(response => {
        const subId = response.subcontractor?.id
        if (!subId) return
        if (!bySubcontractor[subId]) {
          bySubcontractor[subId] = {
            subcontractor: response.subcontractor,
            rounds: {}
          }
        }
        bySubcontractor[subId].rounds[response.bid_round_id] = response.total_amount
      })

      setComparisonData(Object.values(bySubcontractor))
    } catch (error) {
      console.error('Error loading comparison:', error)
    } finally {
      setLoading(false)
    }
  }

  function formatCurrency(amount) {
    if (!amount && amount !== 0) return '-'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)
  }

  if (loading || comparisonData.length === 0) return null

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b">
        <h3 className="font-semibold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          Pricing Comparison Across Rounds
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Subcontractor</th>
              {rounds.map(round => (
                <th key={round.id} className="text-right p-3 font-medium">
                  {round.name}
                </th>
              ))}
              <th className="text-right p-3 font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {comparisonData.map((row) => {
              const amounts = rounds.map(r => row.rounds[r.id]).filter(Boolean)
              const firstAmount = amounts[0]
              const lastAmount = amounts[amounts.length - 1]
              const change = firstAmount && lastAmount ? ((lastAmount - firstAmount) / firstAmount * 100) : null

              return (
                <tr key={row.subcontractor.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium">{row.subcontractor.company_name}</td>
                  {rounds.map(round => (
                    <td key={round.id} className="p-3 text-right">
                      {formatCurrency(row.rounds[round.id])}
                    </td>
                  ))}
                  <td className="p-3 text-right">
                    {change !== null && (
                      <span className={change < 0 ? 'text-green-600' : change > 0 ? 'text-red-600' : ''}>
                        {change > 0 ? '+' : ''}{change.toFixed(1)}%
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * New Round Modal
 */
function NewRoundModal({ existingRounds, onClose, onSubmit }) {
  const [name, setName] = useState(`Round ${existingRounds.length + 1}`)
  const [revision, setRevision] = useState('')
  const [copyBidItems, setCopyBidItems] = useState(true)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    await onSubmit(name, copyBidItems)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Create New Bid Round</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Round Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g., DD Pricing, GMP Round 1"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Drawing Revision (optional)
            </label>
            <input
              type="text"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g., DD Set Rev 1, 100% CD"
            />
          </div>
          {existingRounds.length > 0 && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={copyBidItems}
                onChange={(e) => setCopyBidItems(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-700">
                Copy bid items from previous round
              </span>
            </label>
          )}
          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Round'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

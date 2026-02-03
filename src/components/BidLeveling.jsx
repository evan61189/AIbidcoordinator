import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import {
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  AlertCircle,
  Clock,
  DollarSign,
  FileText,
  Download,
  RefreshCw
} from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * BidLeveling Component
 * Displays all bid responses for a project in a side-by-side comparison format
 */
export default function BidLeveling({ projectId, projectName }) {
  const [bidResponses, setBidResponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedSections, setExpandedSections] = useState({})

  useEffect(() => {
    if (projectId) {
      loadBidResponses()
    }
  }, [projectId])

  async function loadBidResponses() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('bid_responses')
        .select(`
          *,
          subcontractor:subcontractor_id (id, company_name, contact_name, email, phone),
          inbound_email:inbound_email_id (from_email, subject, received_at, body_plain)
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setBidResponses(data || [])
    } catch (error) {
      console.error('Error loading bid responses:', error)
      toast.error('Failed to load bid responses')
    } finally {
      setLoading(false)
    }
  }

  function toggleSection(section) {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
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

  async function updateResponseStatus(responseId, newStatus) {
    try {
      const { error } = await supabase
        .from('bid_responses')
        .update({
          status: newStatus,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', responseId)

      if (error) throw error
      toast.success(`Bid marked as ${newStatus.replace('_', ' ')}`)
      loadBidResponses()
    } catch (error) {
      console.error('Error updating status:', error)
      toast.error('Failed to update status')
    }
  }

  function exportToCSV() {
    if (bidResponses.length === 0) {
      toast.error('No bid responses to export')
      return
    }

    // Build CSV header
    const headers = [
      'Subcontractor',
      'Total Amount',
      'Status',
      'Inclusions',
      'Exclusions',
      'Clarifications',
      'Lead Time',
      'Valid Until',
      'Confidence Score',
      'Received Date'
    ]

    // Build CSV rows
    const rows = bidResponses.map(bid => [
      bid.subcontractor?.company_name || 'Unknown',
      bid.total_amount || '',
      bid.status,
      bid.scope_included || '',
      bid.scope_excluded || '',
      bid.clarifications || '',
      bid.lead_time || '',
      bid.valid_until || '',
      bid.ai_confidence_score || '',
      bid.inbound_email?.received_at || ''
    ])

    // Convert to CSV string
    const csvContent = [
      headers.join(','),
      ...rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      )
    ].join('\n')

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${projectName || 'project'}_bid_leveling.csv`
    link.click()
    toast.success('Exported to CSV')
  }

  const statusColors = {
    pending_review: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    needs_clarification: 'bg-blue-100 text-blue-800'
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Loading bid responses...
        </div>
      </div>
    )
  }

  if (bidResponses.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center text-gray-500">
          <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No Bid Responses Yet</h3>
          <p className="text-sm">
            When subcontractors reply to bid invitations, their responses will appear here
            for comparison and leveling.
          </p>
        </div>
      </div>
    )
  }

  // Find lowest bid for highlighting
  const lowestBid = Math.min(...bidResponses.filter(b => b.total_amount).map(b => b.total_amount))

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">Bid Leveling</h2>
          <span className="text-sm text-gray-500">({bidResponses.length} responses)</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadBidResponses}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={exportToCSV}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Comparison Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left p-4 font-medium text-gray-700 min-w-[200px]">Subcontractor</th>
              <th className="text-right p-4 font-medium text-gray-700 min-w-[120px]">Total Amount</th>
              <th className="text-center p-4 font-medium text-gray-700 min-w-[100px]">Status</th>
              <th className="text-center p-4 font-medium text-gray-700 min-w-[100px]">Confidence</th>
              <th className="text-left p-4 font-medium text-gray-700 min-w-[150px]">Lead Time</th>
              <th className="text-left p-4 font-medium text-gray-700 min-w-[120px]">Valid Until</th>
              <th className="text-center p-4 font-medium text-gray-700 min-w-[150px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {bidResponses.map((bid) => (
              <tr key={bid.id} className="border-b hover:bg-gray-50">
                <td className="p-4">
                  <div className="font-medium text-gray-900">
                    {bid.subcontractor?.company_name || 'Unknown'}
                  </div>
                  <div className="text-sm text-gray-500">
                    {bid.inbound_email?.from_email}
                  </div>
                  <div className="text-xs text-gray-400">
                    Received: {formatDate(bid.inbound_email?.received_at)}
                  </div>
                </td>
                <td className="p-4 text-right">
                  <div className={`text-lg font-semibold ${bid.total_amount === lowestBid ? 'text-green-600' : 'text-gray-900'}`}>
                    {formatCurrency(bid.total_amount)}
                  </div>
                  {bid.total_amount === lowestBid && (
                    <span className="text-xs text-green-600">Lowest</span>
                  )}
                </td>
                <td className="p-4 text-center">
                  <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${statusColors[bid.status] || 'bg-gray-100'}`}>
                    {bid.status?.replace('_', ' ')}
                  </span>
                </td>
                <td className="p-4 text-center">
                  {bid.ai_confidence_score ? (
                    <div className="flex items-center justify-center gap-1">
                      <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${bid.ai_confidence_score > 0.7 ? 'bg-green-500' : bid.ai_confidence_score > 0.4 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${bid.ai_confidence_score * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{Math.round(bid.ai_confidence_score * 100)}%</span>
                    </div>
                  ) : '-'}
                </td>
                <td className="p-4 text-sm text-gray-600">
                  {bid.lead_time || '-'}
                </td>
                <td className="p-4 text-sm text-gray-600">
                  {formatDate(bid.valid_until)}
                </td>
                <td className="p-4">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => updateResponseStatus(bid.id, 'approved')}
                      className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                      title="Approve"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => updateResponseStatus(bid.id, 'rejected')}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      title="Reject"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => updateResponseStatus(bid.id, 'needs_clarification')}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                      title="Needs Clarification"
                    >
                      <AlertCircle className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detailed Comparison Sections */}
      <div className="divide-y">
        {/* Scope Inclusions */}
        <div className="p-4">
          <button
            onClick={() => toggleSection('inclusions')}
            className="flex items-center gap-2 font-medium text-gray-700 w-full text-left"
          >
            {expandedSections.inclusions ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Scope Inclusions
          </button>
          {expandedSections.inclusions && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bidResponses.map((bid) => (
                <div key={bid.id} className="bg-gray-50 p-3 rounded">
                  <div className="font-medium text-sm text-gray-900 mb-2">
                    {bid.subcontractor?.company_name || 'Unknown'}
                  </div>
                  <div className="text-sm text-gray-600 whitespace-pre-wrap">
                    {bid.scope_included || 'Not specified'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scope Exclusions */}
        <div className="p-4">
          <button
            onClick={() => toggleSection('exclusions')}
            className="flex items-center gap-2 font-medium text-gray-700 w-full text-left"
          >
            {expandedSections.exclusions ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Scope Exclusions
          </button>
          {expandedSections.exclusions && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bidResponses.map((bid) => (
                <div key={bid.id} className="bg-red-50 p-3 rounded">
                  <div className="font-medium text-sm text-gray-900 mb-2">
                    {bid.subcontractor?.company_name || 'Unknown'}
                  </div>
                  <div className="text-sm text-red-700 whitespace-pre-wrap">
                    {bid.scope_excluded || 'None specified'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Clarifications */}
        <div className="p-4">
          <button
            onClick={() => toggleSection('clarifications')}
            className="flex items-center gap-2 font-medium text-gray-700 w-full text-left"
          >
            {expandedSections.clarifications ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Clarifications & Assumptions
          </button>
          {expandedSections.clarifications && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bidResponses.map((bid) => (
                <div key={bid.id} className="bg-yellow-50 p-3 rounded">
                  <div className="font-medium text-sm text-gray-900 mb-2">
                    {bid.subcontractor?.company_name || 'Unknown'}
                  </div>
                  <div className="text-sm text-yellow-800 whitespace-pre-wrap">
                    {bid.clarifications || 'None'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Line Items */}
        <div className="p-4">
          <button
            onClick={() => toggleSection('lineItems')}
            className="flex items-center gap-2 font-medium text-gray-700 w-full text-left"
          >
            {expandedSections.lineItems ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Line Item Breakdown
          </button>
          {expandedSections.lineItems && (
            <div className="mt-4 space-y-4">
              {bidResponses.map((bid) => (
                <div key={bid.id} className="bg-gray-50 p-4 rounded">
                  <div className="font-medium text-gray-900 mb-3">
                    {bid.subcontractor?.company_name || 'Unknown'}
                  </div>
                  {bid.line_items && bid.line_items.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 w-1/2">Description</th>
                          <th className="text-left py-2">Trade</th>
                          <th className="text-right py-2">Qty</th>
                          <th className="text-right py-2">Unit Price</th>
                          <th className="text-right py-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bid.line_items.map((item, idx) => (
                          <tr key={idx} className="border-b border-gray-200 align-top">
                            <td className="py-2 pr-4 whitespace-normal">{item.description}</td>
                            <td className="py-2 text-gray-600">{item.trade || '-'}</td>
                            <td className="py-2 text-right">{item.quantity} {item.unit}</td>
                            <td className="py-2 text-right">{formatCurrency(item.unit_price)}</td>
                            <td className="py-2 text-right font-medium">{formatCurrency(item.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-sm text-gray-500 italic">No line items extracted</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Analysis Notes */}
        <div className="p-4">
          <button
            onClick={() => toggleSection('aiNotes')}
            className="flex items-center gap-2 font-medium text-gray-700 w-full text-left"
          >
            {expandedSections.aiNotes ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            AI Analysis Notes
          </button>
          {expandedSections.aiNotes && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bidResponses.map((bid) => (
                <div key={bid.id} className="bg-indigo-50 p-3 rounded">
                  <div className="font-medium text-sm text-gray-900 mb-2">
                    {bid.subcontractor?.company_name || 'Unknown'}
                  </div>
                  <div className="text-sm text-indigo-800 whitespace-pre-wrap">
                    {bid.ai_analysis_notes || 'No additional notes'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

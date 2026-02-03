import { useState, useEffect } from 'react'
import {
  MessageSquare,
  Plus,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  AlertCircle,
  Send,
  Paperclip,
  ChevronDown,
  ChevronUp,
  X,
  Edit,
  MessageCircle,
  Users,
  Calendar,
  AlertTriangle
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { format, isPast, differenceInDays } from 'date-fns'

const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-700',
  normal: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700'
}

const STATUS_COLORS = {
  open: 'bg-yellow-100 text-yellow-700',
  pending_response: 'bg-blue-100 text-blue-700',
  answered: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-700',
  void: 'bg-gray-100 text-gray-500'
}

const CATEGORIES = [
  { value: 'scope_clarification', label: 'Scope Clarification' },
  { value: 'drawing_conflict', label: 'Drawing Conflict' },
  { value: 'spec_question', label: 'Specification Question' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'pricing', label: 'Pricing' },
  { value: 'substitution', label: 'Substitution Request' },
  { value: 'other', label: 'Other' }
]

export default function RFIManager({ projectId, subcontractors = [] }) {
  const [rfis, setRfis] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingRfi, setEditingRfi] = useState(null)
  const [expandedRfi, setExpandedRfi] = useState(null)
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  const [formData, setFormData] = useState({
    subject: '',
    question: '',
    category: 'scope_clarification',
    priority: 'normal',
    date_required: '',
    subcontractor_id: '',
    submitted_by_name: '',
    submitted_by_email: '',
    related_spec_sections: '',
    internal_notes: ''
  })

  const [responseData, setResponseData] = useState({
    response: '',
    distribute_to_all: false,
    has_cost_impact: false,
    cost_impact_description: '',
    has_schedule_impact: false,
    schedule_impact_description: ''
  })

  useEffect(() => {
    if (projectId) {
      loadRfis()
    }
  }, [projectId])

  async function loadRfis() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('rfis')
        .select(`
          *,
          subcontractor:subcontractors (id, company_name),
          comments:rfi_comments (
            id, comment, comment_by, comment_by_type, is_internal, created_at
          )
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setRfis(data || [])
    } catch (error) {
      console.error('Error loading RFIs:', error)
    } finally {
      setLoading(false)
    }
  }

  async function getNextRfiNumber() {
    const { data } = await supabase
      .rpc('get_next_rfi_number', { p_project_id: projectId })

    return data || `RFI-${String(rfis.length + 1).padStart(3, '0')}`
  }

  async function handleSubmit(e) {
    e.preventDefault()

    try {
      const rfiNumber = editingRfi?.rfi_number || await getNextRfiNumber()

      const rfiData = {
        project_id: projectId,
        rfi_number: rfiNumber,
        subject: formData.subject,
        question: formData.question,
        category: formData.category,
        priority: formData.priority,
        date_required: formData.date_required || null,
        subcontractor_id: formData.subcontractor_id || null,
        submitted_by_name: formData.submitted_by_name || null,
        submitted_by_email: formData.submitted_by_email || null,
        related_spec_sections: formData.related_spec_sections || null,
        internal_notes: formData.internal_notes || null,
        status: 'open'
      }

      if (editingRfi) {
        await supabase
          .from('rfis')
          .update(rfiData)
          .eq('id', editingRfi.id)
      } else {
        await supabase.from('rfis').insert(rfiData)
      }

      resetForm()
      loadRfis()
    } catch (error) {
      console.error('Error saving RFI:', error)
      alert('Failed to save RFI')
    }
  }

  async function handleResponse(rfiId) {
    try {
      await supabase
        .from('rfis')
        .update({
          response: responseData.response,
          date_responded: new Date().toISOString().split('T')[0],
          status: 'answered',
          distribute_to_all: responseData.distribute_to_all,
          has_cost_impact: responseData.has_cost_impact,
          cost_impact_description: responseData.cost_impact_description || null,
          has_schedule_impact: responseData.has_schedule_impact,
          schedule_impact_description: responseData.schedule_impact_description || null
        })
        .eq('id', rfiId)

      setResponseData({
        response: '',
        distribute_to_all: false,
        has_cost_impact: false,
        cost_impact_description: '',
        has_schedule_impact: false,
        schedule_impact_description: ''
      })

      loadRfis()
    } catch (error) {
      console.error('Error responding to RFI:', error)
      alert('Failed to save response')
    }
  }

  async function addComment(rfiId, comment, isInternal = true) {
    try {
      await supabase.from('rfi_comments').insert({
        rfi_id: rfiId,
        comment: comment,
        comment_by: 'User', // In real app, use logged-in user
        comment_by_type: 'internal',
        is_internal: isInternal
      })
      loadRfis()
    } catch (error) {
      console.error('Error adding comment:', error)
    }
  }

  async function updateStatus(rfiId, status) {
    try {
      await supabase
        .from('rfis')
        .update({ status })
        .eq('id', rfiId)
      loadRfis()
    } catch (error) {
      console.error('Error updating status:', error)
    }
  }

  function resetForm() {
    setFormData({
      subject: '',
      question: '',
      category: 'scope_clarification',
      priority: 'normal',
      date_required: '',
      subcontractor_id: '',
      submitted_by_name: '',
      submitted_by_email: '',
      related_spec_sections: '',
      internal_notes: ''
    })
    setEditingRfi(null)
    setShowForm(false)
  }

  function editRfi(rfi) {
    setFormData({
      subject: rfi.subject,
      question: rfi.question,
      category: rfi.category || 'scope_clarification',
      priority: rfi.priority || 'normal',
      date_required: rfi.date_required || '',
      subcontractor_id: rfi.subcontractor_id || '',
      submitted_by_name: rfi.submitted_by_name || '',
      submitted_by_email: rfi.submitted_by_email || '',
      related_spec_sections: rfi.related_spec_sections || '',
      internal_notes: rfi.internal_notes || ''
    })
    setEditingRfi(rfi)
    setShowForm(true)
  }

  const filteredRfis = rfis.filter(rfi => {
    const matchesFilter = filter === 'all' ||
      (filter === 'open' && ['open', 'pending_response'].includes(rfi.status)) ||
      rfi.status === filter

    const matchesSearch = searchTerm === '' ||
      rfi.rfi_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rfi.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rfi.question.toLowerCase().includes(searchTerm.toLowerCase())

    return matchesFilter && matchesSearch
  })

  const stats = {
    total: rfis.length,
    open: rfis.filter(r => r.status === 'open').length,
    pending: rfis.filter(r => r.status === 'pending_response').length,
    answered: rfis.filter(r => r.status === 'answered').length,
    urgent: rfis.filter(r => r.priority === 'urgent' && ['open', 'pending_response'].includes(r.status)).length
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            RFIs & Clarifications
          </h3>
          <div className="flex gap-4 mt-1 text-sm">
            <span className="text-yellow-600">{stats.open} open</span>
            <span className="text-blue-600">{stats.pending} pending</span>
            <span className="text-green-600">{stats.answered} answered</span>
            {stats.urgent > 0 && (
              <span className="text-red-600 font-medium">{stats.urgent} urgent</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New RFI
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search RFIs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-10"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input w-full sm:w-40"
        >
          <option value="all">All RFIs</option>
          <option value="open">Open</option>
          <option value="pending_response">Pending</option>
          <option value="answered">Answered</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {/* RFI List */}
      {filteredRfis.length > 0 ? (
        <div className="space-y-3">
          {filteredRfis.map((rfi) => {
            const isOverdue = rfi.date_required && isPast(new Date(rfi.date_required)) && rfi.status !== 'answered'
            const daysUntilDue = rfi.date_required ? differenceInDays(new Date(rfi.date_required), new Date()) : null

            return (
              <div
                key={rfi.id}
                className={`border rounded-lg overflow-hidden ${isOverdue ? 'border-red-300' : 'border-gray-200'}`}
              >
                {/* RFI Header */}
                <div
                  className={`p-4 cursor-pointer hover:bg-gray-50 ${
                    isOverdue ? 'bg-red-50' : 'bg-white'
                  }`}
                  onClick={() => setExpandedRfi(expandedRfi === rfi.id ? null : rfi.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-medium text-gray-600">
                          {rfi.rfi_number}
                        </span>
                        <span className={`badge text-xs ${STATUS_COLORS[rfi.status]}`}>
                          {rfi.status.replace('_', ' ')}
                        </span>
                        <span className={`badge text-xs ${PRIORITY_COLORS[rfi.priority]}`}>
                          {rfi.priority}
                        </span>
                        {isOverdue && (
                          <span className="badge bg-red-100 text-red-700 text-xs flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Overdue
                          </span>
                        )}
                      </div>
                      <h4 className="font-medium text-gray-900">{rfi.subject}</h4>
                      <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                        {rfi.subcontractor && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {rfi.subcontractor.company_name}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(rfi.date_submitted || rfi.created_at), 'MMM d, yyyy')}
                        </span>
                        {rfi.date_required && (
                          <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600' : daysUntilDue <= 2 ? 'text-orange-600' : ''}`}>
                            <Clock className="h-3 w-3" />
                            Due {format(new Date(rfi.date_required), 'MMM d')}
                            {daysUntilDue !== null && daysUntilDue >= 0 && ` (${daysUntilDue}d)`}
                          </span>
                        )}
                        {rfi.comments?.length > 0 && (
                          <span className="flex items-center gap-1">
                            <MessageCircle className="h-3 w-3" />
                            {rfi.comments.length}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          editRfi(rfi)
                        }}
                        className="p-1.5 hover:bg-gray-200 rounded"
                      >
                        <Edit className="h-4 w-4 text-gray-500" />
                      </button>
                      {expandedRfi === rfi.id ? (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {expandedRfi === rfi.id && (
                  <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-4">
                    {/* Question */}
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 mb-2">Question</h5>
                      <p className="text-gray-900 whitespace-pre-wrap">{rfi.question}</p>
                    </div>

                    {/* Category and Spec Sections */}
                    <div className="flex gap-4 text-sm">
                      {rfi.category && (
                        <div>
                          <span className="text-gray-500">Category:</span>{' '}
                          <span className="text-gray-900">
                            {CATEGORIES.find(c => c.value === rfi.category)?.label || rfi.category}
                          </span>
                        </div>
                      )}
                      {rfi.related_spec_sections && (
                        <div>
                          <span className="text-gray-500">Spec Sections:</span>{' '}
                          <span className="text-gray-900">{rfi.related_spec_sections}</span>
                        </div>
                      )}
                    </div>

                    {/* Response */}
                    {rfi.response ? (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <h5 className="text-sm font-medium text-green-800 mb-2 flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Response
                          {rfi.date_responded && (
                            <span className="font-normal text-green-600">
                              ({format(new Date(rfi.date_responded), 'MMM d, yyyy')})
                            </span>
                          )}
                        </h5>
                        <p className="text-green-900 whitespace-pre-wrap">{rfi.response}</p>
                        {(rfi.has_cost_impact || rfi.has_schedule_impact) && (
                          <div className="mt-3 pt-3 border-t border-green-200 text-sm">
                            {rfi.has_cost_impact && (
                              <p className="text-orange-700">
                                <strong>Cost Impact:</strong> {rfi.cost_impact_description || 'Yes'}
                              </p>
                            )}
                            {rfi.has_schedule_impact && (
                              <p className="text-orange-700">
                                <strong>Schedule Impact:</strong> {rfi.schedule_impact_description || 'Yes'}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                        <h5 className="text-sm font-medium text-yellow-800 mb-3">Respond to RFI</h5>
                        <textarea
                          value={responseData.response}
                          onChange={(e) => setResponseData({ ...responseData, response: e.target.value })}
                          className="input min-h-[100px] mb-3"
                          placeholder="Enter your response..."
                        />
                        <div className="space-y-2 mb-3">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={responseData.distribute_to_all}
                              onChange={(e) => setResponseData({ ...responseData, distribute_to_all: e.target.checked })}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm text-gray-700">Distribute to all bidders</span>
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={responseData.has_cost_impact}
                              onChange={(e) => setResponseData({ ...responseData, has_cost_impact: e.target.checked })}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm text-gray-700">Has cost impact</span>
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={responseData.has_schedule_impact}
                              onChange={(e) => setResponseData({ ...responseData, has_schedule_impact: e.target.checked })}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm text-gray-700">Has schedule impact</span>
                          </label>
                        </div>
                        <button
                          onClick={() => handleResponse(rfi.id)}
                          disabled={!responseData.response.trim()}
                          className="btn btn-primary btn-sm"
                        >
                          Submit Response
                        </button>
                      </div>
                    )}

                    {/* Comments */}
                    {rfi.comments?.length > 0 && (
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Comments</h5>
                        <div className="space-y-2">
                          {rfi.comments.map(comment => (
                            <div key={comment.id} className="bg-white border border-gray-200 rounded p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-700">
                                  {comment.comment_by}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {format(new Date(comment.created_at), 'MMM d, h:mm a')}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600">{comment.comment}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Status Actions */}
                    <div className="flex gap-2 pt-2 border-t border-gray-200">
                      {rfi.status !== 'closed' && (
                        <button
                          onClick={() => updateStatus(rfi.id, 'closed')}
                          className="btn btn-secondary btn-sm"
                        >
                          Close RFI
                        </button>
                      )}
                      {rfi.status === 'open' && (
                        <button
                          onClick={() => updateStatus(rfi.id, 'pending_response')}
                          className="btn btn-secondary btn-sm"
                        >
                          Mark Pending
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">No RFIs found</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 text-primary-600 hover:text-primary-700 text-sm font-medium"
          >
            Create the first RFI
          </button>
        </div>
      )}

      {/* RFI Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingRfi ? `Edit ${editingRfi.rfi_number}` : 'New RFI'}
              </h3>
              <button onClick={resetForm} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject *
                </label>
                <input
                  type="text"
                  required
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="input"
                  placeholder="Brief description of the question"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Question *
                </label>
                <textarea
                  required
                  value={formData.question}
                  onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                  className="input min-h-[120px]"
                  placeholder="Detailed question or clarification request..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="input"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Priority
                  </label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="input"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Response Required By
                  </label>
                  <input
                    type="date"
                    value={formData.date_required}
                    onChange={(e) => setFormData({ ...formData, date_required: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Submitted By (Subcontractor)
                  </label>
                  <select
                    value={formData.subcontractor_id}
                    onChange={(e) => setFormData({ ...formData, subcontractor_id: e.target.value })}
                    className="input"
                  >
                    <option value="">Select subcontractor...</option>
                    {subcontractors.map(sub => (
                      <option key={sub.id} value={sub.id}>{sub.company_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Related Spec Sections
                </label>
                <input
                  type="text"
                  value={formData.related_spec_sections}
                  onChange={(e) => setFormData({ ...formData, related_spec_sections: e.target.value })}
                  className="input"
                  placeholder="e.g., 03 30 00, 09 21 16"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Internal Notes
                </label>
                <textarea
                  value={formData.internal_notes}
                  onChange={(e) => setFormData({ ...formData, internal_notes: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="Notes for internal reference (not shared)..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={resetForm} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingRfi ? 'Update RFI' : 'Create RFI'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

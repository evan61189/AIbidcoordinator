import { useState, useEffect } from 'react'
import {
  FileText,
  Plus,
  Search,
  Send,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  X,
  Edit,
  Users,
  Calendar,
  Download,
  Eye,
  Mail,
  Check
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  issued: 'bg-green-100 text-green-700',
  superseded: 'bg-yellow-100 text-yellow-700',
  void: 'bg-red-100 text-red-700'
}

const CHANGE_TYPES = [
  { value: 'scope_change', label: 'Scope Change' },
  { value: 'clarification', label: 'Clarification' },
  { value: 'drawing_revision', label: 'Drawing Revision' },
  { value: 'spec_revision', label: 'Specification Revision' },
  { value: 'schedule_change', label: 'Schedule Change' },
  { value: 'substitution', label: 'Substitution' }
]

export default function AddendaManager({ projectId, subcontractors = [], trades = [] }) {
  const [addenda, setAddenda] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingAddendum, setEditingAddendum] = useState(null)
  const [expandedAddendum, setExpandedAddendum] = useState(null)
  const [showAcknowledgments, setShowAcknowledgments] = useState(null)
  const [filter, setFilter] = useState('all')

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    summary: '',
    issue_date: new Date().toISOString().split('T')[0],
    effective_date: '',
    extends_bid_date: false,
    new_bid_date: '',
    affected_spec_sections: '',
    affected_drawings: '',
    change_types: [],
    affected_trades: [],
    distribute_to_all: true,
    distribution_list: [],
    internal_notes: ''
  })

  useEffect(() => {
    if (projectId) {
      loadAddenda()
    }
  }, [projectId])

  async function loadAddenda() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('addenda')
        .select(`
          *,
          acknowledgments:addendum_acknowledgments (
            id,
            subcontractor_id,
            email_sent,
            email_opened,
            acknowledged,
            acknowledged_at,
            subcontractor:subcontractors (id, company_name, email)
          )
        `)
        .eq('project_id', projectId)
        .order('addendum_number', { ascending: false })

      if (error) throw error
      setAddenda(data || [])
    } catch (error) {
      console.error('Error loading addenda:', error)
    } finally {
      setLoading(false)
    }
  }

  async function getNextAddendumNumber() {
    const { data } = await supabase
      .rpc('get_next_addendum_number', { p_project_id: projectId })
    return data || (addenda.length + 1)
  }

  async function handleSubmit(e) {
    e.preventDefault()

    try {
      const addendumNumber = editingAddendum?.addendum_number || await getNextAddendumNumber()

      const addendumData = {
        project_id: projectId,
        addendum_number: addendumNumber,
        title: formData.title,
        description: formData.description || null,
        summary: formData.summary || null,
        issue_date: formData.issue_date,
        effective_date: formData.effective_date || null,
        extends_bid_date: formData.extends_bid_date,
        new_bid_date: formData.new_bid_date || null,
        affected_spec_sections: formData.affected_spec_sections || null,
        affected_drawings: formData.affected_drawings || null,
        change_types: formData.change_types,
        affected_trades: formData.affected_trades,
        distribute_to_all: formData.distribute_to_all,
        distribution_list: formData.distribution_list,
        internal_notes: formData.internal_notes || null,
        status: 'draft'
      }

      if (editingAddendum) {
        await supabase
          .from('addenda')
          .update(addendumData)
          .eq('id', editingAddendum.id)
      } else {
        await supabase.from('addenda').insert(addendumData)
      }

      resetForm()
      loadAddenda()
    } catch (error) {
      console.error('Error saving addendum:', error)
      alert('Failed to save addendum')
    }
  }

  async function issueAddendum(addendumId) {
    try {
      // Update status to issued
      await supabase
        .from('addenda')
        .update({ status: 'issued' })
        .eq('id', addendumId)

      const addendum = addenda.find(a => a.id === addendumId)

      // Create acknowledgment records for all relevant subcontractors
      const subsToNotify = addendum.distribute_to_all
        ? subcontractors
        : subcontractors.filter(s => addendum.distribution_list.includes(s.id))

      const acknowledgments = subsToNotify.map(sub => ({
        addendum_id: addendumId,
        subcontractor_id: sub.id
      }))

      if (acknowledgments.length > 0) {
        await supabase
          .from('addendum_acknowledgments')
          .upsert(acknowledgments, { onConflict: 'addendum_id,subcontractor_id' })
      }

      loadAddenda()
    } catch (error) {
      console.error('Error issuing addendum:', error)
      alert('Failed to issue addendum')
    }
  }

  async function sendAddendumEmails(addendumId) {
    const addendum = addenda.find(a => a.id === addendumId)
    if (!addendum) return

    const unsentAcks = addendum.acknowledgments?.filter(ack => !ack.email_sent) || []

    for (const ack of unsentAcks) {
      if (!ack.subcontractor?.email) continue

      try {
        // In production, you'd call a serverless function to send the email
        // For now, we'll just mark it as sent
        await supabase
          .from('addendum_acknowledgments')
          .update({
            email_sent: true,
            email_sent_at: new Date().toISOString()
          })
          .eq('id', ack.id)
      } catch (error) {
        console.error('Error sending email:', error)
      }
    }

    loadAddenda()
  }

  async function markAcknowledged(acknowledgmentId) {
    try {
      await supabase
        .from('addendum_acknowledgments')
        .update({
          acknowledged: true,
          acknowledged_at: new Date().toISOString()
        })
        .eq('id', acknowledgmentId)
      loadAddenda()
    } catch (error) {
      console.error('Error marking acknowledged:', error)
    }
  }

  function resetForm() {
    setFormData({
      title: '',
      description: '',
      summary: '',
      issue_date: new Date().toISOString().split('T')[0],
      effective_date: '',
      extends_bid_date: false,
      new_bid_date: '',
      affected_spec_sections: '',
      affected_drawings: '',
      change_types: [],
      affected_trades: [],
      distribute_to_all: true,
      distribution_list: [],
      internal_notes: ''
    })
    setEditingAddendum(null)
    setShowForm(false)
  }

  function editAddendum(addendum) {
    setFormData({
      title: addendum.title,
      description: addendum.description || '',
      summary: addendum.summary || '',
      issue_date: addendum.issue_date,
      effective_date: addendum.effective_date || '',
      extends_bid_date: addendum.extends_bid_date || false,
      new_bid_date: addendum.new_bid_date || '',
      affected_spec_sections: addendum.affected_spec_sections || '',
      affected_drawings: addendum.affected_drawings || '',
      change_types: addendum.change_types || [],
      affected_trades: addendum.affected_trades || [],
      distribute_to_all: addendum.distribute_to_all ?? true,
      distribution_list: addendum.distribution_list || [],
      internal_notes: addendum.internal_notes || ''
    })
    setEditingAddendum(addendum)
    setShowForm(true)
  }

  function toggleChangeType(type) {
    const current = formData.change_types || []
    if (current.includes(type)) {
      setFormData({ ...formData, change_types: current.filter(t => t !== type) })
    } else {
      setFormData({ ...formData, change_types: [...current, type] })
    }
  }

  function toggleTrade(tradeId) {
    const current = formData.affected_trades || []
    if (current.includes(tradeId)) {
      setFormData({ ...formData, affected_trades: current.filter(t => t !== tradeId) })
    } else {
      setFormData({ ...formData, affected_trades: [...current, tradeId] })
    }
  }

  const filteredAddenda = addenda.filter(a =>
    filter === 'all' || a.status === filter
  )

  const stats = {
    total: addenda.length,
    draft: addenda.filter(a => a.status === 'draft').length,
    issued: addenda.filter(a => a.status === 'issued').length,
    pendingAcks: addenda.reduce((sum, a) => {
      const pending = a.acknowledgments?.filter(ack => !ack.acknowledged).length || 0
      return sum + pending
    }, 0)
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
            <FileText className="h-5 w-5" />
            Addenda
          </h3>
          <div className="flex gap-4 mt-1 text-sm">
            <span className="text-gray-600">{stats.draft} draft</span>
            <span className="text-green-600">{stats.issued} issued</span>
            {stats.pendingAcks > 0 && (
              <span className="text-orange-600">{stats.pendingAcks} pending acknowledgments</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New Addendum
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input w-40"
        >
          <option value="all">All Addenda</option>
          <option value="draft">Draft</option>
          <option value="issued">Issued</option>
          <option value="superseded">Superseded</option>
        </select>
      </div>

      {/* Addenda List */}
      {filteredAddenda.length > 0 ? (
        <div className="space-y-3">
          {filteredAddenda.map((addendum) => {
            const ackCount = addendum.acknowledgments?.filter(a => a.acknowledged).length || 0
            const totalAck = addendum.acknowledgments?.length || 0

            return (
              <div key={addendum.id} className="border border-gray-200 rounded-lg overflow-hidden">
                {/* Addendum Header */}
                <div
                  className="p-4 bg-white cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpandedAddendum(expandedAddendum === addendum.id ? null : addendum.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">
                          Addendum #{addendum.addendum_number}
                        </span>
                        <span className={`badge text-xs ${STATUS_COLORS[addendum.status]}`}>
                          {addendum.status}
                        </span>
                        {addendum.extends_bid_date && (
                          <span className="badge bg-orange-100 text-orange-700 text-xs">
                            Extends Bid Date
                          </span>
                        )}
                      </div>
                      <h4 className="font-medium text-gray-900">{addendum.title}</h4>
                      <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(addendum.issue_date), 'MMM d, yyyy')}
                        </span>
                        {addendum.status === 'issued' && totalAck > 0 && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {ackCount}/{totalAck} acknowledged
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {addendum.status === 'draft' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            editAddendum(addendum)
                          }}
                          className="p-1.5 hover:bg-gray-200 rounded"
                        >
                          <Edit className="h-4 w-4 text-gray-500" />
                        </button>
                      )}
                      {expandedAddendum === addendum.id ? (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {expandedAddendum === addendum.id && (
                  <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-4">
                    {/* Summary */}
                    {addendum.summary && (
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-1">Summary</h5>
                        <p className="text-gray-900">{addendum.summary}</p>
                      </div>
                    )}

                    {/* Description */}
                    {addendum.description && (
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-1">Description</h5>
                        <p className="text-gray-900 whitespace-pre-wrap">{addendum.description}</p>
                      </div>
                    )}

                    {/* Change Types */}
                    {addendum.change_types?.length > 0 && (
                      <div>
                        <h5 className="text-sm font-medium text-gray-700 mb-1">Change Types</h5>
                        <div className="flex flex-wrap gap-2">
                          {addendum.change_types.map(type => (
                            <span key={type} className="badge bg-blue-100 text-blue-700 text-xs">
                              {CHANGE_TYPES.find(t => t.value === type)?.label || type}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Affected Areas */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      {addendum.affected_drawings && (
                        <div>
                          <span className="text-gray-500">Affected Drawings:</span>
                          <span className="ml-2 text-gray-900">{addendum.affected_drawings}</span>
                        </div>
                      )}
                      {addendum.affected_spec_sections && (
                        <div>
                          <span className="text-gray-500">Affected Specs:</span>
                          <span className="ml-2 text-gray-900">{addendum.affected_spec_sections}</span>
                        </div>
                      )}
                      {addendum.new_bid_date && (
                        <div>
                          <span className="text-gray-500">New Bid Date:</span>
                          <span className="ml-2 text-gray-900 font-medium">
                            {format(new Date(addendum.new_bid_date), 'MMM d, yyyy')}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Acknowledgments */}
                    {addendum.status === 'issued' && addendum.acknowledgments?.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-sm font-medium text-gray-700">Acknowledgments</h5>
                          <button
                            onClick={() => setShowAcknowledgments(
                              showAcknowledgments === addendum.id ? null : addendum.id
                            )}
                            className="text-sm text-primary-600 hover:text-primary-700"
                          >
                            {showAcknowledgments === addendum.id ? 'Hide' : 'Show'} Details
                          </button>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                          <div
                            className="bg-green-500 h-2 rounded-full transition-all"
                            style={{ width: `${totalAck > 0 ? (ackCount / totalAck) * 100 : 0}%` }}
                          />
                        </div>

                        {showAcknowledgments === addendum.id && (
                          <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
                            {addendum.acknowledgments.map(ack => (
                              <div
                                key={ack.id}
                                className="flex items-center justify-between bg-white border border-gray-200 rounded p-2"
                              >
                                <div className="flex items-center gap-2">
                                  {ack.acknowledged ? (
                                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                                  ) : ack.email_sent ? (
                                    <Clock className="h-4 w-4 text-yellow-500" />
                                  ) : (
                                    <AlertCircle className="h-4 w-4 text-gray-400" />
                                  )}
                                  <span className="text-sm text-gray-900">
                                    {ack.subcontractor?.company_name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {ack.acknowledged ? (
                                    <span className="text-xs text-green-600">
                                      Acknowledged {format(new Date(ack.acknowledged_at), 'MMM d')}
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => markAcknowledged(ack.id)}
                                      className="btn btn-secondary btn-sm text-xs"
                                    >
                                      Mark Acknowledged
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-2 border-t border-gray-200">
                      {addendum.status === 'draft' && (
                        <>
                          <button
                            onClick={() => issueAddendum(addendum.id)}
                            className="btn btn-primary btn-sm flex items-center gap-1"
                          >
                            <Send className="h-4 w-4" />
                            Issue Addendum
                          </button>
                          <button
                            onClick={() => editAddendum(addendum)}
                            className="btn btn-secondary btn-sm flex items-center gap-1"
                          >
                            <Edit className="h-4 w-4" />
                            Edit
                          </button>
                        </>
                      )}
                      {addendum.status === 'issued' && (
                        <button
                          onClick={() => sendAddendumEmails(addendum.id)}
                          className="btn btn-secondary btn-sm flex items-center gap-1"
                        >
                          <Mail className="h-4 w-4" />
                          Send Notifications
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
          <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">No addenda found</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 text-primary-600 hover:text-primary-700 text-sm font-medium"
          >
            Create the first addendum
          </button>
        </div>
      )}

      {/* Addendum Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingAddendum ? `Edit Addendum #${editingAddendum.addendum_number}` : 'New Addendum'}
              </h3>
              <button onClick={resetForm} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input"
                  placeholder="e.g., Revised Mechanical Equipment Schedule"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Summary
                </label>
                <input
                  type="text"
                  value={formData.summary}
                  onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                  className="input"
                  placeholder="Brief one-line summary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input min-h-[100px]"
                  placeholder="Detailed description of changes..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Issue Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.issue_date}
                    onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Effective Date
                  </label>
                  <input
                    type="date"
                    value={formData.effective_date}
                    onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                    className="input"
                  />
                </div>
              </div>

              {/* Bid Date Extension */}
              <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.extends_bid_date}
                    onChange={(e) => setFormData({ ...formData, extends_bid_date: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium text-gray-700">This addendum extends the bid due date</span>
                </label>
                {formData.extends_bid_date && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      New Bid Due Date
                    </label>
                    <input
                      type="date"
                      value={formData.new_bid_date}
                      onChange={(e) => setFormData({ ...formData, new_bid_date: e.target.value })}
                      className="input"
                    />
                  </div>
                )}
              </div>

              {/* Change Types */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Types of Changes
                </label>
                <div className="flex flex-wrap gap-2">
                  {CHANGE_TYPES.map(type => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => toggleChangeType(type.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        (formData.change_types || []).includes(type.value)
                          ? 'bg-primary-600 text-white'
                          : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Affected Areas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Affected Drawings
                  </label>
                  <input
                    type="text"
                    value={formData.affected_drawings}
                    onChange={(e) => setFormData({ ...formData, affected_drawings: e.target.value })}
                    className="input"
                    placeholder="e.g., A1.01, A2.03, M1.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Affected Spec Sections
                  </label>
                  <input
                    type="text"
                    value={formData.affected_spec_sections}
                    onChange={(e) => setFormData({ ...formData, affected_spec_sections: e.target.value })}
                    className="input"
                    placeholder="e.g., 03 30 00, 09 21 16"
                  />
                </div>
              </div>

              {/* Internal Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Internal Notes
                </label>
                <textarea
                  value={formData.internal_notes}
                  onChange={(e) => setFormData({ ...formData, internal_notes: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="Notes for internal reference (not shared with subs)..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={resetForm} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingAddendum ? 'Update Addendum' : 'Create Addendum'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

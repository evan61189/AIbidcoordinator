import { useState, useEffect } from 'react'
import {
  FileText,
  Plus,
  Edit,
  Trash2,
  Copy,
  Star,
  Search,
  X,
  Save,
  Eye,
  Check
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

const TEMPLATE_TYPES = [
  { value: 'bid_invitation', label: 'Bid Invitation' },
  { value: 'bid_reminder', label: 'Bid Reminder' },
  { value: 'addendum_notification', label: 'Addendum Notification' },
  { value: 'rfi_response', label: 'RFI Response' },
  { value: 'award_notification', label: 'Award Notification' },
  { value: 'rejection_notification', label: 'Rejection Notification' },
  { value: 'general', label: 'General' },
  { value: 'custom', label: 'Custom' }
]

const AVAILABLE_VARIABLES = [
  { key: 'project_name', description: 'Project name' },
  { key: 'project_location', description: 'Project location' },
  { key: 'project_number', description: 'Project number' },
  { key: 'contact_name', description: 'Recipient contact name' },
  { key: 'company_name', description: 'Your company name' },
  { key: 'subcontractor_name', description: 'Subcontractor company name' },
  { key: 'due_date', description: 'Bid due date' },
  { key: 'sender_name', description: 'Sender name' },
  { key: 'sender_email', description: 'Sender email' },
  { key: 'sender_phone', description: 'Sender phone' },
  { key: 'custom_message', description: 'Custom message' },
  { key: 'bid_items', description: 'Bid items list' },
  { key: 'addendum_number', description: 'Addendum number' },
  { key: 'addendum_title', description: 'Addendum title' },
  { key: 'scope_description', description: 'Scope description' },
  { key: 'contract_amount', description: 'Contract amount' }
]

export default function EmailTemplates({ onSelect, onClose }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [showEditor, setShowEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [previewTemplate, setPreviewTemplate] = useState(null)
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    template_type: 'custom',
    subject: '',
    body_html: '',
    body_text: '',
    is_default: false
  })

  useEffect(() => {
    loadTemplates()
  }, [])

  async function loadTemplates() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('is_active', true)
        .order('template_type')
        .order('is_default', { ascending: false })
        .order('name')

      if (error) throw error
      setTemplates(data || [])
    } catch (error) {
      console.error('Error loading templates:', error)
    } finally {
      setLoading(false)
    }
  }

  async function saveTemplate(e) {
    e.preventDefault()
    setSaving(true)

    try {
      const templateData = {
        name: formData.name,
        description: formData.description || null,
        template_type: formData.template_type,
        subject: formData.subject,
        body_html: formData.body_html,
        body_text: formData.body_text || stripHtml(formData.body_html),
        is_default: formData.is_default
      }

      if (editingTemplate) {
        await supabase
          .from('email_templates')
          .update(templateData)
          .eq('id', editingTemplate.id)
      } else {
        await supabase.from('email_templates').insert(templateData)
      }

      // If setting as default, unset other defaults of same type
      if (formData.is_default) {
        await supabase
          .from('email_templates')
          .update({ is_default: false })
          .eq('template_type', formData.template_type)
          .neq('id', editingTemplate?.id || '')

        await supabase
          .from('email_templates')
          .update({ is_default: true })
          .eq('id', editingTemplate?.id || '')
      }

      resetForm()
      loadTemplates()
    } catch (error) {
      console.error('Error saving template:', error)
      alert('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  async function deleteTemplate(templateId) {
    if (!confirm('Are you sure you want to delete this template?')) return

    try {
      await supabase
        .from('email_templates')
        .update({ is_active: false })
        .eq('id', templateId)

      loadTemplates()
    } catch (error) {
      console.error('Error deleting template:', error)
      alert('Failed to delete template')
    }
  }

  async function duplicateTemplate(template) {
    try {
      await supabase.from('email_templates').insert({
        name: `${template.name} (Copy)`,
        description: template.description,
        template_type: template.template_type,
        subject: template.subject,
        body_html: template.body_html,
        body_text: template.body_text,
        is_default: false
      })

      loadTemplates()
    } catch (error) {
      console.error('Error duplicating template:', error)
      alert('Failed to duplicate template')
    }
  }

  function editTemplate(template) {
    setFormData({
      name: template.name,
      description: template.description || '',
      template_type: template.template_type,
      subject: template.subject,
      body_html: template.body_html,
      body_text: template.body_text || '',
      is_default: template.is_default
    })
    setEditingTemplate(template)
    setShowEditor(true)
  }

  function resetForm() {
    setFormData({
      name: '',
      description: '',
      template_type: 'custom',
      subject: '',
      body_html: '',
      body_text: '',
      is_default: false
    })
    setEditingTemplate(null)
    setShowEditor(false)
  }

  function stripHtml(html) {
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    return tmp.textContent || tmp.innerText || ''
  }

  function insertVariable(variable) {
    const textarea = document.getElementById('template-body')
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const text = formData.body_html
      const newText = text.substring(0, start) + `{{${variable}}}` + text.substring(end)
      setFormData({ ...formData, body_html: newText })
      // Set cursor position after variable
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + variable.length + 4
        textarea.focus()
      }, 0)
    }
  }

  function handleSelectTemplate(template) {
    if (onSelect) {
      // Increment usage count
      supabase.rpc('increment_template_usage', { p_template_id: template.id })
      onSelect(template)
    }
  }

  const filteredTemplates = templates.filter(t => {
    const matchesFilter = filter === 'all' || t.template_type === filter
    const matchesSearch = searchTerm === '' ||
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.subject.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesFilter && matchesSearch
  })

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Email Templates</h2>
              <p className="text-sm text-gray-500">
                {onSelect ? 'Select a template to use' : 'Manage your email templates'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!showEditor && (
              <button
                onClick={() => setShowEditor(true)}
                className="btn btn-primary btn-sm flex items-center gap-1"
              >
                <Plus className="h-4 w-4" />
                New Template
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {showEditor ? (
          /* Template Editor */
          <form onSubmit={saveTemplate} className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium text-gray-900">
                {editingTemplate ? 'Edit Template' : 'New Template'}
              </h3>
              <button
                type="button"
                onClick={resetForm}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input"
                  placeholder="e.g., Standard Bid Invitation"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Type *
                </label>
                <select
                  value={formData.template_type}
                  onChange={(e) => setFormData({ ...formData, template_type: e.target.value })}
                  className="input"
                >
                  {TEMPLATE_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input"
                placeholder="Brief description of when to use this template"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject Line *
              </label>
              <input
                type="text"
                required
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="input"
                placeholder="e.g., Invitation to Bid: {{project_name}}"
              />
            </div>

            {/* Variables Helper */}
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-700 mb-2">Available Variables</p>
              <div className="flex flex-wrap gap-1">
                {AVAILABLE_VARIABLES.map(v => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insertVariable(v.key)}
                    className="px-2 py-1 text-xs bg-white border border-gray-200 rounded hover:bg-gray-100 transition-colors"
                    title={v.description}
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Body (HTML) *
              </label>
              <textarea
                id="template-body"
                required
                value={formData.body_html}
                onChange={(e) => setFormData({ ...formData, body_html: e.target.value })}
                className="input min-h-[250px] font-mono text-sm"
                placeholder="<p>Dear {{contact_name}},</p>&#10;&#10;<p>Your email content here...</p>"
              />
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">Set as default template for this type</span>
            </label>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button type="button" onClick={resetForm} className="btn btn-secondary">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn btn-primary flex items-center gap-2"
              >
                {saving ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Template
              </button>
            </div>
          </form>
        ) : (
          /* Template List */
          <>
            {/* Filters */}
            <div className="p-4 border-b border-gray-200 space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search templates..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="input pl-10"
                  />
                </div>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="input w-full sm:w-48"
                >
                  <option value="all">All Types</option>
                  {TEMPLATE_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Template List */}
            <div className="flex-1 overflow-y-auto p-4">
              {filteredTemplates.length > 0 ? (
                <div className="space-y-3">
                  {filteredTemplates.map(template => (
                    <div
                      key={template.id}
                      className={`border rounded-lg p-4 hover:border-primary-300 transition-colors ${
                        onSelect ? 'cursor-pointer' : ''
                      }`}
                      onClick={() => onSelect && handleSelectTemplate(template)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-gray-900">{template.name}</h4>
                            {template.is_default && (
                              <span className="badge bg-yellow-100 text-yellow-700 text-xs flex items-center gap-1">
                                <Star className="h-3 w-3 fill-current" />
                                Default
                              </span>
                            )}
                          </div>
                          {template.description && (
                            <p className="text-sm text-gray-500 mb-2">{template.description}</p>
                          )}
                          <div className="flex items-center gap-4 text-xs text-gray-400">
                            <span className="badge bg-gray-100 text-gray-600">
                              {TEMPLATE_TYPES.find(t => t.value === template.template_type)?.label}
                            </span>
                            {template.use_count > 0 && (
                              <span>Used {template.use_count} times</span>
                            )}
                            {template.last_used_at && (
                              <span>Last used {format(new Date(template.last_used_at), 'MMM d')}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {onSelect && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSelectTemplate(template)
                              }}
                              className="btn btn-primary btn-sm flex items-center gap-1"
                            >
                              <Check className="h-4 w-4" />
                              Use
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setPreviewTemplate(template)
                            }}
                            className="p-2 hover:bg-gray-100 rounded"
                            title="Preview"
                          >
                            <Eye className="h-4 w-4 text-gray-500" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              editTemplate(template)
                            }}
                            className="p-2 hover:bg-gray-100 rounded"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4 text-gray-500" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              duplicateTemplate(template)
                            }}
                            className="p-2 hover:bg-gray-100 rounded"
                            title="Duplicate"
                          >
                            <Copy className="h-4 w-4 text-gray-500" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteTemplate(template.id)
                            }}
                            className="p-2 hover:bg-gray-100 rounded"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>No templates found</p>
                  <button
                    onClick={() => setShowEditor(true)}
                    className="mt-2 text-primary-600 hover:text-primary-700 text-sm"
                  >
                    Create your first template
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Preview Modal */}
        {previewTemplate && (
          <div className="absolute inset-0 bg-white flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">Preview: {previewTemplate.name}</h3>
              <button
                onClick={() => setPreviewTemplate(null)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-4">
                <label className="text-sm font-medium text-gray-500">Subject:</label>
                <p className="text-gray-900">{previewTemplate.subject}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Body:</label>
                <div
                  className="mt-2 p-4 border border-gray-200 rounded-lg bg-white prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: previewTemplate.body_html }}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
              <button
                onClick={() => setPreviewTemplate(null)}
                className="btn btn-secondary"
              >
                Close
              </button>
              {onSelect && (
                <button
                  onClick={() => {
                    handleSelectTemplate(previewTemplate)
                    setPreviewTemplate(null)
                  }}
                  className="btn btn-primary flex items-center gap-1"
                >
                  <Check className="h-4 w-4" />
                  Use This Template
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

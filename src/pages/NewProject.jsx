import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import { Link } from 'react-router-dom'
import { createProject } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function NewProject() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    project_number: '',
    description: '',
    location: '',
    client_name: '',
    client_contact: '',
    client_email: '',
    client_phone: '',
    estimated_value: '',
    bid_date: '',
    start_date: '',
    completion_date: '',
    notes: ''
  })

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (!form.name.trim()) {
      toast.error('Project name is required')
      return
    }

    setLoading(true)
    try {
      const projectData = {
        ...form,
        estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
        bid_date: form.bid_date || null,
        start_date: form.start_date || null,
        completion_date: form.completion_date || null
      }

      const project = await createProject(projectData)
      toast.success('Project created successfully')
      navigate(`/projects/${project.id}`)
    } catch (error) {
      console.error('Error creating project:', error)
      toast.error('Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        to="/projects"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Projects
      </Link>

      <div className="card">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">New Project</h1>
          <p className="text-gray-600">Create a new project to track bids and subcontractors</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Info */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="label">Project Name *</label>
              <input
                type="text"
                name="name"
                className="input"
                value={form.name}
                onChange={handleChange}
                placeholder="e.g., Downtown Office Building"
                required
              />
            </div>

            <div>
              <label className="label">Project Number</label>
              <input
                type="text"
                name="project_number"
                className="input"
                value={form.project_number}
                onChange={handleChange}
                placeholder="e.g., 2024-001"
              />
            </div>

            <div>
              <label className="label">Location</label>
              <input
                type="text"
                name="location"
                className="input"
                value={form.location}
                onChange={handleChange}
                placeholder="e.g., 123 Main St, City, State"
              />
            </div>

            <div className="md:col-span-2">
              <label className="label">Description</label>
              <textarea
                name="description"
                className="input"
                rows={3}
                value={form.description}
                onChange={handleChange}
                placeholder="Brief project description..."
              />
            </div>
          </div>

          {/* Client Info */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Client Information</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="label">Client/Owner Name</label>
                <input
                  type="text"
                  name="client_name"
                  className="input"
                  value={form.client_name}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label className="label">Contact Person</label>
                <input
                  type="text"
                  name="client_contact"
                  className="input"
                  value={form.client_contact}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label className="label">Client Email</label>
                <input
                  type="email"
                  name="client_email"
                  className="input"
                  value={form.client_email}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label className="label">Client Phone</label>
                <input
                  type="tel"
                  name="client_phone"
                  className="input"
                  value={form.client_phone}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>

          {/* Dates & Budget */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Schedule & Budget</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label">Bid Date</label>
                <input
                  type="date"
                  name="bid_date"
                  className="input"
                  value={form.bid_date}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label className="label">Start Date</label>
                <input
                  type="date"
                  name="start_date"
                  className="input"
                  value={form.start_date}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label className="label">Completion Date</label>
                <input
                  type="date"
                  name="completion_date"
                  className="input"
                  value={form.completion_date}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label className="label">Estimated Value ($)</label>
                <input
                  type="number"
                  name="estimated_value"
                  className="input"
                  value={form.estimated_value}
                  onChange={handleChange}
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="label">Notes</label>
            <textarea
              name="notes"
              className="input"
              rows={3}
              value={form.notes}
              onChange={handleChange}
              placeholder="Any additional notes..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Link to="/projects" className="btn btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              className="btn btn-primary flex items-center gap-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Creating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Create Project
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

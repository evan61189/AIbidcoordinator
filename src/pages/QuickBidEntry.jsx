import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Zap, Save, Plus } from 'lucide-react'
import { fetchProjects, fetchBidItems, fetchSubcontractors, createBid, logCommunication } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function QuickBidEntry() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState([])
  const [bidItems, setBidItems] = useState([])
  const [subcontractors, setSubcontractors] = useState([])
  const [selectedProject, setSelectedProject] = useState('')
  const [addAnother, setAddAnother] = useState(false)

  const [form, setForm] = useState({
    bid_item_id: '',
    subcontractor_id: '',
    amount: '',
    includes: '',
    excludes: '',
    clarifications: '',
    lead_time: '',
    notes: '',
    comm_type: 'phone',
    contact_person: ''
  })

  useEffect(() => {
    loadInitialData()
  }, [])

  useEffect(() => {
    if (selectedProject) {
      loadBidItems(selectedProject)
    } else {
      setBidItems([])
    }
  }, [selectedProject])

  async function loadInitialData() {
    try {
      const [projectsData, subsData] = await Promise.all([
        fetchProjects('bidding'),
        fetchSubcontractors()
      ])
      setProjects(projectsData || [])
      setSubcontractors(subsData || [])
    } catch (error) {
      console.error('Error loading data:', error)
    }
  }

  async function loadBidItems(projectId) {
    try {
      const data = await fetchBidItems(projectId)
      setBidItems(data?.filter(item => item.status === 'open') || [])
    } catch (error) {
      console.error('Error loading bid items:', error)
    }
  }

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (!form.bid_item_id || !form.subcontractor_id) {
      toast.error('Please select a bid item and subcontractor')
      return
    }

    setLoading(true)
    try {
      // Create bid
      await createBid({
        bid_item_id: form.bid_item_id,
        subcontractor_id: form.subcontractor_id,
        amount: form.amount ? parseFloat(form.amount) : null,
        includes: form.includes || null,
        excludes: form.excludes || null,
        clarifications: form.clarifications || null,
        lead_time: form.lead_time || null,
        notes: form.notes || null,
        status: 'submitted',
        submitted_at: new Date().toISOString()
      })

      // Log communication
      const bidItem = bidItems.find(i => i.id === form.bid_item_id)
      await logCommunication({
        subcontractor_id: form.subcontractor_id,
        project_id: selectedProject,
        comm_type: form.comm_type,
        direction: 'inbound',
        subject: `Bid received for ${bidItem?.description?.substring(0, 50) || 'bid item'}`,
        content: `Amount: $${form.amount || 'N/A'}\nIncludes: ${form.includes || 'N/A'}\nExcludes: ${form.excludes || 'N/A'}`,
        contact_person: form.contact_person || null
      })

      toast.success('Bid entered successfully')

      if (addAnother) {
        // Reset form but keep project selected
        setForm(prev => ({
          ...prev,
          bid_item_id: '',
          subcontractor_id: '',
          amount: '',
          includes: '',
          excludes: '',
          clarifications: '',
          lead_time: '',
          notes: '',
          contact_person: ''
        }))
      } else {
        navigate(`/projects/${selectedProject}`)
      }
    } catch (error) {
      console.error('Error saving bid:', error)
      toast.error('Failed to save bid')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        to="/bids"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Bids
      </Link>

      <div className="card">
        <div className="p-6 border-b border-gray-200 bg-orange-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Zap className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Quick Bid Entry</h1>
              <p className="text-gray-600">Enter bids received by phone, fax, or in-person</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Project & Bid Item Selection */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Project *</label>
              <select
                className="input"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                required
              >
                <option value="">Select project...</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Bid Item *</label>
              <select
                name="bid_item_id"
                className="input"
                value={form.bid_item_id}
                onChange={handleChange}
                required
                disabled={!selectedProject}
              >
                <option value="">Select bid item...</option>
                {bidItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.trade?.name} - {item.description.substring(0, 40)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Subcontractor */}
          <div>
            <label className="label">Subcontractor *</label>
            <select
              name="subcontractor_id"
              className="input"
              value={form.subcontractor_id}
              onChange={handleChange}
              required
            >
              <option value="">Select subcontractor...</option>
              {subcontractors.map(sub => (
                <option key={sub.id} value={sub.id}>
                  {sub.company_name}
                </option>
              ))}
            </select>
          </div>

          {/* Bid Amount */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Bid Amount ($)</label>
              <input
                type="number"
                name="amount"
                className="input"
                value={form.amount}
                onChange={handleChange}
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="label">Lead Time</label>
              <input
                type="text"
                name="lead_time"
                className="input"
                value={form.lead_time}
                onChange={handleChange}
                placeholder="e.g., 4-6 weeks"
              />
            </div>
          </div>

          {/* Inclusions/Exclusions */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">Includes</label>
              <textarea
                name="includes"
                className="input"
                rows={3}
                value={form.includes}
                onChange={handleChange}
                placeholder="What's included in the bid..."
              />
            </div>

            <div>
              <label className="label">Excludes</label>
              <textarea
                name="excludes"
                className="input"
                rows={3}
                value={form.excludes}
                onChange={handleChange}
                placeholder="What's excluded from the bid..."
              />
            </div>
          </div>

          {/* Clarifications */}
          <div>
            <label className="label">Clarifications / Notes</label>
            <textarea
              name="clarifications"
              className="input"
              rows={2}
              value={form.clarifications}
              onChange={handleChange}
              placeholder="Any clarifications or assumptions..."
            />
          </div>

          {/* Communication Log */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Communication Log</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="label">How was the bid received?</label>
                <select
                  name="comm_type"
                  className="input"
                  value={form.comm_type}
                  onChange={handleChange}
                >
                  <option value="phone">Phone Call</option>
                  <option value="email">Email</option>
                  <option value="meeting">In-Person</option>
                </select>
              </div>

              <div>
                <label className="label">Contact Person</label>
                <input
                  type="text"
                  name="contact_person"
                  className="input"
                  value={form.contact_person}
                  onChange={handleChange}
                  placeholder="Who provided the bid"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={addAnother}
                onChange={(e) => setAddAnother(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">Add another bid</span>
            </label>

            <div className="flex gap-3">
              <Link to="/bids" className="btn btn-secondary">
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
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save Bid
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

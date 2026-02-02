import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Mail, Sparkles, CheckCircle2, AlertCircle, Save } from 'lucide-react'
import { fetchProjects, fetchBidItems, fetchSubcontractors, createBid, createSubcontractor, logCommunication } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function EmailParser() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [emailContent, setEmailContent] = useState('')
  const [selectedProject, setSelectedProject] = useState('')
  const [parsedData, setParsedData] = useState(null)
  const [projects, setProjects] = useState([])
  const [bidItems, setBidItems] = useState([])
  const [subcontractors, setSubcontractors] = useState([])

  // Form state for saving
  const [form, setForm] = useState({
    bid_item_id: '',
    subcontractor_id: '',
    create_new_sub: false,
    new_sub_name: '',
    amount: '',
    includes: '',
    excludes: '',
    clarifications: '',
    lead_time: ''
  })

  useEffect(() => {
    loadInitialData()
  }, [])

  useEffect(() => {
    if (selectedProject) {
      loadBidItems(selectedProject)
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

  async function parseEmail() {
    if (!emailContent.trim()) {
      toast.error('Please paste email content')
      return
    }

    setParsing(true)
    try {
      const response = await fetch('/api/parse-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_content: emailContent,
          project_id: selectedProject || null
        })
      })

      if (!response.ok) {
        throw new Error('Failed to parse email')
      }

      const data = await response.json()
      setParsedData(data)

      // Pre-fill form with parsed data
      setForm(prev => ({
        ...prev,
        amount: data.bid_data?.amount || '',
        includes: data.bid_data?.includes || '',
        excludes: data.bid_data?.excludes || '',
        clarifications: data.bid_data?.clarifications || '',
        lead_time: data.bid_data?.lead_time || '',
        new_sub_name: data.sender_info?.company_name || ''
      }))

      // Check if we found a matching subcontractor
      if (data.suggested_matches?.subcontractor) {
        setForm(prev => ({
          ...prev,
          subcontractor_id: data.suggested_matches.subcontractor.id
        }))
      }

      setStep(2)
    } catch (error) {
      console.error('Error parsing email:', error)
      toast.error('Failed to parse email. Using rule-based extraction.')

      // Fallback to simple rule-based extraction
      const fallbackData = extractBasicBidInfo(emailContent)
      setParsedData(fallbackData)
      setForm(prev => ({
        ...prev,
        ...fallbackData.bid_data
      }))
      setStep(2)
    } finally {
      setParsing(false)
    }
  }

  function extractBasicBidInfo(content) {
    // Simple rule-based extraction as fallback
    const amountMatch = content.match(/\$\s*([\d,]+(?:\.\d{2})?)/i)
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : null

    const emailMatch = content.match(/From:\s*(?:"?([^"<]+)"?\s*)?<?([^>\s]+@[^>\s]+)>?/i)
    const senderEmail = emailMatch ? emailMatch[2] : null
    const senderName = emailMatch ? emailMatch[1]?.trim() : null

    return {
      bid_data: {
        amount,
        includes: null,
        excludes: null,
        clarifications: null,
        lead_time: null
      },
      sender_info: {
        email: senderEmail,
        name: senderName,
        company_name: null
      },
      confidence: 0.3,
      suggested_matches: {}
    }
  }

  async function saveBid() {
    if (!form.bid_item_id) {
      toast.error('Please select a bid item')
      return
    }

    if (!form.subcontractor_id && !form.create_new_sub) {
      toast.error('Please select or create a subcontractor')
      return
    }

    setSaving(true)
    try {
      let subcontractorId = form.subcontractor_id

      // Create new subcontractor if needed
      if (form.create_new_sub && form.new_sub_name) {
        const newSub = await createSubcontractor({
          company_name: form.new_sub_name,
          email: parsedData?.sender_info?.email || null,
          contact_name: parsedData?.sender_info?.name || null
        })
        subcontractorId = newSub.id
      }

      // Create the bid
      await createBid({
        bid_item_id: form.bid_item_id,
        subcontractor_id: subcontractorId,
        amount: form.amount ? parseFloat(form.amount) : null,
        includes: form.includes || null,
        excludes: form.excludes || null,
        clarifications: form.clarifications || null,
        lead_time: form.lead_time || null,
        status: 'submitted',
        submitted_at: new Date().toISOString()
      })

      // Log communication
      await logCommunication({
        subcontractor_id: subcontractorId,
        project_id: selectedProject,
        comm_type: 'email',
        direction: 'inbound',
        subject: 'Bid received via email parse',
        content: emailContent.substring(0, 2000)
      })

      toast.success('Bid saved successfully')
      navigate(`/projects/${selectedProject}`)
    } catch (error) {
      console.error('Error saving bid:', error)
      toast.error('Failed to save bid')
    } finally {
      setSaving(false)
    }
  }

  const confidenceColor = (parsedData?.confidence || 0) >= 0.7 ? 'text-green-600' :
                          (parsedData?.confidence || 0) >= 0.4 ? 'text-yellow-600' : 'text-red-600'

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      <div className="card">
        <div className="p-6 border-b border-gray-200 bg-blue-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Mail className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">AI Email Parser</h1>
              <p className="text-gray-600">Extract bid information from forwarded emails using AI</p>
            </div>
          </div>
        </div>

        {step === 1 && (
          <div className="p-6 space-y-6">
            <div>
              <label className="label">Project (optional)</label>
              <select
                className="input"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
              >
                <option value="">Auto-detect from email</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Selecting a project helps match bid items more accurately
              </p>
            </div>

            <div>
              <label className="label">Email Content</label>
              <textarea
                className="input font-mono text-sm"
                rows={12}
                value={emailContent}
                onChange={(e) => setEmailContent(e.target.value)}
                placeholder="Paste the full email content here, including headers (From, Subject, etc.)...

Example:
From: john@abcelectric.com
Subject: Bid for Downtown Office Building - Electrical

Dear [Your Name],

Please find our bid for the electrical work as follows:

Total Amount: $145,000.00

Includes:
- All electrical rough-in and finish
- Panel installation
- Light fixtures

Excludes:
- Fire alarm system
- Low voltage wiring

Lead time: 4-6 weeks

Best regards,
John Smith
ABC Electric Inc."
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={parseEmail}
                className="btn btn-primary flex items-center gap-2"
                disabled={parsing || !emailContent.trim()}
              >
                {parsing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Parsing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Parse with AI
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {step === 2 && parsedData && (
          <div className="p-6 space-y-6">
            {/* Parsed Results */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Parsed Information
                </h3>
                <span className={`text-sm font-medium ${confidenceColor}`}>
                  {Math.round((parsedData.confidence || 0) * 100)}% confidence
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm text-gray-500">Sender</p>
                  <p className="font-medium">{parsedData.sender_info?.company_name || parsedData.sender_info?.name || 'Unknown'}</p>
                  {parsedData.sender_info?.email && (
                    <p className="text-sm text-gray-600">{parsedData.sender_info.email}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500">Amount</p>
                  <p className="font-medium text-lg">
                    {parsedData.bid_data?.amount
                      ? `$${Number(parsedData.bid_data.amount).toLocaleString()}`
                      : 'Not found'}
                  </p>
                </div>
              </div>
            </div>

            {/* Form to save */}
            <div className="space-y-4">
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
                    className="input"
                    value={form.bid_item_id}
                    onChange={(e) => setForm(prev => ({ ...prev, bid_item_id: e.target.value }))}
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

              {/* Subcontractor Selection */}
              <div>
                <label className="label">Subcontractor *</label>
                {!form.create_new_sub ? (
                  <div className="space-y-2">
                    <select
                      className="input"
                      value={form.subcontractor_id}
                      onChange={(e) => setForm(prev => ({ ...prev, subcontractor_id: e.target.value }))}
                    >
                      <option value="">Select subcontractor...</option>
                      {subcontractors.map(sub => (
                        <option key={sub.id} value={sub.id}>
                          {sub.company_name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="text-sm text-primary-600 hover:underline"
                      onClick={() => setForm(prev => ({ ...prev, create_new_sub: true, subcontractor_id: '' }))}
                    >
                      + Create new subcontractor
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      className="input"
                      value={form.new_sub_name}
                      onChange={(e) => setForm(prev => ({ ...prev, new_sub_name: e.target.value }))}
                      placeholder="Company name"
                    />
                    <button
                      type="button"
                      className="text-sm text-primary-600 hover:underline"
                      onClick={() => setForm(prev => ({ ...prev, create_new_sub: false, new_sub_name: '' }))}
                    >
                      Select existing subcontractor
                    </button>
                  </div>
                )}
              </div>

              {/* Editable Fields */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Amount ($)</label>
                  <input
                    type="number"
                    className="input"
                    value={form.amount}
                    onChange={(e) => setForm(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Lead Time</label>
                  <input
                    type="text"
                    className="input"
                    value={form.lead_time}
                    onChange={(e) => setForm(prev => ({ ...prev, lead_time: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Includes</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={form.includes}
                    onChange={(e) => setForm(prev => ({ ...prev, includes: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Excludes</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={form.excludes}
                    onChange={(e) => setForm(prev => ({ ...prev, excludes: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-4 border-t">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep(1)}
              >
                Back
              </button>
              <button
                onClick={saveBid}
                className="btn btn-success flex items-center gap-2"
                disabled={saving}
              >
                {saving ? (
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
        )}
      </div>
    </div>
  )
}

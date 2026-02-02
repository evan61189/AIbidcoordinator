import { useState, useEffect } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Upload, FileImage, Sparkles, Plus, Check, X,
  AlertTriangle, Loader2, Eye, Trash2
} from 'lucide-react'
import { fetchProjects, fetchTrades, createBidItem } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function DrawingAnalysis() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState(1)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [projects, setProjects] = useState([])
  const [trades, setTrades] = useState([])
  const [selectedProject, setSelectedProject] = useState(searchParams.get('project') || '')
  const [drawingType, setDrawingType] = useState('architectural')
  const [additionalContext, setAdditionalContext] = useState('')

  const [uploadedImages, setUploadedImages] = useState([])
  const [analysisResult, setAnalysisResult] = useState(null)
  const [selectedItems, setSelectedItems] = useState([])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [projectsData, tradesData] = await Promise.all([
        fetchProjects('bidding'),
        fetchTrades()
      ])
      setProjects(projectsData || [])
      setTrades(tradesData || [])
    } catch (error) {
      console.error('Error loading data:', error)
    }
  }

  async function handleFileUpload(e) {
    const files = Array.from(e.target.files)
    const validFiles = files.filter(file =>
      file.type.startsWith('image/') || file.type === 'application/pdf'
    )

    if (validFiles.length !== files.length) {
      toast.error('Some files were skipped. Only images and PDFs are supported.')
    }

    // Convert files to base64
    const imagePromises = validFiles.slice(0, 30).map(file => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          resolve({
            name: file.name,
            type: file.type,
            data: reader.result,
            preview: file.type.startsWith('image/') ? reader.result : null
          })
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    })

    try {
      const images = await Promise.all(imagePromises)
      setUploadedImages(prev => [...prev, ...images].slice(0, 30))
    } catch (error) {
      toast.error('Error reading files')
    }
  }

  function removeImage(index) {
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
  }

  async function analyzeDrawings() {
    if (uploadedImages.length === 0) {
      toast.error('Please upload at least one drawing')
      return
    }

    if (!selectedProject) {
      toast.error('Please select a project')
      return
    }

    setAnalyzing(true)
    try {
      const response = await fetch('/api/analyze-drawings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: uploadedImages.map(img => ({
            data: img.data,
            media_type: img.type
          })),
          project_name: projects.find(p => p.id === selectedProject)?.name,
          drawing_type: drawingType,
          additional_context: additionalContext
        })
      })

      if (!response.ok) {
        throw new Error('Failed to analyze drawings')
      }

      const data = await response.json()
      setAnalysisResult(data.analysis)

      // Pre-select all items
      if (data.analysis?.bid_items) {
        setSelectedItems(data.analysis.bid_items.map((_, i) => i))
      }

      setStep(2)
      toast.success(`Identified ${data.analysis?.bid_items?.length || 0} bid items`)
    } catch (error) {
      console.error('Error analyzing drawings:', error)
      toast.error('Failed to analyze drawings. Please try again.')
    } finally {
      setAnalyzing(false)
    }
  }

  function toggleItemSelection(index) {
    setSelectedItems(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index]
    )
  }

  function toggleSelectAll() {
    if (selectedItems.length === analysisResult?.bid_items?.length) {
      setSelectedItems([])
    } else {
      setSelectedItems(analysisResult.bid_items.map((_, i) => i))
    }
  }

  async function saveSelectedItems() {
    if (selectedItems.length === 0) {
      toast.error('Please select at least one item to save')
      return
    }

    setSaving(true)
    let savedCount = 0

    try {
      for (const index of selectedItems) {
        const item = analysisResult.bid_items[index]

        // Find matching trade
        const trade = trades.find(t =>
          t.division_code === item.division_code ||
          t.name.toLowerCase().includes(item.trade_name?.toLowerCase())
        )

        if (!trade) {
          console.warn(`No trade found for ${item.trade_name}`)
          continue
        }

        await createBidItem({
          project_id: selectedProject,
          trade_id: trade.id,
          item_number: item.item_number || null,
          description: item.description,
          scope_details: item.notes || null,
          quantity: item.quantity || null,
          unit: item.unit || null,
          status: 'open'
        })
        savedCount++
      }

      toast.success(`${savedCount} bid items created successfully`)
      navigate(`/projects/${selectedProject}`)
    } catch (error) {
      console.error('Error saving bid items:', error)
      toast.error(`Saved ${savedCount} items. Error saving remaining items.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        to={selectedProject ? `/projects/${selectedProject}` : '/projects'}
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <div className="card">
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Sparkles className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">AI Drawing Analysis</h1>
              <p className="text-gray-600">Upload drawings to automatically generate bid items by trade</p>
            </div>
          </div>
        </div>

        {step === 1 && (
          <div className="p-6 space-y-6">
            {/* Project Selection */}
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
                <label className="label">Drawing Type</label>
                <select
                  className="input"
                  value={drawingType}
                  onChange={(e) => setDrawingType(e.target.value)}
                >
                  <option value="architectural">Architectural</option>
                  <option value="structural">Structural</option>
                  <option value="mechanical">Mechanical (HVAC)</option>
                  <option value="electrical">Electrical</option>
                  <option value="plumbing">Plumbing</option>
                  <option value="civil">Civil / Site</option>
                  <option value="mixed">Mixed / Full Set</option>
                </select>
              </div>
            </div>

            {/* Additional Context */}
            <div>
              <label className="label">Additional Context (optional)</label>
              <textarea
                className="input"
                rows={2}
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder="e.g., 3-story office building, existing building renovation, focus on MEP systems..."
              />
            </div>

            {/* File Upload */}
            <div>
              <label className="label">Upload Drawings (up to 30 pages)</label>
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-primary-500 transition-colors cursor-pointer"
                onClick={() => document.getElementById('file-upload').click()}
              >
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Upload className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                <p className="text-gray-600 mb-1">Click to upload or drag and drop</p>
                <p className="text-sm text-gray-500">PNG, JPG, or PDF (max 30 pages)</p>
              </div>
            </div>

            {/* Uploaded Images Preview */}
            {uploadedImages.length > 0 && (
              <div>
                <label className="label">Uploaded Drawings ({uploadedImages.length}/30)</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {uploadedImages.map((img, index) => (
                    <div key={index} className="relative group">
                      <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden border">
                        {img.preview ? (
                          <img
                            src={img.preview}
                            alt={img.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <FileImage className="h-8 w-8 text-gray-400" />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeImage(index)}
                        className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <p className="text-xs text-gray-500 truncate mt-1">{img.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analyze Button */}
            <div className="flex justify-end pt-4">
              <button
                onClick={analyzeDrawings}
                className="btn btn-primary flex items-center gap-2"
                disabled={analyzing || uploadedImages.length === 0 || !selectedProject}
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing Drawings{uploadedImages.length > 10 ? ` (${Math.ceil(uploadedImages.length / 10)} batches)` : ''}...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Analyze with AI
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {step === 2 && analysisResult && (
          <div className="p-6 space-y-6">
            {/* Summary */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-2">Analysis Summary</h3>
              <p className="text-blue-800 text-sm">{analysisResult.drawing_summary}</p>
              {analysisResult.project_type && (
                <p className="text-blue-700 text-sm mt-1">
                  <strong>Project Type:</strong> {analysisResult.project_type}
                </p>
              )}
            </div>

            {/* Warnings */}
            {analysisResult.items_to_verify?.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  <h3 className="font-semibold text-yellow-900">Items to Verify</h3>
                </div>
                <ul className="text-sm text-yellow-800 list-disc list-inside">
                  {analysisResult.items_to_verify.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Bid Items Selection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">
                  Identified Bid Items ({analysisResult.bid_items?.length || 0})
                </h3>
                <button
                  onClick={toggleSelectAll}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  {selectedItems.length === analysisResult.bid_items?.length
                    ? 'Deselect All'
                    : 'Select All'}
                </button>
              </div>

              <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                {analysisResult.bid_items?.map((item, index) => (
                  <label
                    key={index}
                    className={`flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50 ${
                      selectedItems.includes(index) ? 'bg-primary-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(index)}
                      onChange={() => toggleItemSelection(index)}
                      className="mt-1 rounded border-gray-300"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="badge bg-gray-100 text-gray-700">
                          {item.division_code} - {item.trade_name}
                        </span>
                        {item.item_number && (
                          <span className="text-sm text-gray-500">#{item.item_number}</span>
                        )}
                      </div>
                      <p className="font-medium text-gray-900">{item.description}</p>
                      <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                        {item.quantity && (
                          <span>Qty: {item.quantity} {item.unit}</span>
                        )}
                        {item.notes && (
                          <span className="text-gray-500 truncate">{item.notes}</span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t">
              <button
                onClick={() => setStep(1)}
                className="btn btn-secondary"
              >
                Back to Upload
              </button>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">
                  {selectedItems.length} items selected
                </span>
                <button
                  onClick={saveSelectedItems}
                  className="btn btn-success flex items-center gap-2"
                  disabled={saving || selectedItems.length === 0}
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Add to Project
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

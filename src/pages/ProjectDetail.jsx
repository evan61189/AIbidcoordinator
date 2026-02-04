import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Edit, Plus, FileText, Users, DollarSign,
  Calendar, MapPin, Building2, Download, ChevronDown, ChevronRight, Trash2,
  Search, Mail, Check, X
} from 'lucide-react'
import { fetchProject, fetchTrades, createBidItem, fetchSubcontractors, createBid, supabase, fetchScopePackages } from '../lib/supabase'
import { BID_PACKAGE_TYPES, getPackageType } from '../lib/packageTypes'
import BidLeveling from '../components/BidLeveling'
import BidRounds from '../components/BidRounds'
import ProjectBidViews from '../components/ProjectBidViews'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export default function ProjectDetail() {
  const { id } = useParams()
  const [project, setProject] = useState(null)
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedTrades, setExpandedTrades] = useState({})
  const [showAddItem, setShowAddItem] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [subcontractors, setSubcontractors] = useState([])
  const [selectedItemsForDeletion, setSelectedItemsForDeletion] = useState([])
  const [deletingItems, setDeletingItems] = useState(false)

  useEffect(() => {
    loadProject()
    loadTrades()
  }, [id])

  async function loadProject() {
    try {
      const data = await fetchProject(id)
      setProject(data)

      // Auto-expand trades with bid items
      const expanded = {}
      data?.bid_items?.forEach(item => {
        if (item.trade) {
          expanded[item.trade.id] = true
        }
      })
      setExpandedTrades(expanded)
    } catch (error) {
      console.error('Error loading project:', error)
      toast.error('Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  async function loadTrades() {
    try {
      const data = await fetchTrades()
      setTrades(data || [])
    } catch (error) {
      console.error('Error loading trades:', error)
    }
  }

  async function loadSubcontractors() {
    try {
      const data = await fetchSubcontractors()
      setSubcontractors(data || [])
    } catch (error) {
      console.error('Error loading subcontractors:', error)
    }
  }

  // Toggle item selection for deletion
  function toggleItemSelection(itemId) {
    setSelectedItemsForDeletion(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    )
  }

  // Select all bid items for deletion
  function selectAllItems() {
    const allIds = project?.bid_items?.map(item => item.id) || []
    setSelectedItemsForDeletion(allIds)
  }

  // Clear selection
  function clearItemSelection() {
    setSelectedItemsForDeletion([])
  }

  // Delete selected bid items
  async function deleteSelectedItems() {
    if (selectedItemsForDeletion.length === 0) {
      toast.error('No items selected')
      return
    }

    const confirmMsg = `Are you sure you want to delete ${selectedItemsForDeletion.length} bid item(s)? This cannot be undone.`
    if (!window.confirm(confirmMsg)) return

    setDeletingItems(true)
    try {
      const { error } = await supabase
        .from('bid_items')
        .delete()
        .in('id', selectedItemsForDeletion)

      if (error) throw error

      toast.success(`Deleted ${selectedItemsForDeletion.length} bid item(s)`)
      setSelectedItemsForDeletion([])
      loadProject() // Refresh the project data
    } catch (error) {
      console.error('Error deleting items:', error)
      toast.error('Failed to delete items')
    } finally {
      setDeletingItems(false)
    }
  }

  // Delete a single bid item
  async function deleteBidItem(itemId) {
    if (!window.confirm('Are you sure you want to delete this bid item?')) return

    try {
      const { error } = await supabase
        .from('bid_items')
        .delete()
        .eq('id', itemId)

      if (error) throw error

      toast.success('Bid item deleted')
      loadProject()
    } catch (error) {
      console.error('Error deleting item:', error)
      toast.error('Failed to delete item')
    }
  }

  function toggleTrade(tradeId) {
    setExpandedTrades(prev => ({
      ...prev,
      [tradeId]: !prev[tradeId]
    }))
  }

  // Group bid items by trade
  const bidItemsByTrade = project?.bid_items?.reduce((acc, item) => {
    const tradeId = item.trade?.id
    if (!acc[tradeId]) {
      acc[tradeId] = {
        trade: item.trade,
        items: []
      }
    }
    acc[tradeId].items.push(item)
    return acc
  }, {}) || {}

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Project not found</h2>
        <Link to="/projects" className="text-primary-600 hover:underline mt-2 inline-block">
          Back to projects
        </Link>
      </div>
    )
  }

  const statusColors = {
    bidding: 'badge-primary',
    awarded: 'badge-success',
    in_progress: 'bg-purple-100 text-purple-800',
    completed: 'bg-gray-100 text-gray-800',
    lost: 'badge-danger'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            to="/projects"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Projects
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            <span className={`badge ${statusColors[project.status] || 'bg-gray-100 text-gray-800'}`}>
              {project.status.replace('_', ' ')}
            </span>
          </div>
          {project.project_number && (
            <p className="text-gray-600">#{project.project_number}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </button>
          <button className="btn btn-outline flex items-center gap-2">
            <Edit className="h-4 w-4" />
            Edit
          </button>
        </div>
      </div>

      {/* Project Info Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {project.location && (
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Location</p>
                <p className="font-medium text-gray-900">{project.location}</p>
              </div>
            </div>
          </div>
        )}

        {project.bid_date && (
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Bid Date</p>
                <p className="font-medium text-gray-900">
                  {format(new Date(project.bid_date), 'MMM d, yyyy')}
                </p>
              </div>
            </div>
          </div>
        )}

        {project.client_name && (
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Client</p>
                <p className="font-medium text-gray-900">{project.client_name}</p>
              </div>
            </div>
          </div>
        )}

        {project.estimated_value && (
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Estimated Value</p>
                <p className="font-medium text-gray-900">
                  ${Number(project.estimated_value).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Description */}
      {project.description && (
        <div className="card p-4">
          <h3 className="font-semibold text-gray-900 mb-2">Description</h3>
          <p className="text-gray-600 whitespace-pre-wrap">{project.description}</p>
        </div>
      )}

      {/* Project Bid Views - Bid Package, Division, Client */}
      <ProjectBidViews
        projectId={id}
        project={project}
        bidItems={project?.bid_items || []}
        onRefresh={loadProject}
        onAddBidItem={() => setShowAddItem(true)}
        onInviteSubs={() => {
          loadSubcontractors()
          setShowInviteModal(true)
        }}
      />

      {/* Bid Rounds - Manage pricing rounds and drawing versions */}
      <BidRounds projectId={id} projectName={project?.name} />

      {/* Add Bid Item Modal */}
      {showAddItem && (
        <AddBidItemModal
          projectId={id}
          trades={trades}
          bidDate={project.bid_date}
          onClose={() => setShowAddItem(false)}
          onSuccess={() => {
            setShowAddItem(false)
            loadProject()
          }}
        />
      )}

      {/* Invite Subcontractors Modal */}
      {showInviteModal && (
        <InviteSubsModal
          projectId={id}
          project={project}
          bidItems={project.bid_items || []}
          subcontractors={subcontractors}
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => {
            setShowInviteModal(false)
            loadProject()
          }}
        />
      )}
    </div>
  )
}

function AddBidItemModal({ projectId, trades, bidDate, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    trade_id: '',
    item_number: '',
    description: '',
    scope_details: '',
    quantity: '',
    unit: '',
    estimated_cost: '',
    bid_due_date: bidDate || ''
  })

  async function handleSubmit(e) {
    e.preventDefault()

    if (!form.trade_id || !form.description) {
      toast.error('Trade and description are required')
      return
    }

    setLoading(true)
    try {
      await createBidItem({
        project_id: projectId,
        ...form,
        estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : null,
        bid_due_date: form.bid_due_date || null
      })
      toast.success('Bid item added')
      onSuccess()
    } catch (error) {
      console.error('Error creating bid item:', error)
      toast.error('Failed to add bid item')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Add Bid Item</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid gap-4 grid-cols-2">
            <div className="col-span-2">
              <label className="label">Trade *</label>
              <select
                className="input"
                value={form.trade_id}
                onChange={(e) => setForm(prev => ({ ...prev, trade_id: e.target.value }))}
                required
              >
                <option value="">Select trade...</option>
                {trades.map(trade => (
                  <option key={trade.id} value={trade.id}>
                    {trade.division_code} - {trade.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Item Number</label>
              <input
                type="text"
                className="input"
                value={form.item_number}
                onChange={(e) => setForm(prev => ({ ...prev, item_number: e.target.value }))}
                placeholder="e.g., 03-01"
              />
            </div>

            <div>
              <label className="label">Due Date</label>
              <input
                type="date"
                className="input"
                value={form.bid_due_date}
                onChange={(e) => setForm(prev => ({ ...prev, bid_due_date: e.target.value }))}
              />
            </div>

            <div className="col-span-2">
              <label className="label">Description *</label>
              <input
                type="text"
                className="input"
                value={form.description}
                onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="e.g., Cast-in-place concrete foundations"
                required
              />
            </div>

            <div className="col-span-2">
              <label className="label">Scope Details</label>
              <textarea
                className="input"
                rows={2}
                value={form.scope_details}
                onChange={(e) => setForm(prev => ({ ...prev, scope_details: e.target.value }))}
                placeholder="Detailed scope of work..."
              />
            </div>

            <div>
              <label className="label">Quantity</label>
              <input
                type="text"
                className="input"
                value={form.quantity}
                onChange={(e) => setForm(prev => ({ ...prev, quantity: e.target.value }))}
                placeholder="e.g., 500"
              />
            </div>

            <div>
              <label className="label">Unit</label>
              <input
                type="text"
                className="input"
                value={form.unit}
                onChange={(e) => setForm(prev => ({ ...prev, unit: e.target.value }))}
                placeholder="e.g., CY, SF, EA"
              />
            </div>

            <div>
              <label className="label">Estimated Cost ($)</label>
              <input
                type="number"
                className="input"
                value={form.estimated_cost}
                onChange={(e) => setForm(prev => ({ ...prev, estimated_cost: e.target.value }))}
                min="0"
                step="0.01"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function InviteSubsModal({ projectId, bidItems, subcontractors, project, onClose, onSuccess }) {
  const [step, setStep] = useState(1) // 1: Review Bid Packages, 2: Select Subs, 3: Review & Send
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPackages, setSelectedPackages] = useState([]) // Package IDs to invite
  const [selectedSubs, setSelectedSubs] = useState([])
  const [loading, setLoading] = useState(false)
  const [sendEmails, setSendEmails] = useState(true)
  const [drawings, setDrawings] = useState([])
  const [selectedDrawings, setSelectedDrawings] = useState([])
  const [attachDrawings, setAttachDrawings] = useState(true)
  const [useDrawingLinks, setUseDrawingLinks] = useState(false)
  const [scopePackages, setScopePackages] = useState([])
  const [loadingPackages, setLoadingPackages] = useState(true)
  // Track item assignments - maps item ID to package ID (allows moving)
  const [itemAssignments, setItemAssignments] = useState({})

  // Load scope packages and drawings for this project
  useEffect(() => {
    async function loadData() {
      try {
        // Load scope packages
        const packages = await fetchScopePackages(projectId)
        setScopePackages(packages || [])

        // Build initial item assignments from packages
        const assignments = {}
        packages?.forEach(pkg => {
          pkg.items?.forEach(({ bid_item }) => {
            if (bid_item?.id) {
              assignments[bid_item.id] = pkg.id
            }
          })
        })
        setItemAssignments(assignments)

        // Select all packages by default
        setSelectedPackages((packages || []).map(p => p.id))
      } catch (error) {
        console.error('Error loading scope packages:', error)
      } finally {
        setLoadingPackages(false)
      }

      try {
        // Load drawings
        const { data } = await supabase
          .from('drawings')
          .select('id, original_filename, drawing_number, title, discipline, file_size, storage_url, is_current')
          .eq('project_id', projectId)
          .eq('is_current', true)
          .order('discipline')

        setDrawings(data || [])
        setSelectedDrawings((data || []).map(d => d.id))
      } catch (error) {
        console.error('Error loading drawings:', error)
      }
    }
    loadData()
  }, [projectId])

  // Get items for each package based on current assignments
  const getPackageItems = (packageId) => {
    return bidItems.filter(item => itemAssignments[item.id] === packageId)
  }

  // Get unassigned items
  const unassignedItems = bidItems.filter(item => !itemAssignments[item.id])

  // Move item to a different package
  const moveItemToPackage = (itemId, newPackageId) => {
    setItemAssignments(prev => ({
      ...prev,
      [itemId]: newPackageId || undefined
    }))
  }

  // Filter items by search
  const filterItems = (items) => {
    if (!searchQuery.trim()) return items
    const query = searchQuery.toLowerCase()
    return items.filter(item =>
      item.description?.toLowerCase().includes(query) ||
      item.trade?.name?.toLowerCase().includes(query) ||
      item.item_number?.toLowerCase().includes(query)
    )
  }

  // Get all selected items from selected packages
  const selectedItems = selectedPackages.flatMap(pkgId =>
    getPackageItems(pkgId).map(item => item.id)
  )

  // Get package type IDs from selected packages (normalize names to IDs)
  const normalizeToPackageTypeId = (name) => {
    if (!name) return null
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
    // Find matching package type
    const match = BID_PACKAGE_TYPES.find(pt =>
      pt.id === normalized ||
      pt.name.toLowerCase() === name.toLowerCase() ||
      pt.name.toLowerCase().replace(/[^a-z0-9]/g, '') === name.toLowerCase().replace(/[^a-z0-9]/g, '')
    )
    return match?.id || null
  }

  const selectedPackageTypeIds = [...new Set(
    selectedPackages
      .map(pkgId => scopePackages.find(p => p.id === pkgId)?.name)
      .map(normalizeToPackageTypeId)
      .filter(Boolean)
  )]

  // Get relevant subcontractors based on their package_types matching selected packages
  const relevantSubs = subcontractors.filter(sub =>
    sub.package_types?.some(pt => selectedPackageTypeIds.includes(pt))
  )

  // Group subcontractors by their package types
  const subsByPackageType = relevantSubs.reduce((acc, sub) => {
    sub.package_types?.forEach(typeId => {
      if (selectedPackageTypeIds.includes(typeId)) {
        const pkgType = getPackageType(typeId)
        if (!acc[typeId]) {
          acc[typeId] = { packageType: pkgType, subs: [] }
        }
        if (!acc[typeId].subs.find(s => s.id === sub.id)) {
          acc[typeId].subs.push(sub)
        }
      }
    })
    return acc
  }, {})

  function selectAllPackages() {
    setSelectedPackages(scopePackages.map(p => p.id))
  }

  function clearPackageSelection() {
    setSelectedPackages([])
  }

  function selectAllSubs() {
    setSelectedSubs(relevantSubs.map(sub => sub.id))
  }

  async function handleInvite() {
    if (selectedPackages.length === 0 || selectedItems.length === 0) {
      toast.error('Select at least one bid package with items')
      return
    }
    if (selectedSubs.length === 0) {
      toast.error('Select at least one subcontractor')
      return
    }

    setLoading(true)
    let successCount = 0
    let emailsSent = 0

    try {
      // Get selected items and subs data
      const selectedItemsData = selectedItems.map(id => bidItems.find(item => item.id === id))
      const selectedSubsData = selectedSubs.map(id => subcontractors.find(sub => sub.id === id))

      // Create bid invitations
      for (const itemId of selectedItems) {
        for (const subId of selectedSubs) {
          try {
            await createBid({
              bid_item_id: itemId,
              subcontractor_id: subId,
              status: 'invited',
              invitation_sent_at: new Date().toISOString()
            })
            successCount++
          } catch (err) {
            console.error('Error creating bid:', err)
          }
        }
      }

      // Send emails if enabled - one email per sub with ALL selected items
      if (sendEmails) {
        for (const sub of selectedSubsData) {
          if (!sub?.email) {
            console.log(`Skipping ${sub?.company_name} - no email`)
            continue
          }

          try {
            const response = await fetch('/api/send-bid-invitation', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to_email: sub.email,
                to_name: sub.contact_name || sub.company_name,
                subject: `Invitation to Bid: ${project?.name}`,
                project_name: project?.name,
                project_location: project?.location,
                bid_due_date: project?.bid_date,
                bid_items: selectedItemsData.map(item => ({
                  trade: item?.trade?.name || 'General',
                  description: item?.description || '',
                  quantity: item?.quantity || '',
                  unit: item?.unit || ''
                })),
                sender_company: 'Clipper Construction',
                // Tracking for reply matching
                project_id: project?.id,
                subcontractor_id: sub.id,
                bid_item_ids: selectedItemsData.map(item => item?.id).filter(Boolean),
                // Drawing attachments
                drawing_ids: attachDrawings ? selectedDrawings : [],
                include_drawing_links: useDrawingLinks
              })
            })

            const result = await response.json()
            if (response.ok) {
              emailsSent++
            } else {
              console.error(`Email failed for ${sub.email}:`, result.error)
              toast.error(`Failed to email ${sub.company_name}: ${result.error}`)
            }
          } catch (err) {
            console.error('Error sending email to', sub.email, err)
          }
        }
      }

      const msg = sendEmails
        ? `Created ${successCount} invitation(s), sent ${emailsSent} email(s)`
        : `Created ${successCount} invitation(s)`
      toast.success(msg)
      onSuccess()
    } catch (error) {
      console.error('Error creating invitations:', error)
      toast.error('Failed to create invitations')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Invite Subcontractors to Bid</h2>
            <p className="text-sm text-gray-500">
              {step === 1 && 'Step 1: Review and select bid packages'}
              {step === 2 && 'Step 2: Select subcontractors'}
              {step === 3 && 'Step 3: Review and send'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Step 1: Review Bid Packages */}
        {step === 1 && (
          <>
            <div className="p-4 border-b border-gray-200">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search items within packages..."
                  className="input pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={selectAllPackages}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  Select all {scopePackages.length} packages
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={clearPackageSelection}
                  className="text-sm text-gray-600 hover:text-gray-700"
                >
                  Clear selection
                </button>
                <span className="ml-auto text-sm text-gray-500">
                  {selectedPackages.length} packages, {selectedItems.length} items
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingPackages ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                  <span className="ml-2 text-gray-500">Loading bid packages...</span>
                </div>
              ) : scopePackages.length > 0 ? (
                <>
                  {scopePackages.map(pkg => {
                    const pkgItems = filterItems(getPackageItems(pkg.id))
                    const isSelected = selectedPackages.includes(pkg.id)
                    return (
                      <div key={pkg.id} className="mb-4">
                        <label className="flex items-center gap-2 mb-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPackages([...selectedPackages, pkg.id])
                              } else {
                                setSelectedPackages(selectedPackages.filter(id => id !== pkg.id))
                              }
                            }}
                            className="rounded border-gray-300"
                          />
                          <span className="font-semibold text-gray-900">{pkg.name}</span>
                          <span className="text-sm text-gray-500">({pkgItems.length} items)</span>
                        </label>
                        <div className={`border rounded-lg divide-y ${isSelected ? 'border-primary-300 bg-primary-50/30' : ''}`}>
                          {pkgItems.length > 0 ? (
                            pkgItems.map(item => (
                              <div key={item.id} className="p-3 hover:bg-gray-50">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      {item.item_number && (
                                        <span className="text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                          #{item.item_number}
                                        </span>
                                      )}
                                      <span className="font-medium text-gray-900">{item.description}</span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                                      {item.trade && (
                                        <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                                          {item.trade.name}
                                        </span>
                                      )}
                                      {item.quantity && <span>Qty: {item.quantity} {item.unit || ''}</span>}
                                    </div>
                                    {item.scope_details && (
                                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                                        {item.scope_details}
                                      </p>
                                    )}
                                  </div>
                                  <select
                                    value={pkg.id}
                                    onChange={(e) => moveItemToPackage(item.id, e.target.value)}
                                    className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
                                    title="Move to package"
                                  >
                                    {scopePackages.map(p => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                    <option value="">Unassigned</option>
                                  </select>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="p-3 text-center text-sm text-gray-400">
                              No items in this package
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Unassigned Items */}
                  {filterItems(unassignedItems).length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-orange-600">Unassigned Items</span>
                        <span className="text-sm text-gray-500">({filterItems(unassignedItems).length} items)</span>
                      </div>
                      <div className="border border-orange-200 rounded-lg divide-y bg-orange-50/30">
                        {filterItems(unassignedItems).map(item => (
                          <div key={item.id} className="p-3 hover:bg-orange-50">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  {item.item_number && (
                                    <span className="text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                      #{item.item_number}
                                    </span>
                                  )}
                                  <span className="font-medium text-gray-900">{item.description}</span>
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                                  {item.trade && (
                                    <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                                      {item.trade.name}
                                    </span>
                                  )}
                                  {item.quantity && <span>Qty: {item.quantity} {item.unit || ''}</span>}
                                </div>
                              </div>
                              <select
                                value=""
                                onChange={(e) => moveItemToPackage(item.id, e.target.value)}
                                className="text-xs border border-orange-300 rounded px-2 py-1 bg-white"
                                title="Assign to package"
                              >
                                <option value="">Select package...</option>
                                {scopePackages.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p className="mb-2">No bid packages created yet.</p>
                  <p className="text-sm">Use the "AI Auto-Generate" button on the Bid Package view to create packages.</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 2: Select Subcontractors */}
        {step === 2 && (
          <>
            <div className="p-4 border-b border-gray-200">
              <p className="text-sm text-gray-600 mb-2">
                Showing subcontractors for selected packages: {selectedPackageTypeIds.length} package type(s)
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAllSubs}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  Select all {relevantSubs.length} subs
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setSelectedSubs([])}
                  className="text-sm text-gray-600 hover:text-gray-700"
                >
                  Clear selection
                </button>
                <span className="ml-auto text-sm text-gray-500">
                  {selectedSubs.length} selected
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {Object.keys(subsByPackageType).length > 0 ? (
                Object.values(subsByPackageType).map(({ packageType, subs }) => (
                  <div key={packageType?.id || 'unknown'} className="mb-4">
                    <div className="font-medium text-gray-900 mb-2">
                      {packageType?.name || 'Other'}
                    </div>
                    <div className="border rounded-lg divide-y">
                      {subs.map(sub => (
                        <label
                          key={sub.id}
                          className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 ${
                            selectedSubs.includes(sub.id) ? 'bg-primary-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedSubs.includes(sub.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSubs([...selectedSubs, sub.id])
                              } else {
                                setSelectedSubs(selectedSubs.filter(id => id !== sub.id))
                              }
                            }}
                            className="rounded border-gray-300"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{sub.company_name}</span>
                              {sub.is_preferred && (
                                <span className="badge badge-success text-xs">Preferred</span>
                              )}
                            </div>
                            {sub.email && (
                              <p className="text-sm text-gray-500">{sub.email}</p>
                            )}
                          </div>
                          {sub.email ? (
                            <Mail className="h-4 w-4 text-green-500" />
                          ) : (
                            <span className="text-xs text-gray-400">No email</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No subcontractors found for the selected bid packages.
                  <br />
                  <span className="text-sm">Make sure subcontractors have matching package types set.</span>
                  <br />
                  <Link to="/subcontractors/new" className="text-primary-600 hover:underline">
                    Add subcontractors
                  </Link>
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 3: Review & Send */}
        {step === 3 && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-2">Summary</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• {selectedPackages.length} bid package(s) selected</li>
                <li>• {selectedItems.length} bid item(s) included</li>
                <li>• {selectedSubs.length} subcontractor(s) selected</li>
                <li>• {selectedItems.length * selectedSubs.length} total invitation(s) will be created</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-gray-900 mb-2">Selected Bid Packages</h3>
              <div className="border rounded-lg max-h-48 overflow-y-auto divide-y">
                {selectedPackages.map(pkgId => {
                  const pkg = scopePackages.find(p => p.id === pkgId)
                  const pkgItems = getPackageItems(pkgId)
                  return (
                    <div key={pkgId} className="p-3">
                      <div className="font-medium text-gray-900 mb-1">{pkg?.name}</div>
                      <ul className="text-sm text-gray-600 space-y-0.5 ml-3">
                        {pkgItems.slice(0, 5).map(item => (
                          <li key={item.id} className="list-disc list-inside">
                            {item.item_number && <span className="text-gray-400">#{item.item_number} </span>}
                            {item.description}
                          </li>
                        ))}
                        {pkgItems.length > 5 && (
                          <li className="text-gray-400 italic">...and {pkgItems.length - 5} more items</li>
                        )}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <h3 className="font-medium text-gray-900 mb-2">Selected Subcontractors</h3>
              <div className="border rounded-lg max-h-32 overflow-y-auto">
                {selectedSubs.map(id => {
                  const sub = subcontractors.find(s => s.id === id)
                  return (
                    <div key={id} className="p-2 border-b last:border-b-0 text-sm flex items-center justify-between">
                      <span>{sub?.company_name}</span>
                      {sub?.email ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {sub.email}
                        </span>
                      ) : (
                        <span className="text-gray-400">No email</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={sendEmails}
                onChange={(e) => setSendEmails(e.target.checked)}
                className="rounded border-gray-300"
              />
              <div>
                <span className="font-medium">Send email invitations</span>
                <p className="text-sm text-gray-500">
                  Automatically email bid requests to subcontractors with email addresses
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex justify-between items-center">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="btn btn-secondary"
              >
                Back
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            {step < 3 ? (
              <button
                className="btn btn-primary"
                onClick={() => setStep(step + 1)}
                disabled={step === 1 ? selectedPackages.length === 0 : selectedSubs.length === 0}
              >
                Continue ({step === 1 ? `${selectedPackages.length} packages` : `${selectedSubs.length} subs`})
              </button>
            ) : (
              <button
                className="btn btn-success flex items-center gap-2"
                onClick={handleInvite}
                disabled={loading || selectedItems.length === 0}
              >
                {loading ? (
                  'Sending...'
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    Send {selectedItems.length * selectedSubs.length} Invitation(s)
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

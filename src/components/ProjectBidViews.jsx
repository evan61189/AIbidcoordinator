import { useState, useEffect } from 'react'
import { supabase, fetchScopePackages, createScopePackage, updateScopePackage, deleteScopePackage, fetchApprovedPackageBidsForProject, fetchTrades, updateBidItem, deleteBidItem } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import {
  Package,
  Layers,
  FileText,
  Plus,
  Trash2,
  Edit,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  RefreshCw,
  Sparkles,
  Download,
  Printer,
  DollarSign,
  Percent,
  ArrowRight,
  Users,
  AlertTriangle,
  MoveHorizontal
} from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * ProjectBidViews Component
 * Toggle between three views:
 * 1. Bid Package View - How subcontractors bid (grouped by trade pairings)
 * 2. Division View - CSI MasterFormat divisions
 * 3. Client View - Customer-facing with markup, GC, OH&P
 */
export default function ProjectBidViews({ projectId, project, bidItems = [], onRefresh, onAddBidItem, onInviteSubs }) {
  const [activeView, setActiveView] = useState('package') // 'package', 'division', 'client'
  const [scopePackages, setScopePackages] = useState([])
  const [bids, setBids] = useState([])
  const [packageBids, setPackageBids] = useState([]) // Approved package-level bids
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState(null)
  const [creatingPackages, setCreatingPackages] = useState(false)
  const [showCreatePackage, setShowCreatePackage] = useState(false)
  const [editingPackage, setEditingPackage] = useState(null)
  const [expandedPackages, setExpandedPackages] = useState({})
  const [expandedDivisions, setExpandedDivisions] = useState({})

  // Division view - bid item management
  const [trades, setTrades] = useState([])
  const [editingBidItem, setEditingBidItem] = useState(null) // For move modal
  const [itemActionLoading, setItemActionLoading] = useState(null) // itemId being acted on

  // Client view state
  const [selectedBids, setSelectedBids] = useState({}) // bidItemId -> bid
  const [manualAmounts, setManualAmounts] = useState({}) // bidItemId -> manual amount (for items without bids)
  const [markupPercent, setMarkupPercent] = useState(0) // Hidden markup (applied to each line item, not shown separately)
  const [generalConditions, setGeneralConditions] = useState(0) // Goes under Division 01 - General Requirements
  const [overheadProfit, setOverheadProfit] = useState(0) // Separate line item at bottom
  const [contingency, setContingency] = useState(0)
  const [customLineItems, setCustomLineItems] = useState([])

  useEffect(() => {
    if (projectId) {
      loadData()
    }
  }, [projectId])

  async function loadData() {
    setLoading(true)
    try {
      // Load scope packages (returns empty array if table doesn't exist)
      const packagesData = await fetchScopePackages(projectId)
      setScopePackages(packagesData || [])

      // Load all trades for the move dropdown
      try {
        const tradesData = await fetchTrades()
        setTrades(tradesData || [])
      } catch (e) {
        console.warn('Could not load trades:', e.message)
      }

      // Load submitted bids (item-level)
      let projectBids = []
      try {
        const { data: bidsData, error: bidsError } = await supabase
          .from('bids')
          .select(`
            *,
            subcontractor:subcontractors (id, company_name),
            bid_item:bid_items (
              id, description, item_number,
              trade:trades (id, name, division_code)
            )
          `)
          .eq('status', 'submitted')

        if (!bidsError) {
          // Filter to this project
          projectBids = (bidsData || []).filter(b =>
            bidItems.some(item => item.id === b.bid_item?.id)
          )
        }
      } catch (e) {
        console.warn('Could not load bids:', e.message)
      }

      setBids(projectBids)

      // Load approved package bids
      let approvedPackageBids = []
      try {
        approvedPackageBids = await fetchApprovedPackageBidsForProject(projectId) || []
      } catch (e) {
        console.warn('Could not load package bids:', e.message)
      }
      setPackageBids(approvedPackageBids)

      // Auto-select lowest bids for client view (considering both item and package bids)
      autoSelectLowestBids(projectBids, approvedPackageBids, packagesData || [])
    } catch (error) {
      console.error('Error loading data:', error)
      // Don't show error toast for missing tables - just show empty state
    } finally {
      setLoading(false)
    }
  }

  function autoSelectLowestBids(projectBids, approvedPackageBids = [], packages = []) {
    const selected = {}
    const bidsByItem = {}

    // First, collect all item-level bids
    for (const bid of projectBids) {
      const itemId = bid.bid_item?.id
      if (!itemId) continue
      if (!bidsByItem[itemId]) bidsByItem[itemId] = []
      bidsByItem[itemId].push(bid)
    }

    // Then, add package-level bids as virtual item bids
    // For each package bid, distribute the amount across items in that package
    for (const pkgBid of approvedPackageBids) {
      const pkg = pkgBid.scope_package
      if (!pkg || !pkgBid.amount) continue

      // Get items in this package
      const packageItems = pkg.scope_package_items || []
      const itemCount = packageItems.length || 1

      // Distribute package amount across items (evenly for now, or could be proportional)
      const amountPerItem = pkgBid.amount / itemCount

      for (const pkgItem of packageItems) {
        const itemId = pkgItem.bid_item_id
        if (!itemId) continue
        if (!bidsByItem[itemId]) bidsByItem[itemId] = []

        // Add as a virtual bid for this item
        bidsByItem[itemId].push({
          id: `pkg-${pkgBid.id}-${itemId}`,
          amount: amountPerItem,
          subcontractor: pkgBid.subcontractor,
          isPackageBid: true,
          packageBidId: pkgBid.id,
          packageName: pkg.name,
          packageTotalAmount: pkgBid.amount,
          itemsInPackage: itemCount
        })
      }
    }

    // Select the lowest bid for each item
    for (const [itemId, itemBids] of Object.entries(bidsByItem)) {
      const sorted = itemBids
        .filter(b => b.amount && b.amount > 0)
        .sort((a, b) => a.amount - b.amount)
      if (sorted.length > 0) {
        selected[itemId] = sorted[0]
      }
    }
    setSelectedBids(selected)
  }

  // ==================== AI ANALYSIS ====================
  async function analyzeWithAI() {
    if (bidItems.length === 0) {
      toast.error('No bid items to analyze')
      return
    }

    setAnalyzing(true)
    try {
      const response = await fetch('/.netlify/functions/analyze-bid-packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidItems, bids })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Analysis failed')

      setAiSuggestions(result.analysis)
      toast.success(`AI suggested ${result.analysis.packages?.length || 0} bid packages`)
    } catch (error) {
      console.error('Error analyzing:', error)
      toast.error(error.message || 'Failed to analyze bid items')
    } finally {
      setAnalyzing(false)
    }
  }

  async function createFromSuggestion(suggestion) {
    if (creatingPackages) return // Prevent double-clicks
    setCreatingPackages(true)
    try {
      await createScopePackage(projectId, suggestion.name, suggestion.description, suggestion.bidItemIds)
      toast.success(`Created: ${suggestion.name}`)
      setAiSuggestions(prev => ({
        ...prev,
        packages: prev.packages.filter(p => p.name !== suggestion.name)
      }))
      loadData()
    } catch (error) {
      console.error('Error creating package:', error)
      toast.error('Failed to create package')
    } finally {
      setCreatingPackages(false)
    }
  }

  async function createAllSuggestions() {
    if (!aiSuggestions?.packages?.length || creatingPackages) return
    setCreatingPackages(true)
    // Capture suggestions and clear immediately to prevent double-clicks
    const packagesToCreate = [...aiSuggestions.packages]
    setAiSuggestions(null)

    let created = 0
    for (const suggestion of packagesToCreate) {
      try {
        await createScopePackage(projectId, suggestion.name, suggestion.description, suggestion.bidItemIds)
        created++
      } catch (error) {
        console.error('Error:', suggestion.name, error)
      }
    }
    toast.success(`Created ${created} packages`)
    setCreatingPackages(false)
    loadData()
  }

  // ==================== PACKAGE VIEW HELPERS ====================
  function togglePackage(pkgId) {
    setExpandedPackages(prev => ({ ...prev, [pkgId]: !prev[pkgId] }))
  }

  // Get bid items for a package using the single source of truth (bidItems prop)
  function getPackageItems(pkg) {
    const itemIds = new Set(pkg.items?.map(i => i.bid_item_id).filter(Boolean) || [])
    return bidItems.filter(item => itemIds.has(item.id))
  }

  function analyzePackage(pkg) {
    const packageItems = getPackageItems(pkg)
    const packageItemIds = new Set(packageItems.map(i => i.id))
    if (packageItemIds.size === 0) return { coverage: [], combinations: [] }

    const bidsBySubcontractor = {}
    for (const bid of bids) {
      if (!packageItemIds.has(bid.bid_item?.id)) continue
      const subId = bid.subcontractor?.id
      if (!subId) continue

      if (!bidsBySubcontractor[subId]) {
        bidsBySubcontractor[subId] = {
          subcontractor: bid.subcontractor,
          bids: [],
          coveredItemIds: new Set(),
          total: 0
        }
      }
      bidsBySubcontractor[subId].bids.push(bid)
      bidsBySubcontractor[subId].coveredItemIds.add(bid.bid_item.id)
      bidsBySubcontractor[subId].total += Number(bid.amount) || 0
    }

    const coverage = Object.values(bidsBySubcontractor).map(sub => ({
      ...sub,
      coveragePercent: (sub.coveredItemIds.size / packageItemIds.size) * 100,
      isComplete: sub.coveredItemIds.size === packageItemIds.size
    }))

    coverage.sort((a, b) => {
      if (a.isComplete !== b.isComplete) return b.isComplete ? 1 : -1
      return a.total - b.total
    })

    return { coverage }
  }

  async function handleDeletePackage(pkgId) {
    if (!confirm('Delete this package?')) return
    try {
      await deleteScopePackage(pkgId)
      toast.success('Package deleted')
      loadData()
    } catch (error) {
      toast.error('Failed to delete')
    }
  }

  async function handleDeleteAllPackages() {
    if (scopePackages.length === 0) {
      toast.error('No packages to delete')
      return
    }
    if (!confirm(`Delete all ${scopePackages.length} bid packages? This will allow you to re-run AI Auto-Generate cleanly.`)) return

    try {
      let deleted = 0
      for (const pkg of scopePackages) {
        await deleteScopePackage(pkg.id)
        deleted++
      }
      toast.success(`Deleted ${deleted} packages`)
      loadData()
    } catch (error) {
      console.error('Error deleting packages:', error)
      toast.error('Failed to delete some packages')
      loadData() // Refresh to show remaining packages
    }
  }

  // ==================== DIVISION VIEW HELPERS ====================
  function groupByDivision(includeMarkup = false) {
    const groups = {}
    for (const item of bidItems) {
      const divCode = item.trade?.division_code || '01'
      const divName = item.trade?.name || 'General Requirements'

      if (!groups[divCode]) {
        groups[divCode] = { code: divCode, name: divName, items: [], total: 0 }
      }

      const selectedBid = selectedBids[item.id]
      const baseAmount = getItemBaseAmount(item.id)
      // For client view, apply markup to each item
      const amount = includeMarkup ? getItemWithMarkup(item.id) : baseAmount
      const manualAmount = manualAmounts[item.id]

      // Get all bids for this item, including package bids as virtual bids
      const itemBids = bids.filter(b => b.bid_item?.id === item.id)

      // Also include package bids that cover this item
      const packageBidsForItem = packageBids.filter(pkgBid => {
        const pkgItems = pkgBid.scope_package?.scope_package_items || []
        return pkgItems.some(pi => pi.bid_item_id === item.id)
      }).map(pkgBid => {
        const pkgItems = pkgBid.scope_package?.scope_package_items || []
        const itemCount = pkgItems.length || 1
        return {
          id: `pkg-${pkgBid.id}`,
          amount: pkgBid.amount / itemCount,
          subcontractor: pkgBid.subcontractor,
          isPackageBid: true,
          packageName: pkgBid.scope_package?.name,
          packageTotalAmount: pkgBid.amount,
          itemsInPackage: itemCount
        }
      })

      groups[divCode].items.push({
        ...item,
        selectedBid,
        baseAmount,
        amount,
        manualAmount,
        allBids: [...itemBids, ...packageBidsForItem],
        isFromPackageBid: selectedBid?.isPackageBid
      })
      groups[divCode].total += amount
    }

    // Ensure Division 01 exists for General Conditions
    if (!groups['01']) {
      groups['01'] = { code: '01', name: 'General Requirements', items: [], total: 0 }
    }

    // Add General Conditions to Division 01 total (for client view)
    if (includeMarkup && generalConditions > 0) {
      groups['01'].total += generalConditions
      groups['01'].hasGeneralConditions = true
      groups['01'].generalConditionsAmount = generalConditions
    }

    return Object.values(groups).sort((a, b) => a.code.localeCompare(b.code))
  }

  function toggleDivision(divCode) {
    setExpandedDivisions(prev => ({ ...prev, [divCode]: !prev[divCode] }))
  }

  // Move a bid item to a different trade/division
  async function handleMoveBidItem(itemId, newTradeId) {
    if (itemActionLoading) return
    setItemActionLoading(itemId)
    try {
      console.log('Moving bid item:', itemId, 'to trade:', newTradeId)
      await updateBidItem(itemId, { trade_id: newTradeId })
      toast.success('Item moved to new division and removed from packages')
      setEditingBidItem(null)
      // Refresh parent FIRST to update bidItems (single source of truth)
      if (onRefresh) await onRefresh()
      // Then refresh local package data
      await loadData()
      console.log('Refresh completed after move')
    } catch (error) {
      console.error('Error moving item:', error)
      toast.error(`Failed to move item: ${error.message}`)
    } finally {
      setItemActionLoading(null)
    }
  }

  // Delete a bid item
  async function handleDeleteBidItem(item) {
    if (itemActionLoading) return
    if (!confirm(`Delete "${item.description}"? This will also remove it from any bid packages.`)) return

    setItemActionLoading(item.id)
    try {
      console.log('Deleting bid item from UI:', item.id, item.description)
      await deleteBidItem(item.id)
      toast.success('Bid item deleted')
      // Refresh parent FIRST to update bidItems (single source of truth)
      if (onRefresh) await onRefresh()
      // Then refresh local package data
      await loadData()
      console.log('Refresh completed after deletion')
    } catch (error) {
      console.error('Error deleting item:', error)
      toast.error(`Failed to delete item: ${error.message}`)
    } finally {
      setItemActionLoading(null)
    }
  }

  // ==================== CLIENT VIEW HELPERS ====================
  // Get the base amount for an item (bid or manual)
  function getItemBaseAmount(itemId) {
    const bid = selectedBids[itemId]
    if (bid?.amount > 0) return bid.amount
    return manualAmounts[itemId] || 0
  }

  // Get item amount WITH hidden markup applied
  function getItemWithMarkup(itemId) {
    const base = getItemBaseAmount(itemId)
    return base * (1 + markupPercent / 100)
  }

  // Subtotal of all bid items (with markup already applied to each)
  function getSubtotal() {
    let total = 0
    for (const item of bidItems) {
      total += getItemWithMarkup(item.id)
    }
    return total
  }

  // The markup is hidden - applied to each line item, not shown separately
  function getMarkupAmount() {
    let baseTotal = 0
    for (const item of bidItems) {
      baseTotal += getItemBaseAmount(item.id)
    }
    return baseTotal * (markupPercent / 100)
  }

  function getGrandTotal() {
    const subtotal = getSubtotal() // Already includes markup on each item
    const customTotal = customLineItems.reduce((sum, item) => sum + (item.amount || 0), 0)
    // GC is now included in General Requirements division, so we add it there
    // OH&P and Contingency remain as separate line items
    return subtotal + generalConditions + overheadProfit + contingency + customTotal
  }

  function updateManualAmount(itemId, amount) {
    setManualAmounts(prev => ({ ...prev, [itemId]: Number(amount) || 0 }))
  }

  function addCustomLineItem() {
    setCustomLineItems(prev => [...prev, { id: Date.now(), description: '', amount: 0 }])
  }

  function updateCustomLineItem(id, field, value) {
    setCustomLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, [field]: field === 'amount' ? Number(value) || 0 : value } : item
    ))
  }

  function removeCustomLineItem(id) {
    setCustomLineItems(prev => prev.filter(item => item.id !== id))
  }

  function handlePrint() {
    window.print()
  }

  function exportToCSV() {
    const divisions = groupByDivision(true) // Include markup in amounts
    const rows = [
      ['Division', 'Item', 'Amount'],
      ...divisions.flatMap(div => {
        const divRows = div.items.map(item => [
          `${div.code} - ${div.name}`,
          item.description,
          item.amount || 0
        ])
        // Add General Conditions under Division 01
        if (div.code === '01' && generalConditions > 0) {
          divRows.push([`${div.code} - ${div.name}`, 'General Conditions', generalConditions])
        }
        return divRows
      }),
      [],
      ['', 'Subtotal', getSubtotal()],
      // Markup is hidden - already included in line item amounts
      ...(overheadProfit > 0 ? [['', 'Overhead & Profit', overheadProfit]] : []),
      ...(contingency > 0 ? [['', 'Contingency', contingency]] : []),
      ...customLineItems.filter(item => item.amount > 0).map(item => ['', item.description || 'Additional', item.amount]),
      ['', 'GRAND TOTAL', getGrandTotal()]
    ]

    const csv = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${project?.name || 'project'}_proposal.csv`
    link.click()
    toast.success('Exported to CSV')
  }

  // ==================== RENDER ====================
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Project Pricing</h2>
        <div className="flex items-center justify-center gap-2 text-gray-500 py-8">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Loading pricing data...
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow">
      {/* View Toggle Header */}
      <div className="px-6 py-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Project Pricing</h2>
            <p className="text-sm text-gray-500">{bidItems.length} bid items</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadData} className="p-2 text-gray-600 hover:bg-gray-100 rounded" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            {activeView === 'package' && (
              <button
                onClick={analyzeWithAI}
                disabled={analyzing || bidItems.length === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded disabled:opacity-50"
              >
                {analyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {analyzing ? 'Analyzing...' : 'AI Auto-Generate'}
              </button>
            )}
            {activeView === 'client' && (
              <>
                <button onClick={exportToCSV} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded">
                  <Download className="w-4 h-4" /> Export CSV
                </button>
                <button onClick={handlePrint} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded print:hidden">
                  <Printer className="w-4 h-4" /> Print
                </button>
              </>
            )}
            {onInviteSubs && (
              <button
                onClick={onInviteSubs}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
              >
                <Users className="w-4 h-4" /> Invite Subs
              </button>
            )}
            {onAddBidItem && (
              <button
                onClick={onAddBidItem}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded"
              >
                <Plus className="w-4 h-4" /> Add Bid Item
              </button>
            )}
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveView('package')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
              activeView === 'package' ? 'bg-white shadow text-indigo-700' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Package className="w-4 h-4" />
            Bid Packages
          </button>
          <button
            onClick={() => setActiveView('division')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
              activeView === 'division' ? 'bg-white shadow text-indigo-700' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Layers className="w-4 h-4" />
            Division View
          </button>
          <button
            onClick={() => setActiveView('client')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
              activeView === 'client' ? 'bg-white shadow text-green-700' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            Client View
          </button>
        </div>
      </div>

      {/* AI Suggestions */}
      {aiSuggestions && aiSuggestions.packages?.length > 0 && activeView === 'package' && (
        <div className="px-6 py-4 bg-indigo-50 border-b">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <span className="font-medium text-indigo-900">AI Suggested Packages</span>
              <span className="text-sm text-indigo-600">({aiSuggestions.packages.length})</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={createAllSuggestions}
                disabled={creatingPackages}
                className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingPackages ? 'Creating...' : 'Create All'}
              </button>
              <button
                onClick={() => setAiSuggestions(null)}
                disabled={creatingPackages}
                className="px-3 py-1 text-sm text-indigo-600 hover:bg-indigo-100 rounded disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {aiSuggestions.packages.map((suggestion, idx) => (
              <div key={idx} className="bg-white p-3 rounded-lg border border-indigo-200 flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{suggestion.name}</span>
                    {suggestion.subcontractorType && (
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">{suggestion.subcontractorType}</span>
                    )}
                    {suggestion.relatedPackages?.length > 0 && (
                      <span className="text-xs text-gray-500">
                        Related: {suggestion.relatedPackages.join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">{suggestion.description}</div>
                  <div className="text-xs text-gray-500 mt-1">{suggestion.bidItemIds?.length || 0} items</div>
                </div>
                <button
                  onClick={() => createFromSuggestion(suggestion)}
                  disabled={creatingPackages}
                  className="ml-3 px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creatingPackages ? '...' : 'Create'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== BID PACKAGE VIEW ==================== */}
      {activeView === 'package' && (
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-600">
              Group bid items by how subcontractors typically bid work together.
            </p>
            <div className="flex gap-2">
              {scopePackages.length > 0 && (
                <button
                  onClick={handleDeleteAllPackages}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 border border-red-200 rounded"
                >
                  <Trash2 className="w-4 h-4" /> Delete All
                </button>
              )}
              <button
                onClick={() => setShowCreatePackage(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 text-white hover:bg-purple-700 rounded"
              >
                <Plus className="w-4 h-4" /> New Package
              </button>
            </div>
          </div>

          {scopePackages.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="mb-2">No bid packages defined yet</p>
              <p className="text-sm">Use "AI Auto-Generate" to create packages based on industry knowledge</p>
            </div>
          ) : (
            <div className="space-y-3">
              {scopePackages.map(pkg => {
                const analysis = analyzePackage(pkg)
                const lowestComplete = analysis.coverage.find(c => c.isComplete)

                return (
                  <div key={pkg.id} className="border rounded-lg">
                    <div className="flex items-center justify-between p-4 bg-gray-50">
                      <button onClick={() => togglePackage(pkg.id)} className="flex items-center gap-2 font-medium text-gray-900 hover:text-indigo-700">
                        {expandedPackages[pkg.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <Package className="w-4 h-4 text-purple-600" />
                        {pkg.name}
                        <span className="text-sm font-normal text-gray-500">({getPackageItems(pkg).length} items)</span>
                      </button>
                      <div className="flex items-center gap-3">
                        {lowestComplete && (
                          <span className="text-green-600 font-semibold">Low: {formatCurrency(lowestComplete.total)}</span>
                        )}
                        <button onClick={() => setEditingPackage(pkg)} className="p-1 text-gray-400 hover:text-indigo-600 rounded">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeletePackage(pkg.id)} className="p-1 text-gray-400 hover:text-red-600 rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {expandedPackages[pkg.id] && (
                      <div className="border-t">
                        {/* Package Items - Table Format */}
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-gray-600 text-xs">
                              <th className="text-left px-3 py-2 w-16">Div</th>
                              <th className="text-left px-3 py-2">Description</th>
                              <th className="text-left px-3 py-2 w-32">Low Bid</th>
                              <th className="text-right px-3 py-2 w-28">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {getPackageItems(pkg).map(item => {
                              const itemBids = bids.filter(b => b.bid_item?.id === item.id)
                              const lowestBid = itemBids.filter(b => b.amount > 0).sort((a, b) => a.amount - b.amount)[0]
                              const amount = lowestBid?.amount || manualAmounts[item.id] || 0
                              return (
                                <tr key={item.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 text-gray-500">{item.trade?.division_code || '-'}</td>
                                  <td className="px-3 py-2 text-gray-900">{item.description}</td>
                                  <td className="px-3 py-2 text-gray-600">{lowestBid?.subcontractor?.company_name || '-'}</td>
                                  <td className="px-3 py-2 text-right font-medium">
                                    {amount > 0 ? formatCurrency(amount) : '-'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>

                        {/* Bidders Summary */}
                        {analysis.coverage.length > 0 && (
                          <div className="p-4 border-t bg-gray-50">
                            <h4 className="text-sm font-medium text-gray-700 mb-2">Bidders</h4>
                            <div className="flex flex-wrap gap-2">
                              {analysis.coverage.map(sub => (
                                <span
                                  key={sub.subcontractor.id}
                                  className={`px-2 py-1 rounded text-sm ${
                                    sub.isComplete
                                      ? sub.total === lowestComplete?.total
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-blue-100 text-blue-700'
                                      : 'bg-yellow-100 text-yellow-700'
                                  }`}
                                >
                                  {sub.subcontractor.company_name}: {formatCurrency(sub.total)}
                                  {sub.isComplete ? ' ✓' : ` (${Math.round(sub.coveragePercent)}%)`}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== DIVISION VIEW ==================== */}
      {activeView === 'division' && (
        <div className="p-6">
          <p className="text-sm text-gray-600 mb-4">
            View bid items organized by CSI MasterFormat divisions. Enter manual amounts for items without bids.
          </p>

          <div className="space-y-3">
            {groupByDivision(false).map(division => (
              <div key={division.code} className="border rounded-lg">
                <button
                  onClick={() => toggleDivision(division.code)}
                  className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 text-left"
                >
                  <div className="flex items-center gap-2">
                    {expandedDivisions[division.code] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span className="font-medium text-gray-500">Division {division.code}</span>
                    <span className="font-semibold text-gray-900">{division.name}</span>
                    <span className="text-sm text-gray-500">({division.items.length} items)</span>
                  </div>
                  <span className="font-bold text-gray-900">{formatCurrency(division.total)}</span>
                </button>

                {expandedDivisions[division.code] && (
                  <div className="border-t">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-gray-600">
                          <th className="text-left p-3">Item</th>
                          <th className="text-left p-3 w-40">Low Bid / Source</th>
                          <th className="text-right p-3 w-32">Amount</th>
                          <th className="text-center p-3 w-24">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {division.items.map(item => {
                          const hasBid = item.selectedBid?.amount > 0
                          const isLoading = itemActionLoading === item.id
                          return (
                            <tr key={item.id} className="border-t hover:bg-gray-50">
                              <td className="p-3">{item.description}</td>
                              <td className="p-3 text-gray-600">
                                {hasBid ? item.selectedBid.subcontractor?.company_name : (
                                  <span className="text-orange-600 text-xs">Manual Entry</span>
                                )}
                              </td>
                              <td className="p-3 text-right">
                                {hasBid ? (
                                  <span className="font-medium">{formatCurrency(item.amount)}</span>
                                ) : (
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="text-gray-400">$</span>
                                    <input
                                      type="number"
                                      value={manualAmounts[item.id] || ''}
                                      onChange={(e) => updateManualAmount(item.id, e.target.value)}
                                      placeholder="0"
                                      className="w-24 text-right border rounded px-2 py-1 text-sm"
                                    />
                                  </div>
                                )}
                              </td>
                              <td className="p-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => setEditingBidItem(item)}
                                    disabled={isLoading}
                                    className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded disabled:opacity-50"
                                    title="Move to different division"
                                  >
                                    <MoveHorizontal className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteBidItem(item)}
                                    disabled={isLoading}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                                    title="Delete item"
                                  >
                                    {isLoading ? (
                                      <RefreshCw className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-4 h-4" />
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ==================== CLIENT VIEW ==================== */}
      {activeView === 'client' && (
        <div className="p-6 print:p-0">
          {/* Markup Controls (print-hidden) */}
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg print:hidden">
            <h3 className="font-medium text-gray-900 mb-1">Pricing Adjustments</h3>
            <p className="text-xs text-gray-500 mb-3">Markup is applied to each line item (hidden in exports). GC goes under Div 01. OH&P shown separately.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Hidden Markup %</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={markupPercent}
                    onChange={(e) => setMarkupPercent(Number(e.target.value) || 0)}
                    className="input w-20"
                    placeholder="0"
                  />
                  <Percent className="w-4 h-4 text-gray-400" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">General Conditions (Div 01)</label>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    value={generalConditions}
                    onChange={(e) => setGeneralConditions(Number(e.target.value) || 0)}
                    className="input"
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">OH&P (separate line)</label>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    value={overheadProfit}
                    onChange={(e) => setOverheadProfit(Number(e.target.value) || 0)}
                    className="input"
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Contingency</label>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    value={contingency}
                    onChange={(e) => setContingency(Number(e.target.value) || 0)}
                    className="input"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
            {markupPercent > 0 && (
              <div className="mt-3 text-sm text-yellow-700 bg-yellow-100 px-3 py-1.5 rounded">
                <strong>Hidden profit:</strong> {formatCurrency(getMarkupAmount())} ({markupPercent}% markup applied to all line items)
              </div>
            )}
          </div>

          {/* Client Proposal */}
          <div className="border rounded-lg overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 text-white p-6">
              <div className="flex justify-between">
                <div>
                  <h1 className="text-2xl font-bold">{project?.name}</h1>
                  <p className="text-indigo-200 mt-1">{project?.location}</p>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold">PROPOSAL</div>
                  <div className="text-indigo-200">{project?.project_number}</div>
                </div>
              </div>
            </div>

            {/* Division Breakdown with Scope Items */}
            <div className="p-6">
              <h3 className="font-bold text-gray-900 mb-4">Scope of Work & Pricing</h3>

              {groupByDivision(true).map(division => (
                <div key={division.code} className="mb-6">
                  {/* Division Header */}
                  <div className="flex justify-between items-center border-b-2 border-indigo-200 pb-2 mb-2">
                    <div>
                      <span className="text-indigo-600 font-medium">Division {division.code}</span>
                      <span className="ml-2 font-bold text-gray-900">{division.name}</span>
                    </div>
                    <span className="font-bold text-gray-900">{formatCurrency(division.total)}</span>
                  </div>

                  {/* Scope Items */}
                  <table className="w-full text-sm mb-2">
                    <tbody>
                      {division.items.map(item => (
                        <tr key={item.id} className="border-b border-gray-100">
                          <td className="py-2 pl-4 text-gray-700">• {item.description}</td>
                          <td className="py-2 text-right text-gray-600 w-28">
                            {item.amount > 0 ? formatCurrency(item.amount) : '-'}
                          </td>
                        </tr>
                      ))}
                      {/* Show General Conditions under Division 01 */}
                      {division.code === '01' && generalConditions > 0 && (
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <td className="py-2 pl-4 text-gray-700 font-medium">• General Conditions</td>
                          <td className="py-2 text-right text-gray-600 w-28 font-medium">
                            {formatCurrency(generalConditions)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            {/* Custom Line Items */}
            {customLineItems.length > 0 && (
              <div className="px-6 pb-4 print:hidden">
                <h4 className="font-medium text-gray-700 mb-2">Additional Items</h4>
                {customLineItems.map(item => (
                  <div key={item.id} className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateCustomLineItem(item.id, 'description', e.target.value)}
                      placeholder="Description"
                      className="input flex-1"
                    />
                    <input
                      type="number"
                      value={item.amount}
                      onChange={(e) => updateCustomLineItem(item.id, 'amount', e.target.value)}
                      className="input w-32"
                    />
                    <button onClick={() => removeCustomLineItem(item.id)} className="p-2 text-red-600 hover:bg-red-50 rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="px-6 pb-2 print:hidden">
              <button onClick={addCustomLineItem} className="text-sm text-indigo-600 hover:underline">
                + Add custom line item
              </button>
            </div>

            {/* Totals - Simplified since markup is hidden */}
            <div className="p-6 bg-gray-50 border-t">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal (all divisions)</span>
                  <span className="font-medium">{formatCurrency(getSubtotal())}</span>
                </div>
                {overheadProfit > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Overhead & Profit</span>
                    <span className="font-medium">{formatCurrency(overheadProfit)}</span>
                  </div>
                )}
                {contingency > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Contingency</span>
                    <span className="font-medium">{formatCurrency(contingency)}</span>
                  </div>
                )}
                {customLineItems.filter(item => item.amount > 0).map(item => (
                  <div key={item.id} className="flex justify-between">
                    <span className="text-gray-600">{item.description || 'Additional'}</span>
                    <span className="font-medium">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-3 border-t text-lg">
                  <span className="font-bold text-gray-900">Total Project Cost</span>
                  <span className="font-bold text-indigo-700">{formatCurrency(getGrandTotal())}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Package Modal */}
      {showCreatePackage && (
        <CreatePackageModal
          projectId={projectId}
          bidItems={bidItems}
          onClose={() => setShowCreatePackage(false)}
          onSuccess={() => { setShowCreatePackage(false); loadData() }}
        />
      )}

      {/* Edit Package Modal */}
      {editingPackage && (
        <EditPackageModal
          pkg={editingPackage}
          bidItems={bidItems}
          allPackages={scopePackages}
          onClose={() => setEditingPackage(null)}
          onSuccess={() => { setEditingPackage(null); loadData() }}
        />
      )}

      {/* Move Bid Item Modal */}
      {editingBidItem && (
        <MoveBidItemModal
          item={editingBidItem}
          trades={trades}
          onClose={() => setEditingBidItem(null)}
          onMove={handleMoveBidItem}
          loading={itemActionLoading === editingBidItem.id}
        />
      )}
    </div>
  )
}

// ==================== MODALS ====================

function CreatePackageModal({ projectId, bidItems, onClose, onSuccess }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedItems, setSelectedItems] = useState([])
  const [loading, setLoading] = useState(false)

  const itemsByTrade = bidItems.reduce((acc, item) => {
    const tradeId = item.trade?.id || 'unknown'
    if (!acc[tradeId]) acc[tradeId] = { trade: item.trade, items: [] }
    acc[tradeId].items.push(item)
    return acc
  }, {})

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Name required'); return }
    if (selectedItems.length === 0) { toast.error('Select items'); return }

    setLoading(true)
    try {
      await createScopePackage(projectId, name, description, selectedItems)
      toast.success('Package created')
      onSuccess()
    } catch (error) {
      toast.error('Failed to create')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create Bid Package</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
          <div className="p-4 space-y-4 border-b">
            <div>
              <label className="label">Package Name *</label>
              <input type="text" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="label">Description</label>
              <input type="text" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {Object.entries(itemsByTrade).map(([tradeId, { trade, items }]) => (
              <div key={tradeId} className="mb-4 border rounded-lg">
                <div className="p-3 bg-gray-50 font-medium">
                  {trade ? `${trade.division_code} - ${trade.name}` : 'Unknown'}
                </div>
                <div className="divide-y">
                  {items.map(item => (
                    <label key={item.id} className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 ${selectedItems.includes(item.id) ? 'bg-purple-50' : ''}`}>
                      <input type="checkbox" checked={selectedItems.includes(item.id)} onChange={() => setSelectedItems(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])} className="rounded" />
                      <span>{item.description}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t flex justify-between">
            <span className="text-sm text-gray-500">{selectedItems.length} selected</span>
            <div className="flex gap-3">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating...' : 'Create'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditPackageModal({ pkg, bidItems, allPackages, onClose, onSuccess }) {
  const [name, setName] = useState(pkg.name || '')
  const [description, setDescription] = useState(pkg.description || '')
  const [selectedItems, setSelectedItems] = useState(pkg.items?.map(i => i.bid_item_id).filter(Boolean) || [])
  const [loading, setLoading] = useState(false)

  const itemsInOtherPackages = {}
  for (const otherPkg of allPackages) {
    if (otherPkg.id === pkg.id) continue
    for (const item of otherPkg.items || []) {
      if (item.bid_item_id) itemsInOtherPackages[item.bid_item_id] = otherPkg.name
    }
  }

  const itemsByTrade = bidItems.reduce((acc, item) => {
    const tradeId = item.trade?.id || 'unknown'
    if (!acc[tradeId]) acc[tradeId] = { trade: item.trade, items: [] }
    acc[tradeId].items.push(item)
    return acc
  }, {})

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Name required'); return }

    setLoading(true)
    try {
      await updateScopePackage(pkg.id, { name, description }, selectedItems)
      toast.success('Package updated')
      onSuccess()
    } catch (error) {
      toast.error('Failed to update')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit Package</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
          <div className="p-4 space-y-4 border-b">
            <div>
              <label className="label">Package Name *</label>
              <input type="text" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="label">Description</label>
              <input type="text" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {Object.entries(itemsByTrade).map(([tradeId, { trade, items }]) => (
              <div key={tradeId} className="mb-4 border rounded-lg">
                <div className="p-3 bg-gray-50 font-medium">
                  {trade ? `${trade.division_code} - ${trade.name}` : 'Unknown'}
                </div>
                <div className="divide-y">
                  {items.map(item => {
                    const inOther = itemsInOtherPackages[item.id]
                    return (
                      <label key={item.id} className={`flex items-center gap-3 p-3 ${selectedItems.includes(item.id) ? 'bg-purple-50' : inOther ? 'bg-gray-50' : ''} ${inOther ? '' : 'cursor-pointer hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={selectedItems.includes(item.id)} disabled={!!inOther} onChange={() => setSelectedItems(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])} className="rounded" />
                        <div className="flex-1">
                          <span className={inOther ? 'text-gray-400' : ''}>{item.description}</span>
                          {inOther && <div className="text-xs text-gray-400">In: {inOther}</div>}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t flex justify-between">
            <span className="text-sm text-gray-500">{selectedItems.length} in package</span>
            <div className="flex gap-3">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function MoveBidItemModal({ item, trades, onClose, onMove, loading }) {
  const [selectedTradeId, setSelectedTradeId] = useState(item.trade?.id || '')

  // Group trades by division for easier navigation
  const tradesByDivision = trades.reduce((acc, trade) => {
    const div = trade.division_code || '00'
    if (!acc[div]) acc[div] = []
    acc[div].push(trade)
    return acc
  }, {})

  const sortedDivisions = Object.keys(tradesByDivision).sort()

  function handleSubmit(e) {
    e.preventDefault()
    if (!selectedTradeId || selectedTradeId === item.trade?.id) {
      onClose()
      return
    }
    onMove(item.id, selectedTradeId)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Move Bid Item</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item</label>
              <p className="text-gray-900 bg-gray-50 p-2 rounded">{item.description}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Division</label>
              <p className="text-gray-600 bg-gray-50 p-2 rounded">
                {item.trade ? `${item.trade.division_code} - ${item.trade.name}` : 'Not assigned'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Move to Trade/Division</label>
              <select
                value={selectedTradeId}
                onChange={(e) => setSelectedTradeId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="">Select a trade...</option>
                {sortedDivisions.map(div => (
                  <optgroup key={div} label={`Division ${div}`}>
                    {tradesByDivision[div].map(trade => (
                      <option
                        key={trade.id}
                        value={trade.id}
                        disabled={trade.id === item.trade?.id}
                      >
                        {trade.division_code} - {trade.name}
                        {trade.id === item.trade?.id ? ' (current)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className="p-4 border-t flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedTradeId || selectedTradeId === item.trade?.id}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
              {loading ? 'Moving...' : 'Move Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

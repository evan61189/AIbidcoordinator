import { useState, useEffect } from 'react'
import { supabase, fetchScopePackages, createScopePackage, updateScopePackage, deleteScopePackage } from '../lib/supabase'
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
  AlertTriangle
} from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * ProjectBidViews Component
 * Toggle between three views:
 * 1. Bid Package View - How subcontractors bid (grouped by trade pairings)
 * 2. Division View - CSI MasterFormat divisions
 * 3. Client View - Customer-facing with markup, GC, OH&P
 */
export default function ProjectBidViews({ projectId, project, bidItems = [], onRefresh }) {
  const [activeView, setActiveView] = useState('package') // 'package', 'division', 'client'
  const [scopePackages, setScopePackages] = useState([])
  const [bids, setBids] = useState([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState(null)
  const [showCreatePackage, setShowCreatePackage] = useState(false)
  const [editingPackage, setEditingPackage] = useState(null)
  const [expandedPackages, setExpandedPackages] = useState({})
  const [expandedDivisions, setExpandedDivisions] = useState({})

  // Client view state
  const [selectedBids, setSelectedBids] = useState({}) // bidItemId -> bid
  const [markupPercent, setMarkupPercent] = useState(0) // Hidden markup (not shown on exports)
  const [generalConditions, setGeneralConditions] = useState(0)
  const [overheadProfit, setOverheadProfit] = useState(0)
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

      // Load submitted bids
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

      // Auto-select lowest bids for client view
      autoSelectLowestBids(projectBids)
    } catch (error) {
      console.error('Error loading data:', error)
      // Don't show error toast for missing tables - just show empty state
    } finally {
      setLoading(false)
    }
  }

  function autoSelectLowestBids(projectBids) {
    const selected = {}
    const bidsByItem = {}

    for (const bid of projectBids) {
      const itemId = bid.bid_item?.id
      if (!itemId) continue
      if (!bidsByItem[itemId]) bidsByItem[itemId] = []
      bidsByItem[itemId].push(bid)
    }

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

  function formatCurrency(amount) {
    if (!amount && amount !== 0) return '-'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)
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
      toast.error('Failed to analyze bid items')
    } finally {
      setAnalyzing(false)
    }
  }

  async function createFromSuggestion(suggestion) {
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
    }
  }

  async function createAllSuggestions() {
    if (!aiSuggestions?.packages?.length) return
    let created = 0
    for (const suggestion of aiSuggestions.packages) {
      try {
        await createScopePackage(projectId, suggestion.name, suggestion.description, suggestion.bidItemIds)
        created++
      } catch (error) {
        console.error('Error:', suggestion.name, error)
      }
    }
    toast.success(`Created ${created} packages`)
    setAiSuggestions(null)
    loadData()
  }

  // ==================== PACKAGE VIEW HELPERS ====================
  function togglePackage(pkgId) {
    setExpandedPackages(prev => ({ ...prev, [pkgId]: !prev[pkgId] }))
  }

  function analyzePackage(pkg) {
    const packageItemIds = new Set(pkg.items?.map(i => i.bid_item?.id).filter(Boolean) || [])
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

  // ==================== DIVISION VIEW HELPERS ====================
  function groupByDivision() {
    const groups = {}
    for (const item of bidItems) {
      const divCode = item.trade?.division_code || '00'
      const divName = item.trade?.name || 'General'

      if (!groups[divCode]) {
        groups[divCode] = { code: divCode, name: divName, items: [], total: 0 }
      }

      const selectedBid = selectedBids[item.id]
      const amount = selectedBid?.amount || 0
      groups[divCode].items.push({ ...item, selectedBid, amount, allBids: bids.filter(b => b.bid_item?.id === item.id) })
      groups[divCode].total += amount
    }
    return Object.values(groups).sort((a, b) => a.code.localeCompare(b.code))
  }

  function toggleDivision(divCode) {
    setExpandedDivisions(prev => ({ ...prev, [divCode]: !prev[divCode] }))
  }

  // ==================== CLIENT VIEW HELPERS ====================
  function getSubtotal() {
    return Object.values(selectedBids).reduce((sum, bid) => sum + (bid?.amount || 0), 0)
  }

  function getMarkupAmount() {
    return getSubtotal() * (markupPercent / 100)
  }

  function getGrandTotal() {
    const subtotal = getSubtotal()
    const markup = getMarkupAmount()
    const customTotal = customLineItems.reduce((sum, item) => sum + (item.amount || 0), 0)
    return subtotal + markup + generalConditions + overheadProfit + contingency + customTotal
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
    const divisions = groupByDivision()
    const rows = [
      ['Division', 'Item', 'Subcontractor', 'Amount'],
      ...divisions.flatMap(div =>
        div.items.map(item => [
          `${div.code} - ${div.name}`,
          item.description,
          item.selectedBid?.subcontractor?.company_name || 'TBD',
          item.amount || 0
        ])
      ),
      [],
      ['', '', 'Subtotal', getSubtotal()],
      // Note: Markup is hidden in exports - included in totals but not shown as line item
      ['', '', 'General Conditions', generalConditions],
      ['', '', 'OH&P', overheadProfit],
      ['', '', 'Contingency', contingency],
      ...customLineItems.map(item => ['', '', item.description, item.amount]),
      ['', '', 'GRAND TOTAL', getGrandTotal()]
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
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Loading...
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow">
      {/* View Toggle Header */}
      <div className="px-6 py-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Project Pricing</h2>
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
              <button onClick={createAllSuggestions} className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">
                Create All
              </button>
              <button onClick={() => setAiSuggestions(null)} className="px-3 py-1 text-sm text-indigo-600 hover:bg-indigo-100 rounded">
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
                <button onClick={() => createFromSuggestion(suggestion)} className="ml-3 px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200">
                  Create
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
            <button
              onClick={() => setShowCreatePackage(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 text-white hover:bg-purple-700 rounded"
            >
              <Plus className="w-4 h-4" /> New Package
            </button>
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
                        <span className="text-sm font-normal text-gray-500">({pkg.items?.length || 0} items)</span>
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
                      <div className="p-4 border-t space-y-4">
                        {/* Package Items */}
                        <div className="flex flex-wrap gap-2">
                          {pkg.items?.map(({ bid_item }) => (
                            <span key={bid_item?.id} className="px-2 py-1 bg-gray-100 rounded text-sm">
                              {bid_item?.trade?.division_code} - {bid_item?.description?.substring(0, 30)}...
                            </span>
                          ))}
                        </div>

                        {/* Bidders */}
                        {analysis.coverage.length > 0 ? (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-gray-50">
                                <th className="text-left p-2">Subcontractor</th>
                                <th className="text-right p-2">Total</th>
                                <th className="text-center p-2">Coverage</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analysis.coverage.map(sub => (
                                <tr key={sub.subcontractor.id} className="border-b">
                                  <td className="p-2 font-medium">{sub.subcontractor.company_name}</td>
                                  <td className={`p-2 text-right font-semibold ${sub.isComplete && sub.total === lowestComplete?.total ? 'text-green-600' : ''}`}>
                                    {formatCurrency(sub.total)}
                                  </td>
                                  <td className="p-2 text-center">
                                    {sub.isComplete ? (
                                      <span className="text-green-600"><Check className="w-4 h-4 inline" /> Complete</span>
                                    ) : (
                                      <span className="text-yellow-600">{Math.round(sub.coveragePercent)}%</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="text-center py-4 text-gray-500">
                            <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                            No bids received yet
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
            View bid items organized by CSI MasterFormat divisions.
          </p>

          <div className="space-y-3">
            {groupByDivision().map(division => (
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
                          <th className="text-left p-3">Low Bid</th>
                          <th className="text-right p-3">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {division.items.map(item => (
                          <tr key={item.id} className="border-t">
                            <td className="p-3">{item.description}</td>
                            <td className="p-3 text-gray-600">{item.selectedBid?.subcontractor?.company_name || 'No bids'}</td>
                            <td className="p-3 text-right font-medium">
                              {item.amount > 0 ? formatCurrency(item.amount) : '-'}
                            </td>
                          </tr>
                        ))}
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
          <div className="mb-6 p-4 bg-gray-50 rounded-lg print:hidden">
            <h3 className="font-medium text-gray-900 mb-3">Pricing Adjustments</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Markup %</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={markupPercent}
                    onChange={(e) => setMarkupPercent(Number(e.target.value) || 0)}
                    className="input w-20"
                  />
                  <Percent className="w-4 h-4 text-gray-400" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">General Conditions</label>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    value={generalConditions}
                    onChange={(e) => setGeneralConditions(Number(e.target.value) || 0)}
                    className="input"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">OH&P</label>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    value={overheadProfit}
                    onChange={(e) => setOverheadProfit(Number(e.target.value) || 0)}
                    className="input"
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
                  />
                </div>
              </div>
            </div>
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

            {/* Division Breakdown */}
            <div className="p-6">
              <h3 className="font-bold text-gray-900 mb-4">Cost Breakdown by Division</h3>
              <table className="w-full">
                <thead>
                  <tr className="border-b text-gray-600 text-sm">
                    <th className="text-left py-2">Division</th>
                    <th className="text-right py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {groupByDivision().map(division => (
                    <tr key={division.code} className="border-b">
                      <td className="py-3">
                        <span className="text-gray-500">{division.code}</span>
                        <span className="ml-2 font-medium">{division.name}</span>
                      </td>
                      <td className="py-3 text-right font-medium">{formatCurrency(division.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

            {/* Totals */}
            <div className="p-6 bg-gray-50 border-t">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">{formatCurrency(getSubtotal())}</span>
                </div>
                {/* Markup is hidden in print/export - shown only in edit mode */}
                {markupPercent > 0 && (
                  <div className="flex justify-between print:hidden">
                    <span className="text-gray-600">Markup ({markupPercent}%)</span>
                    <span className="font-medium">{formatCurrency(getMarkupAmount())}</span>
                  </div>
                )}
                {generalConditions > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">General Conditions</span>
                    <span className="font-medium">{formatCurrency(generalConditions)}</span>
                  </div>
                )}
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
                {customLineItems.map(item => item.amount > 0 && (
                  <div key={item.id} className="flex justify-between">
                    <span className="text-gray-600">{item.description || 'Custom Item'}</span>
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
  const [selectedItems, setSelectedItems] = useState(pkg.items?.map(i => i.bid_item?.id).filter(Boolean) || [])
  const [loading, setLoading] = useState(false)

  const itemsInOtherPackages = {}
  for (const otherPkg of allPackages) {
    if (otherPkg.id === pkg.id) continue
    for (const item of otherPkg.items || []) {
      if (item.bid_item?.id) itemsInOtherPackages[item.bid_item.id] = otherPkg.name
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

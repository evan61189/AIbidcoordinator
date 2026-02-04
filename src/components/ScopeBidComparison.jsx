import { useState, useEffect } from 'react'
import { supabase, fetchScopePackages, createScopePackage, deleteScopePackage, fetchBidsForLeveling } from '../lib/supabase'
import {
  Package,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Layers,
  GitMerge,
  DollarSign,
  AlertTriangle,
  RefreshCw
} from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * ScopeBidComparison Component
 *
 * Handles the "apples to apples" comparison problem:
 * - Electrician 1: Wiring + Low Voltage + Fire Alarm = $50k (complete)
 * - Electrician 2: Wiring only = $35k
 * - Low Voltage Sub: Low Voltage + Fire Alarm = $18k
 *
 * Shows: $50k vs $53k (35k + 18k) for complete electrical package
 */
export default function ScopeBidComparison({ projectId, bidItems = [] }) {
  const [scopePackages, setScopePackages] = useState([])
  const [bids, setBids] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreatePackage, setShowCreatePackage] = useState(false)
  const [expandedPackages, setExpandedPackages] = useState({})

  useEffect(() => {
    if (projectId) {
      loadData()
    }
  }, [projectId])

  async function loadData() {
    setLoading(true)
    try {
      const [packagesData, bidsData] = await Promise.all([
        fetchScopePackages(projectId),
        fetchBidsForLeveling(projectId)
      ])
      setScopePackages(packagesData || [])
      setBids(bidsData || [])
    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Failed to load comparison data')
    } finally {
      setLoading(false)
    }
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

  function togglePackage(pkgId) {
    setExpandedPackages(prev => ({
      ...prev,
      [pkgId]: !prev[pkgId]
    }))
  }

  /**
   * Calculate scope coverage and combinations for a package
   */
  function analyzePackage(pkg) {
    const packageItemIds = new Set(pkg.items?.map(i => i.bid_item?.id).filter(Boolean) || [])
    if (packageItemIds.size === 0) return { coverage: [], combinations: [] }

    // Group bids by subcontractor
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

    // Calculate coverage for each subcontractor
    const coverage = Object.values(bidsBySubcontractor).map(sub => ({
      ...sub,
      coveragePercent: (sub.coveredItemIds.size / packageItemIds.size) * 100,
      isComplete: sub.coveredItemIds.size === packageItemIds.size,
      missingItems: [...packageItemIds].filter(id => !sub.coveredItemIds.has(id))
    }))

    // Sort by coverage (complete first) then by total
    coverage.sort((a, b) => {
      if (a.isComplete !== b.isComplete) return b.isComplete ? 1 : -1
      return a.total - b.total
    })

    // Find combinations that complete the package
    const combinations = findCompletingCombinations(coverage, packageItemIds)

    return { coverage, combinations }
  }

  /**
   * Find combinations of partial bids that complete a package
   */
  function findCompletingCombinations(coverage, packageItemIds) {
    const partialSubs = coverage.filter(c => !c.isComplete && c.coveredItemIds.size > 0)
    const combinations = []

    // Try pairs first
    for (let i = 0; i < partialSubs.length; i++) {
      for (let j = i + 1; j < partialSubs.length; j++) {
        const combined = new Set([...partialSubs[i].coveredItemIds, ...partialSubs[j].coveredItemIds])
        if (combined.size === packageItemIds.size) {
          combinations.push({
            subcontractors: [partialSubs[i], partialSubs[j]],
            total: partialSubs[i].total + partialSubs[j].total,
            isComplete: true
          })
        }
      }
    }

    // Try triples if no pairs complete the package
    if (combinations.length === 0 && partialSubs.length >= 3) {
      for (let i = 0; i < partialSubs.length; i++) {
        for (let j = i + 1; j < partialSubs.length; j++) {
          for (let k = j + 1; k < partialSubs.length; k++) {
            const combined = new Set([
              ...partialSubs[i].coveredItemIds,
              ...partialSubs[j].coveredItemIds,
              ...partialSubs[k].coveredItemIds
            ])
            if (combined.size === packageItemIds.size) {
              combinations.push({
                subcontractors: [partialSubs[i], partialSubs[j], partialSubs[k]],
                total: partialSubs[i].total + partialSubs[j].total + partialSubs[k].total,
                isComplete: true
              })
            }
          }
        }
      }
    }

    // Sort by total cost
    combinations.sort((a, b) => a.total - b.total)

    return combinations.slice(0, 5) // Limit to top 5 combinations
  }

  async function handleDeletePackage(pkgId) {
    if (!confirm('Delete this scope package?')) return

    try {
      await deleteScopePackage(pkgId)
      toast.success('Package deleted')
      loadData()
    } catch (error) {
      console.error('Error deleting package:', error)
      toast.error('Failed to delete package')
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Loading scope comparison...
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-purple-600" />
          <h2 className="text-lg font-semibold">Scope Package Comparison</h2>
          <span className="text-sm text-gray-500">({scopePackages.length} packages)</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreatePackage(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 text-white hover:bg-purple-700 rounded"
          >
            <Plus className="w-4 h-4" />
            New Package
          </button>
        </div>
      </div>

      {/* Help Text */}
      <div className="px-6 py-3 bg-purple-50 border-b text-sm text-purple-800">
        <strong>Tip:</strong> Create scope packages to group related bid items (e.g., "Complete Electrical" = Wiring + Low Voltage + Fire Alarm).
        This helps compare bidders with different scopes by showing both single-sub and combination options.
      </div>

      {/* Packages List */}
      {scopePackages.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="mb-2">No scope packages defined</p>
          <button
            onClick={() => setShowCreatePackage(true)}
            className="text-purple-600 hover:underline"
          >
            Create your first scope package
          </button>
        </div>
      ) : (
        <div className="divide-y">
          {scopePackages.map(pkg => {
            const analysis = analyzePackage(pkg)
            const lowestComplete = analysis.coverage.find(c => c.isComplete)
            const lowestCombination = analysis.combinations[0]
            const overallLowest = lowestComplete && lowestCombination
              ? (lowestComplete.total <= lowestCombination.total ? lowestComplete.total : lowestCombination.total)
              : (lowestComplete?.total || lowestCombination?.total)

            return (
              <div key={pkg.id} className="p-4">
                {/* Package Header */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => togglePackage(pkg.id)}
                    className="flex items-center gap-2 font-medium text-gray-900 hover:text-purple-700"
                  >
                    {expandedPackages[pkg.id] ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    <Layers className="w-4 h-4 text-purple-600" />
                    {pkg.name}
                    <span className="text-sm font-normal text-gray-500">
                      ({pkg.items?.length || 0} items)
                    </span>
                  </button>
                  <div className="flex items-center gap-3">
                    {overallLowest && (
                      <span className="text-green-600 font-semibold">
                        Best: {formatCurrency(overallLowest)}
                      </span>
                    )}
                    <button
                      onClick={() => handleDeletePackage(pkg.id)}
                      className="p-1 text-gray-400 hover:text-red-600 rounded"
                      title="Delete package"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedPackages[pkg.id] && (
                  <div className="mt-4 space-y-4">
                    {/* Package Items */}
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm font-medium text-gray-700 mb-2">Package Includes:</div>
                      <div className="flex flex-wrap gap-2">
                        {pkg.items?.map(({ bid_item }) => (
                          <span key={bid_item?.id} className="px-2 py-1 bg-white border rounded text-sm">
                            {bid_item?.trade?.division_code} - {bid_item?.description?.substring(0, 40)}
                            {bid_item?.description?.length > 40 ? '...' : ''}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Single Subcontractor Options */}
                    {analysis.coverage.length > 0 && (
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <DollarSign className="w-4 h-4" />
                          Single Subcontractor Options
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              <th className="text-left p-2">Subcontractor</th>
                              <th className="text-right p-2">Total</th>
                              <th className="text-center p-2">Coverage</th>
                              <th className="text-left p-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysis.coverage.map((sub, idx) => (
                              <tr key={sub.subcontractor.id} className="border-b">
                                <td className="p-2 font-medium">{sub.subcontractor.company_name}</td>
                                <td className={`p-2 text-right font-semibold ${
                                  sub.isComplete && sub.total === overallLowest ? 'text-green-600' : ''
                                }`}>
                                  {formatCurrency(sub.total)}
                                  {sub.isComplete && sub.total === overallLowest && (
                                    <span className="ml-1 text-xs">✓ Lowest</span>
                                  )}
                                </td>
                                <td className="p-2 text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full ${sub.isComplete ? 'bg-green-500' : 'bg-yellow-500'}`}
                                        style={{ width: `${sub.coveragePercent}%` }}
                                      />
                                    </div>
                                    <span className="text-xs text-gray-500">
                                      {Math.round(sub.coveragePercent)}%
                                    </span>
                                  </div>
                                </td>
                                <td className="p-2">
                                  {sub.isComplete ? (
                                    <span className="inline-flex items-center gap-1 text-green-600">
                                      <Check className="w-3 h-3" />
                                      Complete
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-yellow-600">
                                      <AlertTriangle className="w-3 h-3" />
                                      Partial ({sub.coveredItemIds.size}/{pkg.items?.length})
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Combination Options */}
                    {analysis.combinations.length > 0 && (
                      <div>
                        <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                          <GitMerge className="w-4 h-4" />
                          Combination Options (Multiple Subs)
                        </div>
                        <div className="space-y-2">
                          {analysis.combinations.map((combo, idx) => (
                            <div
                              key={idx}
                              className={`p-3 rounded border ${
                                combo.total === overallLowest
                                  ? 'border-green-300 bg-green-50'
                                  : 'border-gray-200 bg-gray-50'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {combo.subcontractors.map((sub, subIdx) => (
                                    <span key={sub.subcontractor.id}>
                                      <span className="font-medium">{sub.subcontractor.company_name}</span>
                                      <span className="text-gray-500 text-sm ml-1">
                                        ({formatCurrency(sub.total)})
                                      </span>
                                      {subIdx < combo.subcontractors.length - 1 && (
                                        <span className="text-gray-400 mx-2">+</span>
                                      )}
                                    </span>
                                  ))}
                                </div>
                                <div className={`font-semibold ${
                                  combo.total === overallLowest ? 'text-green-600' : 'text-gray-900'
                                }`}>
                                  = {formatCurrency(combo.total)}
                                  {combo.total === overallLowest && (
                                    <span className="ml-1 text-xs">✓ Lowest</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* No Bids Warning */}
                    {analysis.coverage.length === 0 && (
                      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm">
                        <AlertTriangle className="w-4 h-4 inline mr-2" />
                        No submitted bids found for items in this package.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create Package Modal */}
      {showCreatePackage && (
        <CreatePackageModal
          projectId={projectId}
          bidItems={bidItems}
          onClose={() => setShowCreatePackage(false)}
          onSuccess={() => {
            setShowCreatePackage(false)
            loadData()
          }}
        />
      )}
    </div>
  )
}

function CreatePackageModal({ projectId, bidItems, onClose, onSuccess }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedItems, setSelectedItems] = useState([])
  const [loading, setLoading] = useState(false)

  // Group bid items by trade
  const itemsByTrade = bidItems.reduce((acc, item) => {
    const tradeId = item.trade?.id || 'unknown'
    if (!acc[tradeId]) {
      acc[tradeId] = { trade: item.trade, items: [] }
    }
    acc[tradeId].items.push(item)
    return acc
  }, {})

  function toggleItem(itemId) {
    setSelectedItems(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    )
  }

  function selectTrade(tradeId) {
    const tradeItemIds = itemsByTrade[tradeId]?.items.map(i => i.id) || []
    const allSelected = tradeItemIds.every(id => selectedItems.includes(id))

    if (allSelected) {
      setSelectedItems(prev => prev.filter(id => !tradeItemIds.includes(id)))
    } else {
      setSelectedItems(prev => [...new Set([...prev, ...tradeItemIds])])
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('Package name is required')
      return
    }

    if (selectedItems.length === 0) {
      toast.error('Select at least one bid item')
      return
    }

    setLoading(true)
    try {
      await createScopePackage(projectId, name, description, selectedItems)
      toast.success('Scope package created')
      onSuccess()
    } catch (error) {
      console.error('Error creating package:', error)
      toast.error('Failed to create package')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create Scope Package</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
          <div className="p-4 space-y-4 border-b">
            <div>
              <label className="label">Package Name *</label>
              <input
                type="text"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Complete Electrical Package"
                required
              />
            </div>
            <div>
              <label className="label">Description</label>
              <input
                type="text"
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., All electrical work including low voltage and fire alarm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <label className="label mb-3">Select Bid Items *</label>
            {Object.keys(itemsByTrade).length > 0 ? (
              <div className="space-y-4">
                {Object.entries(itemsByTrade).map(([tradeId, { trade, items }]) => {
                  const allSelected = items.every(i => selectedItems.includes(i.id))
                  const someSelected = items.some(i => selectedItems.includes(i.id))

                  return (
                    <div key={tradeId} className="border rounded-lg">
                      <div
                        className="p-3 bg-gray-50 flex items-center justify-between cursor-pointer hover:bg-gray-100"
                        onClick={() => selectTrade(tradeId)}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={el => el && (el.indeterminate = someSelected && !allSelected)}
                            onChange={() => {}}
                            className="rounded"
                          />
                          <span className="font-medium">
                            {trade ? `${trade.division_code} - ${trade.name}` : 'Unknown Trade'}
                          </span>
                          <span className="text-sm text-gray-500">
                            ({items.length} items)
                          </span>
                        </div>
                      </div>
                      <div className="divide-y">
                        {items.map(item => (
                          <label
                            key={item.id}
                            className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 ${
                              selectedItems.includes(item.id) ? 'bg-purple-50' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedItems.includes(item.id)}
                              onChange={() => toggleItem(item.id)}
                              className="rounded"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                {item.item_number && (
                                  <span className="text-sm text-gray-500">#{item.item_number}</span>
                                )}
                                <span>{item.description}</span>
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No bid items available for this project.
              </div>
            )}
          </div>

          <div className="p-4 border-t flex justify-between items-center">
            <span className="text-sm text-gray-500">
              {selectedItems.length} item(s) selected
            </span>
            <div className="flex gap-3">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || selectedItems.length === 0}
              >
                {loading ? 'Creating...' : 'Create Package'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

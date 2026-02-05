import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { formatCurrency } from '../lib/utils'
import {
  ArrowLeft,
  Download,
  Building2,
  Calendar,
  MapPin,
  Phone,
  Mail,
  DollarSign,
  FileText,
  Printer,
  ChevronDown,
  ChevronRight,
  Check,
  RefreshCw,
  Sparkles,
  Edit
} from 'lucide-react'
import { fetchProject, supabase } from '../lib/supabase'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

/**
 * CustomerProposal Page
 * Clean, professional customer-facing proposal with division breakdowns
 */
export default function CustomerProposal() {
  const { id } = useParams()
  const [project, setProject] = useState(null)
  const [bids, setBids] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedDivisions, setExpandedDivisions] = useState({})
  const [selectedBids, setSelectedBids] = useState({}) // bidItemId -> bid
  const [aiDivisionNames, setAiDivisionNames] = useState({})
  const [loadingDivisionNames, setLoadingDivisionNames] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [companyInfo, setCompanyInfo] = useState({
    name: 'Clipper Construction',
    address: '',
    phone: '',
    email: '',
    logo: ''
  })

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    try {
      const projectData = await fetchProject(id)
      setProject(projectData)

      // Fetch all submitted bids for this project
      const { data: bidsData, error: bidsError } = await supabase
        .from('bids')
        .select(`
          *,
          subcontractor:subcontractors (id, company_name),
          bid_item:bid_items (
            id,
            description,
            item_number,
            trade:trades (id, name, division_code)
          )
        `)
        .eq('status', 'submitted')
        .order('amount', { ascending: true })

      if (bidsError) throw bidsError

      // Filter to only this project's bids
      const projectBids = (bidsData || []).filter(
        b => b.bid_item?.trade && projectData?.bid_items?.some(item => item.id === b.bid_item.id)
      )

      setBids(projectBids)

      // Auto-select lowest bid for each bid item
      const autoSelected = {}
      const bidsByItem = {}
      for (const bid of projectBids) {
        const itemId = bid.bid_item?.id
        if (!itemId) continue
        if (!bidsByItem[itemId]) bidsByItem[itemId] = []
        bidsByItem[itemId].push(bid)
      }

      for (const [itemId, itemBids] of Object.entries(bidsByItem)) {
        // Sort by amount and pick lowest non-zero
        const sorted = itemBids
          .filter(b => b.amount && b.amount > 0)
          .sort((a, b) => a.amount - b.amount)
        if (sorted.length > 0) {
          autoSelected[itemId] = sorted[0]
        }
      }
      setSelectedBids(autoSelected)

    } catch (error) {
      console.error('Error loading data:', error)
      toast.error('Failed to load proposal data')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Get customer-friendly division names from AI
   */
  async function generateDivisionNames() {
    const divisions = [...new Set(
      project?.bid_items?.map(item => item.trade?.division_code).filter(Boolean)
    )]

    if (divisions.length === 0) return

    setLoadingDivisionNames(true)
    try {
      const response = await fetch('/.netlify/functions/analyze-bid-packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bids,
          bidItems: project?.bid_items || []
        })
      })

      const result = await response.json()
      if (result.analysis?.customerDivisions) {
        const nameMap = {}
        for (const div of result.analysis.customerDivisions) {
          nameMap[div.divisionCode] = div.displayName
        }
        setAiDivisionNames(nameMap)
        toast.success('Generated customer-friendly names')
      }
    } catch (error) {
      console.error('Error generating names:', error)
      toast.error('Failed to generate division names')
    } finally {
      setLoadingDivisionNames(false)
    }
  }

  function toggleDivision(divisionCode) {
    setExpandedDivisions(prev => ({
      ...prev,
      [divisionCode]: !prev[divisionCode]
    }))
  }

  function selectBid(bidItemId, bid) {
    setSelectedBids(prev => ({
      ...prev,
      [bidItemId]: bid
    }))
  }

  function formatDate(dateString) {
    if (!dateString) return '-'
    return format(new Date(dateString), 'MMMM d, yyyy')
  }

  // Group bid items by division
  function groupByDivision() {
    const groups = {}

    for (const item of project?.bid_items || []) {
      const divCode = item.trade?.division_code || '00'
      const divName = item.trade?.name || 'General'

      if (!groups[divCode]) {
        groups[divCode] = {
          code: divCode,
          name: divName,
          displayName: aiDivisionNames[divCode] || divName,
          items: [],
          total: 0
        }
      }

      const selectedBid = selectedBids[item.id]
      const amount = selectedBid?.amount || 0

      groups[divCode].items.push({
        ...item,
        selectedBid,
        amount,
        allBids: bids.filter(b => b.bid_item?.id === item.id)
      })

      groups[divCode].total += amount
    }

    // Sort by division code
    return Object.values(groups).sort((a, b) => a.code.localeCompare(b.code))
  }

  const divisions = groupByDivision()
  const grandTotal = divisions.reduce((sum, div) => sum + div.total, 0)

  function handlePrint() {
    window.print()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Print-hidden controls */}
      <div className="print:hidden bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={`/projects/${id}`} className="text-gray-600 hover:text-gray-900">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-lg font-semibold">Customer Proposal</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditMode(!editMode)}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded ${
                editMode ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Edit className="w-4 h-4" />
              {editMode ? 'Done Editing' : 'Edit Selections'}
            </button>
            <button
              onClick={generateDivisionNames}
              disabled={loadingDivisionNames}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded"
            >
              {loadingDivisionNames ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Customer-Friendly Names
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 rounded"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
          </div>
        </div>
      </div>

      {/* Proposal Content */}
      <div className="max-w-5xl mx-auto py-8 px-6">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden print:shadow-none">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 text-white p-8">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-3xl font-bold">{companyInfo.name}</h1>
                {companyInfo.address && <p className="mt-1 opacity-90">{companyInfo.address}</p>}
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">PROPOSAL</div>
                <div className="text-indigo-200 mt-1">
                  {project?.project_number || `#${id.substring(0, 8)}`}
                </div>
              </div>
            </div>
          </div>

          {/* Project Info */}
          <div className="p-8 border-b bg-gray-50">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-4">{project?.name}</h2>
                {project?.location && (
                  <div className="flex items-center gap-2 text-gray-600 mb-2">
                    <MapPin className="w-4 h-4" />
                    {project.location}
                  </div>
                )}
                {project?.bid_date && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar className="w-4 h-4" />
                    Proposal Date: {formatDate(project.bid_date)}
                  </div>
                )}
              </div>
              <div>
                <h3 className="font-medium text-gray-700 mb-2">Prepared For:</h3>
                <div className="text-gray-900 font-medium">{project?.client_name || 'Client Name'}</div>
                {project?.client_contact && (
                  <div className="text-gray-600">{project.client_contact}</div>
                )}
                {project?.client_email && (
                  <div className="flex items-center gap-2 text-gray-600 mt-1">
                    <Mail className="w-4 h-4" />
                    {project.client_email}
                  </div>
                )}
                {project?.client_phone && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="w-4 h-4" />
                    {project.client_phone}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Division Breakdown */}
          <div className="p-8">
            <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-indigo-600" />
              Cost Breakdown by Division
            </h3>

            <div className="space-y-4">
              {divisions.map(division => (
                <div key={division.code} className="border rounded-lg overflow-hidden">
                  {/* Division Header */}
                  <button
                    onClick={() => toggleDivision(division.code)}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 text-left"
                  >
                    <div className="flex items-center gap-3">
                      {expandedDivisions[division.code] ? (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="font-medium text-gray-500">Division {division.code}</span>
                      <span className="font-semibold text-gray-900">{division.displayName}</span>
                    </div>
                    <div className="text-lg font-bold text-gray-900">
                      {formatCurrency(division.total)}
                    </div>
                  </button>

                  {/* Division Details (expanded) */}
                  {expandedDivisions[division.code] && (
                    <div className="border-t">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50 text-sm text-gray-600">
                            <th className="text-left p-3 font-medium">Item</th>
                            {editMode && <th className="text-left p-3 font-medium">Subcontractor</th>}
                            <th className="text-right p-3 font-medium">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {division.items.map(item => (
                            <tr key={item.id} className="border-t">
                              <td className="p-3">
                                <div className="font-medium text-gray-900">{item.description}</div>
                                {item.item_number && (
                                  <div className="text-sm text-gray-500">#{item.item_number}</div>
                                )}
                              </td>
                              {editMode && (
                                <td className="p-3">
                                  {item.allBids.length > 0 ? (
                                    <select
                                      value={item.selectedBid?.id || ''}
                                      onChange={(e) => {
                                        const bid = item.allBids.find(b => b.id === e.target.value)
                                        selectBid(item.id, bid)
                                      }}
                                      className="input text-sm py-1"
                                    >
                                      <option value="">-- Select --</option>
                                      {item.allBids.map(bid => (
                                        <option key={bid.id} value={bid.id}>
                                          {bid.subcontractor?.company_name} - {formatCurrency(bid.amount)}
                                          {bid.notes?.includes('lump sum') ? ' (lump sum)' : ''}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="text-sm text-gray-400">No bids</span>
                                  )}
                                </td>
                              )}
                              <td className="p-3 text-right">
                                {item.amount > 0 ? (
                                  <span className="font-medium text-gray-900">
                                    {formatCurrency(item.amount)}
                                  </span>
                                ) : item.selectedBid?.notes?.includes('Included in lump sum') ? (
                                  <span className="text-sm text-gray-500 italic">Included above</span>
                                ) : (
                                  <span className="text-sm text-gray-400">TBD</span>
                                )}
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

            {/* Grand Total */}
            <div className="mt-8 p-6 bg-indigo-50 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-gray-900">Total Project Cost</div>
                  <div className="text-sm text-gray-600">
                    {divisions.length} divisions • {project?.bid_items?.length || 0} line items
                  </div>
                </div>
                <div className="text-3xl font-bold text-indigo-700">
                  {formatCurrency(grandTotal)}
                </div>
              </div>
            </div>
          </div>

          {/* Terms & Conditions */}
          <div className="p-8 bg-gray-50 border-t">
            <h3 className="font-bold text-gray-900 mb-4">Terms & Conditions</h3>
            <ul className="text-sm text-gray-600 space-y-2">
              <li>• This proposal is valid for 30 days from the date shown above.</li>
              <li>• Prices are based on current material costs and may be subject to change.</li>
              <li>• Payment terms: 50% upon contract signing, 50% upon completion.</li>
              <li>• Any changes to scope will be documented and priced separately.</li>
              <li>• Excludes permits, fees, and any items not specifically listed.</li>
            </ul>
          </div>

          {/* Signature Lines */}
          <div className="p-8 border-t">
            <div className="grid grid-cols-2 gap-12">
              <div>
                <div className="border-b border-gray-400 pb-2 mb-2"></div>
                <div className="text-sm text-gray-600">Client Signature</div>
                <div className="text-sm text-gray-400 mt-1">Date: _______________</div>
              </div>
              <div>
                <div className="border-b border-gray-400 pb-2 mb-2"></div>
                <div className="text-sm text-gray-600">{companyInfo.name} Representative</div>
                <div className="text-sm text-gray-400 mt-1">Date: _______________</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:shadow-none { box-shadow: none !important; }
        }
      `}</style>
    </div>
  )
}

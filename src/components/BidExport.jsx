import { useState } from 'react'
import {
  Download,
  FileSpreadsheet,
  FileText,
  X,
  Check,
  Settings,
  Table
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { format } from 'date-fns'

export default function BidExport({ project, bidItems, bids, trades, onClose }) {
  const [exportFormat, setExportFormat] = useState('xlsx')
  const [includeOptions, setIncludeOptions] = useState({
    projectInfo: true,
    bidItemDetails: true,
    subcontractorInfo: true,
    pricing: true,
    exclusions: true,
    clarifications: true,
    comparison: true,
    statistics: true
  })
  const [groupBy, setGroupBy] = useState('trade')
  const [exporting, setExporting] = useState(false)

  // Organize bid data
  function organizeBidData() {
    const itemsWithBids = bidItems.map(item => {
      const itemBids = bids.filter(b => b.bid_item_id === item.id)
      const amounts = itemBids.map(b => b.amount).filter(a => a != null)

      return {
        ...item,
        bids: itemBids,
        lowestBid: amounts.length > 0 ? Math.min(...amounts) : null,
        highestBid: amounts.length > 0 ? Math.max(...amounts) : null,
        averageBid: amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : null,
        bidCount: itemBids.filter(b => b.status === 'submitted').length
      }
    })

    // Group by trade if needed
    if (groupBy === 'trade') {
      const grouped = {}
      itemsWithBids.forEach(item => {
        const tradeName = item.trade?.name || 'Unassigned'
        if (!grouped[tradeName]) {
          grouped[tradeName] = []
        }
        grouped[tradeName].push(item)
      })
      return grouped
    }

    return { 'All Items': itemsWithBids }
  }

  function exportToExcel() {
    setExporting(true)

    try {
      const wb = XLSX.utils.book_new()
      const data = organizeBidData()

      // Create Summary Sheet
      if (includeOptions.projectInfo || includeOptions.statistics) {
        const summaryData = []

        if (includeOptions.projectInfo) {
          summaryData.push(['BID COMPARISON REPORT'])
          summaryData.push([])
          summaryData.push(['Project:', project?.name || 'Unknown'])
          summaryData.push(['Project Number:', project?.project_number || 'N/A'])
          summaryData.push(['Location:', project?.location || 'N/A'])
          summaryData.push(['Generated:', format(new Date(), 'MMMM d, yyyy h:mm a')])
          summaryData.push([])
        }

        if (includeOptions.statistics) {
          summaryData.push(['SUMMARY STATISTICS'])
          summaryData.push([])

          let totalItems = 0
          let totalBids = 0
          let totalLowest = 0

          Object.entries(data).forEach(([trade, items]) => {
            const tradeLowest = items.reduce((sum, item) => sum + (item.lowestBid || 0), 0)
            const tradeBidCount = items.reduce((sum, item) => sum + item.bidCount, 0)

            summaryData.push([trade])
            summaryData.push(['  Items:', items.length])
            summaryData.push(['  Bids Received:', tradeBidCount])
            summaryData.push(['  Lowest Total:', tradeLowest > 0 ? `$${tradeLowest.toLocaleString()}` : 'No bids'])
            summaryData.push([])

            totalItems += items.length
            totalBids += tradeBidCount
            totalLowest += tradeLowest
          })

          summaryData.push(['GRAND TOTALS'])
          summaryData.push(['Total Bid Items:', totalItems])
          summaryData.push(['Total Bids Received:', totalBids])
          summaryData.push(['Lowest Combined Total:', totalLowest > 0 ? `$${totalLowest.toLocaleString()}` : 'No bids'])
        }

        const summaryWs = XLSX.utils.aoa_to_sheet(summaryData)
        XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary')
      }

      // Create Comparison Sheet
      if (includeOptions.comparison) {
        // Get all unique subcontractors with bids
        const allSubs = new Set()
        bids.forEach(bid => {
          if (bid.subcontractor) {
            allSubs.add(bid.subcontractor.company_name)
          }
        })
        const subNames = Array.from(allSubs).sort()

        const comparisonData = []

        // Header row
        const headerRow = ['Trade', 'Item', 'Description', 'Qty', 'Unit', ...subNames, 'Lowest', 'Average', 'Spread']
        comparisonData.push(headerRow)

        Object.entries(data).forEach(([trade, items]) => {
          items.forEach(item => {
            const row = [
              trade,
              item.item_number || '',
              item.description || '',
              item.quantity || '',
              item.unit || ''
            ]

            // Add each sub's bid
            subNames.forEach(subName => {
              const bid = item.bids.find(b => b.subcontractor?.company_name === subName)
              row.push(bid?.amount ? bid.amount : '')
            })

            // Add stats
            row.push(item.lowestBid || '')
            row.push(item.averageBid ? Math.round(item.averageBid) : '')
            row.push(item.lowestBid && item.highestBid ? item.highestBid - item.lowestBid : '')

            comparisonData.push(row)
          })

          // Add trade subtotal row
          const tradeTotal = ['', '', `${trade} SUBTOTAL`, '', '']
          subNames.forEach(subName => {
            const subTotal = items.reduce((sum, item) => {
              const bid = item.bids.find(b => b.subcontractor?.company_name === subName)
              return sum + (bid?.amount || 0)
            }, 0)
            tradeTotal.push(subTotal > 0 ? subTotal : '')
          })
          const lowestTotal = items.reduce((sum, item) => sum + (item.lowestBid || 0), 0)
          tradeTotal.push(lowestTotal > 0 ? lowestTotal : '')
          tradeTotal.push('') // Average
          tradeTotal.push('') // Spread
          comparisonData.push(tradeTotal)
          comparisonData.push([]) // Empty row between trades
        })

        const comparisonWs = XLSX.utils.aoa_to_sheet(comparisonData)

        // Set column widths
        comparisonWs['!cols'] = [
          { wch: 15 }, // Trade
          { wch: 10 }, // Item
          { wch: 40 }, // Description
          { wch: 8 },  // Qty
          { wch: 6 },  // Unit
          ...subNames.map(() => ({ wch: 15 })), // Sub columns
          { wch: 12 }, // Lowest
          { wch: 12 }, // Average
          { wch: 12 }  // Spread
        ]

        XLSX.utils.book_append_sheet(wb, comparisonWs, 'Bid Comparison')
      }

      // Create Detail Sheets by Trade
      if (includeOptions.bidItemDetails) {
        Object.entries(data).forEach(([trade, items]) => {
          const detailData = []

          items.forEach((item, idx) => {
            if (idx > 0) detailData.push([]) // Space between items

            detailData.push([`${item.item_number || ''} - ${item.description || 'No description'}`])
            detailData.push(['Quantity:', item.quantity || 'N/A', 'Unit:', item.unit || 'N/A'])
            detailData.push(['Scope:', item.scope_details || 'N/A'])
            detailData.push([])
            detailData.push(['Subcontractor', 'Amount', 'Status', 'Submitted'])

            item.bids.forEach(bid => {
              detailData.push([
                bid.subcontractor?.company_name || 'Unknown',
                bid.amount ? `$${bid.amount.toLocaleString()}` : 'No bid',
                bid.status,
                bid.submitted_at ? format(new Date(bid.submitted_at), 'MMM d, yyyy') : ''
              ])

              if (includeOptions.exclusions && bid.exclusions) {
                detailData.push(['  Exclusions:', bid.exclusions])
              }
              if (includeOptions.clarifications && bid.clarifications) {
                detailData.push(['  Clarifications:', bid.clarifications])
              }
            })

            if (item.bidCount > 0) {
              detailData.push([])
              detailData.push(['Statistics:'])
              detailData.push(['  Lowest:', item.lowestBid ? `$${item.lowestBid.toLocaleString()}` : 'N/A'])
              detailData.push(['  Highest:', item.highestBid ? `$${item.highestBid.toLocaleString()}` : 'N/A'])
              detailData.push(['  Average:', item.averageBid ? `$${Math.round(item.averageBid).toLocaleString()}` : 'N/A'])
            }
          })

          // Limit sheet name to 31 chars (Excel limit)
          const sheetName = trade.substring(0, 31)
          const detailWs = XLSX.utils.aoa_to_sheet(detailData)
          XLSX.utils.book_append_sheet(wb, detailWs, sheetName)
        })
      }

      // Create Subcontractor Contact Sheet
      if (includeOptions.subcontractorInfo) {
        const subsInBids = new Map()
        bids.forEach(bid => {
          if (bid.subcontractor && !subsInBids.has(bid.subcontractor.id)) {
            subsInBids.set(bid.subcontractor.id, bid.subcontractor)
          }
        })

        const subData = [
          ['SUBCONTRACTOR CONTACTS'],
          [],
          ['Company', 'Contact', 'Email', 'Phone', 'Bids Submitted']
        ]

        subsInBids.forEach(sub => {
          const bidCount = bids.filter(b =>
            b.subcontractor_id === sub.id && b.status === 'submitted'
          ).length
          subData.push([
            sub.company_name || '',
            sub.contact_name || '',
            sub.email || '',
            sub.phone || '',
            bidCount
          ])
        })

        const subWs = XLSX.utils.aoa_to_sheet(subData)
        subWs['!cols'] = [
          { wch: 30 }, // Company
          { wch: 25 }, // Contact
          { wch: 30 }, // Email
          { wch: 15 }, // Phone
          { wch: 12 }  // Bids
        ]
        XLSX.utils.book_append_sheet(wb, subWs, 'Subcontractors')
      }

      // Generate filename and download
      const filename = `Bid_Comparison_${project?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Project'}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
      XLSX.writeFile(wb, filename)

    } catch (error) {
      console.error('Export error:', error)
      alert('Failed to export. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  function exportToCSV() {
    setExporting(true)

    try {
      const data = organizeBidData()

      // Get all unique subcontractors
      const allSubs = new Set()
      bids.forEach(bid => {
        if (bid.subcontractor) {
          allSubs.add(bid.subcontractor.company_name)
        }
      })
      const subNames = Array.from(allSubs).sort()

      // Build CSV content
      const rows = []

      // Header
      rows.push(['Trade', 'Item Number', 'Description', 'Quantity', 'Unit', ...subNames, 'Lowest', 'Average'].join(','))

      Object.entries(data).forEach(([trade, items]) => {
        items.forEach(item => {
          const row = [
            `"${trade}"`,
            `"${item.item_number || ''}"`,
            `"${(item.description || '').replace(/"/g, '""')}"`,
            item.quantity || '',
            `"${item.unit || ''}"`,
            ...subNames.map(subName => {
              const bid = item.bids.find(b => b.subcontractor?.company_name === subName)
              return bid?.amount || ''
            }),
            item.lowestBid || '',
            item.averageBid ? Math.round(item.averageBid) : ''
          ]
          rows.push(row.join(','))
        })
      })

      // Create and download file
      const csvContent = rows.join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const filename = `Bid_Comparison_${project?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Project'}_${format(new Date(), 'yyyy-MM-dd')}.csv`
      link.href = URL.createObjectURL(blob)
      link.download = filename
      link.click()

    } catch (error) {
      console.error('Export error:', error)
      alert('Failed to export. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  function handleExport() {
    if (exportFormat === 'xlsx') {
      exportToExcel()
    } else {
      exportToCSV()
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Download className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Export Bid Comparison</h2>
              <p className="text-sm text-gray-500">Download bid data for analysis</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Export Format
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setExportFormat('xlsx')}
                className={`flex-1 p-3 rounded-lg border-2 transition-colors ${
                  exportFormat === 'xlsx'
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <FileSpreadsheet className={`h-6 w-6 mx-auto mb-1 ${
                  exportFormat === 'xlsx' ? 'text-primary-600' : 'text-gray-400'
                }`} />
                <p className="text-sm font-medium text-gray-900">Excel (.xlsx)</p>
                <p className="text-xs text-gray-500">Multiple sheets, formatted</p>
              </button>
              <button
                onClick={() => setExportFormat('csv')}
                className={`flex-1 p-3 rounded-lg border-2 transition-colors ${
                  exportFormat === 'csv'
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Table className={`h-6 w-6 mx-auto mb-1 ${
                  exportFormat === 'csv' ? 'text-primary-600' : 'text-gray-400'
                }`} />
                <p className="text-sm font-medium text-gray-900">CSV</p>
                <p className="text-xs text-gray-500">Simple, universal</p>
              </button>
            </div>
          </div>

          {/* Excel Options */}
          {exportFormat === 'xlsx' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Group By
                </label>
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value)}
                  className="input"
                >
                  <option value="trade">Trade/Division</option>
                  <option value="none">No Grouping</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Include in Export
                </label>
                <div className="space-y-2">
                  {[
                    { key: 'projectInfo', label: 'Project Information' },
                    { key: 'statistics', label: 'Summary Statistics' },
                    { key: 'comparison', label: 'Bid Comparison Matrix' },
                    { key: 'bidItemDetails', label: 'Detailed Bid Sheets by Trade' },
                    { key: 'subcontractorInfo', label: 'Subcontractor Contact List' },
                    { key: 'exclusions', label: 'Bid Exclusions' },
                    { key: 'clarifications', label: 'Bid Clarifications' }
                  ].map(option => (
                    <label key={option.key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeOptions[option.key]}
                        onChange={(e) => setIncludeOptions({
                          ...includeOptions,
                          [option.key]: e.target.checked
                        })}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Export Summary */}
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="font-medium text-gray-700 mb-1">Export will include:</p>
            <ul className="text-gray-600 space-y-1">
              <li>• {bidItems.length} bid items</li>
              <li>• {bids.filter(b => b.status === 'submitted').length} submitted bids</li>
              <li>• {new Set(bids.map(b => b.subcontractor_id)).size} subcontractors</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn btn-primary flex items-center gap-2"
          >
            {exporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export {exportFormat.toUpperCase()}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

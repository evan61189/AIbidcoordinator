import * as XLSX from 'xlsx'

/**
 * Export project bid data to Excel
 */
export function exportProjectToExcel(project, bidItems) {
  const wb = XLSX.utils.book_new()

  // Project Summary Sheet
  const summaryData = [
    ['Project Name', project.name],
    ['Project Number', project.project_number || 'N/A'],
    ['Location', project.location || 'N/A'],
    ['Client', project.client_name || 'N/A'],
    ['Bid Date', project.bid_date || 'N/A'],
    ['Status', project.status],
    ['Estimated Value', project.estimated_value ? `$${Number(project.estimated_value).toLocaleString()}` : 'N/A'],
  ]

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData)
  summaryWs['!cols'] = [{ wch: 20 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Project Summary')

  // Bid Items Sheet
  const bidItemsData = [
    ['Item #', 'Trade', 'Description', 'Qty', 'Unit', 'Estimated Cost', 'Lowest Bid', 'Bid Count', 'Status']
  ]

  bidItems.forEach(item => {
    const submittedBids = item.bids?.filter(b => b.status === 'submitted') || []
    const lowestBid = submittedBids.length > 0
      ? Math.min(...submittedBids.map(b => Number(b.amount) || Infinity))
      : null

    bidItemsData.push([
      item.item_number || '',
      item.trade?.name || '',
      item.description,
      item.quantity || '',
      item.unit || '',
      item.estimated_cost ? Number(item.estimated_cost) : '',
      lowestBid && lowestBid !== Infinity ? lowestBid : '',
      submittedBids.length,
      item.status
    ])
  })

  const itemsWs = XLSX.utils.aoa_to_sheet(bidItemsData)
  itemsWs['!cols'] = [
    { wch: 10 }, { wch: 25 }, { wch: 40 }, { wch: 10 },
    { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 10 }
  ]
  XLSX.utils.book_append_sheet(wb, itemsWs, 'Bid Items')

  // Bid Comparison Sheet
  const comparisonData = [
    ['Trade', 'Description', 'Subcontractor', 'Amount', 'Lead Time', 'Status']
  ]

  bidItems.forEach(item => {
    item.bids?.filter(b => ['submitted', 'accepted'].includes(b.status)).forEach(bid => {
      comparisonData.push([
        item.trade?.name || '',
        item.description.substring(0, 50),
        bid.subcontractor?.company_name || '',
        bid.amount ? Number(bid.amount) : '',
        bid.lead_time || '',
        bid.status
      ])
    })
  })

  const comparisonWs = XLSX.utils.aoa_to_sheet(comparisonData)
  comparisonWs['!cols'] = [
    { wch: 25 }, { wch: 50 }, { wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 12 }
  ]
  XLSX.utils.book_append_sheet(wb, comparisonWs, 'Bid Comparison')

  // Download
  const filename = `${project.name.replace(/[^a-z0-9]/gi, '_')}_bid_package.xlsx`
  XLSX.writeFile(wb, filename)
}

/**
 * Export subcontractor list to CSV
 */
export function exportSubcontractorsToCsv(subcontractors) {
  const headers = [
    'Company Name', 'Contact', 'Email', 'Phone', 'City', 'State', 'Trades', 'Rating', 'Preferred'
  ]

  const rows = subcontractors.map(sub => [
    sub.company_name,
    sub.contact_name || '',
    sub.email || '',
    sub.phone || '',
    sub.city || '',
    sub.state || '',
    sub.trades?.map(t => t.trade?.name).join(', ') || '',
    sub.rating || '',
    sub.is_preferred ? 'Yes' : 'No'
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell =>
      typeof cell === 'string' && cell.includes(',') ? `"${cell}"` : cell
    ).join(','))
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'subcontractors.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Export bid tabulation to Excel
 */
export function exportBidTabulation(project, bidItems) {
  const wb = XLSX.utils.book_new()

  // Group by trade
  const trades = {}
  bidItems.forEach(item => {
    const tradeName = item.trade?.name || 'Other'
    if (!trades[tradeName]) {
      trades[tradeName] = []
    }
    trades[tradeName].push(item)
  })

  // Create bid tabulation data
  const tabData = [
    [`Bid Tabulation - ${project.name}`],
    [`Bid Date: ${project.bid_date || 'TBD'}`],
    [],
  ]

  Object.entries(trades).forEach(([tradeName, items]) => {
    tabData.push([tradeName])

    items.forEach(item => {
      const bids = item.bids?.filter(b => b.status === 'submitted') || []

      // Item header row
      tabData.push(['', item.description.substring(0, 50)])

      if (bids.length > 0) {
        // Subcontractor names row
        tabData.push(['', 'Estimate', ...bids.map(b => b.subcontractor?.company_name || 'Unknown')])

        // Amounts row
        tabData.push([
          '',
          item.estimated_cost ? Number(item.estimated_cost) : '',
          ...bids.map(b => b.amount ? Number(b.amount) : '')
        ])
      }

      tabData.push([])
    })

    tabData.push([])
  })

  const ws = XLSX.utils.aoa_to_sheet(tabData)
  XLSX.utils.book_append_sheet(wb, ws, 'Bid Tabulation')

  const filename = `${project.name.replace(/[^a-z0-9]/gi, '_')}_bid_tabulation.xlsx`
  XLSX.writeFile(wb, filename)
}

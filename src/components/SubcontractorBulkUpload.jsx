import { useState, useRef } from 'react'
import { Upload, Download, FileSpreadsheet, Check, X, AlertCircle, RefreshCw } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

/**
 * SubcontractorBulkUpload Component
 * Allows bulk import of subcontractors via CSV or Excel file
 */
export default function SubcontractorBulkUpload({ trades, onSuccess, onClose }) {
  const [step, setStep] = useState(1) // 1: Upload, 2: Preview, 3: Importing
  const [file, setFile] = useState(null)
  const [parsedData, setParsedData] = useState([])
  const [validationErrors, setValidationErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, success: 0, failed: 0 })
  const fileInputRef = useRef(null)

  // Template columns
  const templateColumns = [
    { key: 'company_name', label: 'Company Name', required: true, example: 'ABC Electric Inc.' },
    { key: 'contact_name', label: 'Contact Name', required: false, example: 'John Smith' },
    { key: 'email', label: 'Email', required: false, example: 'john@abcelectric.com' },
    { key: 'phone', label: 'Phone', required: false, example: '(555) 123-4567' },
    { key: 'address', label: 'Address', required: false, example: '123 Main St' },
    { key: 'city', label: 'City', required: false, example: 'Denver' },
    { key: 'state', label: 'State', required: false, example: 'CO' },
    { key: 'zip_code', label: 'Zip Code', required: false, example: '80202' },
    { key: 'license_number', label: 'License Number', required: false, example: 'EC-12345' },
    { key: 'trades', label: 'Trade Codes (comma-separated)', required: false, example: '26,27,28' },
    { key: 'notes', label: 'Notes', required: false, example: 'Preferred vendor' },
    { key: 'is_preferred', label: 'Preferred (yes/no)', required: false, example: 'yes' },
    { key: 'rating', label: 'Rating (1-5)', required: false, example: '4' }
  ]

  /**
   * Download template file
   */
  function downloadTemplate(format = 'xlsx') {
    // Create worksheet data
    const headers = templateColumns.map(col => col.label)
    const examples = templateColumns.map(col => col.example)

    const wsData = [headers, examples]

    // Create workbook
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Set column widths
    ws['!cols'] = templateColumns.map(() => ({ wch: 20 }))

    XLSX.utils.book_append_sheet(wb, ws, 'Subcontractors')

    // Add a second sheet with trade codes reference
    const tradeData = [
      ['Trade Code', 'Trade Name'],
      ...trades.map(t => [t.division_code, t.name])
    ]
    const tradeWs = XLSX.utils.aoa_to_sheet(tradeData)
    tradeWs['!cols'] = [{ wch: 12 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(wb, tradeWs, 'Trade Codes Reference')

    // Download
    const filename = `subcontractor_import_template.${format}`
    XLSX.writeFile(wb, filename)
    toast.success(`Template downloaded: ${filename}`)
  }

  /**
   * Handle file selection
   */
  function handleFileSelect(e) {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    const validTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]

    if (!validTypes.includes(selectedFile.type) && !selectedFile.name.match(/\.(csv|xlsx|xls)$/i)) {
      toast.error('Please upload a CSV or Excel file')
      return
    }

    setFile(selectedFile)
    parseFile(selectedFile)
  }

  /**
   * Parse uploaded file
   */
  async function parseFile(file) {
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data)
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

      if (jsonData.length < 2) {
        toast.error('File appears to be empty or missing data rows')
        return
      }

      // Get headers from first row
      const headers = jsonData[0].map(h => String(h).toLowerCase().trim())

      // Map headers to our expected columns
      const headerMap = {}
      templateColumns.forEach(col => {
        const matchIndex = headers.findIndex(h =>
          h === col.key ||
          h === col.label.toLowerCase() ||
          h.includes(col.key.replace('_', ' '))
        )
        if (matchIndex !== -1) {
          headerMap[col.key] = matchIndex
        }
      })

      // Parse data rows
      const rows = []
      const errors = []

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i]
        if (!row || row.length === 0 || row.every(cell => !cell)) continue // Skip empty rows

        const parsedRow = { _rowNumber: i + 1 }
        const rowErrors = []

        // Extract values using header map
        templateColumns.forEach(col => {
          const colIndex = headerMap[col.key]
          let value = colIndex !== undefined ? row[colIndex] : undefined

          // Clean up value
          if (value !== undefined && value !== null) {
            value = String(value).trim()
            if (value === '') value = undefined
          }

          parsedRow[col.key] = value

          // Validate required fields
          if (col.required && !value) {
            rowErrors.push(`${col.label} is required`)
          }
        })

        // Validate email format
        if (parsedRow.email && !parsedRow.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
          rowErrors.push('Invalid email format')
        }

        // Validate rating
        if (parsedRow.rating) {
          const rating = parseInt(parsedRow.rating)
          if (isNaN(rating) || rating < 1 || rating > 5) {
            rowErrors.push('Rating must be 1-5')
          } else {
            parsedRow.rating = rating
          }
        }

        // Parse is_preferred
        if (parsedRow.is_preferred) {
          parsedRow.is_preferred = ['yes', 'true', '1', 'y'].includes(
            parsedRow.is_preferred.toLowerCase()
          )
        } else {
          parsedRow.is_preferred = false
        }

        // Parse trade codes
        if (parsedRow.trades) {
          const tradeCodes = parsedRow.trades.split(',').map(t => t.trim())
          const validTradeCodes = tradeCodes.filter(code =>
            trades.some(t => t.division_code === code)
          )
          const invalidCodes = tradeCodes.filter(code =>
            !trades.some(t => t.division_code === code)
          )
          if (invalidCodes.length > 0) {
            rowErrors.push(`Invalid trade codes: ${invalidCodes.join(', ')}`)
          }
          parsedRow._tradeCodes = validTradeCodes
        }

        parsedRow._errors = rowErrors
        parsedRow._isValid = rowErrors.length === 0

        if (rowErrors.length > 0) {
          errors.push({ row: i + 1, errors: rowErrors })
        }

        rows.push(parsedRow)
      }

      setParsedData(rows)
      setValidationErrors(errors)
      setStep(2)

    } catch (error) {
      console.error('Error parsing file:', error)
      toast.error('Failed to parse file. Please check the format.')
    }
  }

  /**
   * Import valid rows
   */
  async function handleImport() {
    const validRows = parsedData.filter(row => row._isValid)

    if (validRows.length === 0) {
      toast.error('No valid rows to import')
      return
    }

    setImporting(true)
    setStep(3)
    setImportProgress({ current: 0, total: validRows.length, success: 0, failed: 0 })

    let successCount = 0
    let failedCount = 0

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]
      setImportProgress(prev => ({ ...prev, current: i + 1 }))

      try {
        // Insert subcontractor
        const { data: sub, error: subError } = await supabase
          .from('subcontractors')
          .insert({
            company_name: row.company_name,
            contact_name: row.contact_name,
            email: row.email,
            phone: row.phone,
            address: row.address,
            city: row.city,
            state: row.state,
            zip_code: row.zip_code,
            license_number: row.license_number,
            notes: row.notes,
            is_preferred: row.is_preferred,
            rating: row.rating,
            is_active: true
          })
          .select()
          .single()

        if (subError) throw subError

        // Insert trade associations
        if (row._tradeCodes && row._tradeCodes.length > 0) {
          const tradeInserts = row._tradeCodes.map(code => {
            const trade = trades.find(t => t.division_code === code)
            return {
              subcontractor_id: sub.id,
              trade_id: trade.id
            }
          })

          await supabase.from('subcontractor_trades').insert(tradeInserts)
        }

        successCount++
        setImportProgress(prev => ({ ...prev, success: successCount }))

      } catch (error) {
        console.error(`Error importing row ${row._rowNumber}:`, error)
        failedCount++
        setImportProgress(prev => ({ ...prev, failed: failedCount }))
      }
    }

    setImporting(false)

    if (successCount > 0) {
      toast.success(`Imported ${successCount} subcontractor(s)`)
      onSuccess?.()
    }

    if (failedCount > 0) {
      toast.error(`Failed to import ${failedCount} row(s)`)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Bulk Import Subcontractors</h2>
            <p className="text-sm text-gray-500">
              {step === 1 && 'Upload a CSV or Excel file'}
              {step === 2 && `Preview: ${parsedData.filter(r => r._isValid).length} valid rows`}
              {step === 3 && 'Importing...'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Step 1: Upload */}
          {step === 1 && (
            <div className="space-y-6">
              {/* Template Download */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-medium text-blue-900 mb-2">Download Template</h3>
                <p className="text-sm text-blue-700 mb-3">
                  Download our template file, fill in your subcontractor data, then upload it below.
                  The template includes a reference sheet with valid trade codes.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => downloadTemplate('xlsx')}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    <Download className="h-4 w-4" />
                    Download Excel Template
                  </button>
                  <button
                    onClick={() => downloadTemplate('csv')}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-blue-300 text-blue-700 rounded hover:bg-blue-50"
                  >
                    <Download className="h-4 w-4" />
                    Download CSV Template
                  </button>
                </div>
              </div>

              {/* File Upload */}
              <div>
                <h3 className="font-medium text-gray-900 mb-2">Upload Your File</h3>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 hover:bg-primary-50 transition-colors"
                >
                  <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                  <p className="text-gray-600 mb-1">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-sm text-gray-500">
                    CSV or Excel files (.csv, .xlsx, .xls)
                  </p>
                </div>
              </div>

              {/* Column Reference */}
              <div>
                <h3 className="font-medium text-gray-900 mb-2">Required Columns</h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                    {templateColumns.map(col => (
                      <div key={col.key} className="flex items-center gap-2">
                        {col.required ? (
                          <span className="text-red-500">*</span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                        <span className={col.required ? 'font-medium' : 'text-gray-600'}>
                          {col.label}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">* Required fields</p>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex gap-4">
                <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-green-600" />
                    <span className="font-medium text-green-900">
                      {parsedData.filter(r => r._isValid).length} Valid Rows
                    </span>
                  </div>
                  <p className="text-sm text-green-700 mt-1">Ready to import</p>
                </div>
                {validationErrors.length > 0 && (
                  <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-red-600" />
                      <span className="font-medium text-red-900">
                        {validationErrors.length} Rows with Errors
                      </span>
                    </div>
                    <p className="text-sm text-red-700 mt-1">Will be skipped</p>
                  </div>
                )}
              </div>

              {/* Data Preview Table */}
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left p-3 font-medium">Row</th>
                        <th className="text-left p-3 font-medium">Status</th>
                        <th className="text-left p-3 font-medium">Company Name</th>
                        <th className="text-left p-3 font-medium">Contact</th>
                        <th className="text-left p-3 font-medium">Email</th>
                        <th className="text-left p-3 font-medium">Phone</th>
                        <th className="text-left p-3 font-medium">Trades</th>
                        <th className="text-left p-3 font-medium">Errors</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {parsedData.map((row, idx) => (
                        <tr key={idx} className={row._isValid ? '' : 'bg-red-50'}>
                          <td className="p-3 text-gray-500">{row._rowNumber}</td>
                          <td className="p-3">
                            {row._isValid ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <X className="h-4 w-4 text-red-600" />
                            )}
                          </td>
                          <td className="p-3 font-medium">{row.company_name || '-'}</td>
                          <td className="p-3">{row.contact_name || '-'}</td>
                          <td className="p-3">{row.email || '-'}</td>
                          <td className="p-3">{row.phone || '-'}</td>
                          <td className="p-3">{row._tradeCodes?.join(', ') || '-'}</td>
                          <td className="p-3 text-red-600 text-xs">
                            {row._errors?.join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Importing */}
          {step === 3 && (
            <div className="text-center py-8">
              <RefreshCw className="h-12 w-12 mx-auto mb-4 text-primary-600 animate-spin" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Importing Subcontractors...
              </h3>
              <p className="text-gray-600 mb-4">
                {importProgress.current} of {importProgress.total} processed
              </p>
              <div className="w-full max-w-md mx-auto bg-gray-200 rounded-full h-2 mb-4">
                <div
                  className="bg-primary-600 h-2 rounded-full transition-all"
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
              <div className="flex justify-center gap-6 text-sm">
                <span className="text-green-600">
                  <Check className="h-4 w-4 inline mr-1" />
                  {importProgress.success} imported
                </span>
                {importProgress.failed > 0 && (
                  <span className="text-red-600">
                    <X className="h-4 w-4 inline mr-1" />
                    {importProgress.failed} failed
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-between">
          <button
            onClick={() => {
              if (step === 2) {
                setStep(1)
                setParsedData([])
                setValidationErrors([])
                setFile(null)
              } else {
                onClose()
              }
            }}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded"
            disabled={importing}
          >
            {step === 2 ? 'Back' : 'Cancel'}
          </button>

          {step === 2 && (
            <button
              onClick={handleImport}
              disabled={parsedData.filter(r => r._isValid).length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              Import {parsedData.filter(r => r._isValid).length} Subcontractors
            </button>
          )}

          {step === 3 && !importing && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

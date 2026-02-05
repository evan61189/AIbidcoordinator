import { useState, useEffect, useRef } from 'react'
import { supabase, deleteBidItem as deleteBidItemFromDB } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import {
  Layers, Plus, Upload, FileText, ChevronDown, ChevronRight,
  RefreshCw, Check, X, TrendingUp, TrendingDown, Minus, Eye, Edit,
  Trash2, ExternalLink
} from 'lucide-react'
import toast from 'react-hot-toast'
import BidLeveling from './BidLeveling'

// Polyfill for Promise.withResolvers (needed by pdfjs-dist 5.x, not available in Safari < 17.4)
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function() {
    let resolve, reject
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// Polyfill for Promise.try (needed by pdfjs-dist 5.x, not available in older browsers)
if (typeof Promise.try !== 'function') {
  Promise.try = function(fn) {
    return new Promise((resolve) => resolve(fn()))
  }
}

// Lazy load PDF.js only when needed
let pdfjsLib = null
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib
  const pdfjs = await import('pdfjs-dist')
  pdfjsLib = pdfjs

  // Disable worker to avoid version mismatch and CORS issues
  // PDFs will be processed on the main thread (slightly slower but more reliable)
  pdfjs.GlobalWorkerOptions.workerSrc = ''

  console.log('PDF.js loaded successfully (no worker)')
  return pdfjsLib
}

/**
 * Convert a single PDF page to an image
 */
async function convertPdfPageToImage(pdf, pageNum, pdfFileName) {
  const page = await pdf.getPage(pageNum)

  // Use scale 1.0 to reduce memory usage
  const scale = 1.0
  const viewport = page.getViewport({ scale })

  // Create canvas
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const context = canvas.getContext('2d')

  // Render page to canvas
  await page.render({
    canvasContext: context,
    viewport: viewport
  }).promise

  // Convert to blob (JPEG for smaller size)
  const blob = await new Promise(resolve => {
    canvas.toBlob(resolve, 'image/jpeg', 0.8)
  })

  // Clean up immediately to free memory
  canvas.width = 0
  canvas.height = 0
  page.cleanup()

  return {
    blob,
    pageNum,
    name: `${pdfFileName.replace('.pdf', '').replace(/[^a-zA-Z0-9-_]/g, '_')}_page_${pageNum}.jpg`
  }
}

/**
 * Load a PDF and return the document and page count
 */
async function loadPdfDocument(pdfFile) {
  console.log('Starting PDF load for:', pdfFile.name)

  const pdfjs = await loadPdfJs()
  console.log('PDF.js library loaded')

  const arrayBuffer = await pdfFile.arrayBuffer()
  console.log('PDF file read, size:', arrayBuffer.byteLength)

  console.log('Loading PDF document...')
  const loadingTask = pdfjs.getDocument({
    data: arrayBuffer,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true
  })
  const pdf = await loadingTask.promise
  console.log('PDF document loaded:', pdf.numPages, 'pages')

  return pdf
}

/**
 * BidRounds Component
 * Manages pricing rounds within a project as drawings mature
 */
export default function BidRounds({ projectId, projectName, onRefresh }) {
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedRound, setExpandedRound] = useState(null)
  const [showNewRoundModal, setShowNewRoundModal] = useState(false)
  const [uploadingDrawings, setUploadingDrawings] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [editingRoundId, setEditingRoundId] = useState(null)
  const [editingRoundName, setEditingRoundName] = useState('')
  const [viewingDrawingsRoundId, setViewingDrawingsRoundId] = useState(null)
  const [roundDrawings, setRoundDrawings] = useState([])
  const [loadingDrawings, setLoadingDrawings] = useState(false)
  const [viewingBidItemsRoundId, setViewingBidItemsRoundId] = useState(null)
  const [roundBidItems, setRoundBidItems] = useState([])
  const [loadingBidItems, setLoadingBidItems] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (projectId) {
      loadRounds()
    }
  }, [projectId])

  async function loadRounds() {
    setLoading(true)
    try {
      // Load rounds with their drawings and bid items counts
      const { data: roundsData, error } = await supabase
        .from('bid_rounds')
        .select(`
          *,
          drawings:drawings(count),
          bid_items:bid_items(count)
        `)
        .eq('project_id', projectId)
        .order('round_number', { ascending: true })

      if (error) throw error

      // Also get response counts
      const roundsWithResponses = await Promise.all((roundsData || []).map(async (round) => {
        const { count } = await supabase
          .from('bid_round_responses')
          .select('*', { count: 'exact', head: true })
          .eq('bid_round_id', round.id)

        return {
          ...round,
          response_count: count || 0
        }
      }))

      setRounds(roundsWithResponses)

      // Auto-expand the active round
      const activeRound = roundsWithResponses.find(r => r.status === 'active')
      if (activeRound) {
        setExpandedRound(activeRound.id)
      }
    } catch (error) {
      console.error('Error loading rounds:', error)
      toast.error('Failed to load bid rounds')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Helper function to cascade delete bid items and clean up empty packages
   * @param {string[]} itemIds - Array of bid item IDs to delete
   * @param {boolean} cleanupEmptyPackages - Whether to delete packages that become empty
   */
  async function cascadeDeleteBidItems(itemIds, cleanupEmptyPackages = true) {
    if (!itemIds || itemIds.length === 0) return

    // Get affected package IDs before deleting
    const { data: affectedPkgItems } = await supabase
      .from('scope_package_items')
      .select('scope_package_id')
      .in('bid_item_id', itemIds)
    const affectedPackageIds = [...new Set(affectedPkgItems?.map(p => p.scope_package_id) || [])]

    // Delete from scope_package_items first (foreign key)
    await supabase
      .from('scope_package_items')
      .delete()
      .in('bid_item_id', itemIds)

    // Delete from bids (foreign key)
    await supabase
      .from('bids')
      .delete()
      .in('bid_item_id', itemIds)

    // Clean up any packages that are now empty
    if (cleanupEmptyPackages) {
      for (const pkgId of affectedPackageIds) {
        const { count } = await supabase
          .from('scope_package_items')
          .select('*', { count: 'exact', head: true })
          .eq('scope_package_id', pkgId)
        if (count === 0) {
          await supabase.from('scope_packages').delete().eq('id', pkgId)
        }
      }
    }
  }

  async function createNewRound(name, copyBidItems = true) {
    try {
      // Get the latest round number
      const maxRound = rounds.reduce((max, r) => Math.max(max, r.round_number), 0)

      // Mark current active round as superseded
      const activeRound = rounds.find(r => r.status === 'active')
      if (activeRound) {
        await supabase
          .from('bid_rounds')
          .update({ status: 'superseded' })
          .eq('id', activeRound.id)
      }

      // Create new round
      const { data: newRound, error } = await supabase
        .from('bid_rounds')
        .insert({
          project_id: projectId,
          round_number: maxRound + 1,
          name: name || `Round ${maxRound + 1}`,
          status: 'active'
        })
        .select()
        .single()

      if (error) throw error

      // Copy bid items from previous round if requested
      if (copyBidItems && activeRound) {
        const { data: prevItems } = await supabase
          .from('bid_items')
          .select('*')
          .eq('bid_round_id', activeRound.id)

        if (prevItems && prevItems.length > 0) {
          const newItems = prevItems.map(item => ({
            project_id: projectId,
            bid_round_id: newRound.id,
            trade_id: item.trade_id,
            item_number: item.item_number,
            description: item.description,
            scope_details: item.scope_details,
            quantity: item.quantity,
            unit: item.unit,
            estimated_cost: item.estimated_cost,
            bid_due_date: item.bid_due_date,
            notes: item.notes,
            ai_generated: item.ai_generated,
            ai_confidence: item.ai_confidence,
            status: 'open'
          }))

          await supabase.from('bid_items').insert(newItems)
        }
      }

      toast.success(`Created ${newRound.name}`)
      setShowNewRoundModal(false)
      loadRounds()
      return newRound
    } catch (error) {
      console.error('Error creating round:', error)
      toast.error('Failed to create bid round')
    }
  }

  async function updateRoundName(roundId, newName) {
    if (!newName.trim()) {
      toast.error('Round name cannot be empty')
      return
    }

    try {
      const { error } = await supabase
        .from('bid_rounds')
        .update({ name: newName.trim() })
        .eq('id', roundId)

      if (error) throw error

      toast.success('Round name updated')
      setEditingRoundId(null)
      setEditingRoundName('')
      loadRounds()
    } catch (error) {
      console.error('Error updating round name:', error)
      toast.error('Failed to update round name')
    }
  }

  function startEditingRound(round, e) {
    e.stopPropagation()
    setEditingRoundId(round.id)
    setEditingRoundName(round.name)
  }

  function cancelEditingRound(e) {
    e.stopPropagation()
    setEditingRoundId(null)
    setEditingRoundName('')
  }

  function handleSaveRoundName(roundId, e) {
    e.stopPropagation()
    updateRoundName(roundId, editingRoundName)
  }

  async function deleteRound(roundId, e) {
    e.stopPropagation()
    const round = rounds.find(r => r.id === roundId)
    const itemCount = round?.bid_items?.[0]?.count || 0
    const drawingCount = round?.drawings?.[0]?.count || 0

    if (!confirm(`Are you sure you want to delete "${round?.name}"?\n\nThis will permanently delete:\n• ${drawingCount} drawing(s)\n• ${itemCount} bid item(s)\n• All responses for this round\n\nThis action cannot be undone.`)) {
      return
    }

    try {
      toast.loading('Deleting round...', { id: 'delete-round' })

      // Get all drawings for this round to delete from storage
      const { data: drawings } = await supabase
        .from('drawings')
        .select('id, storage_path')
        .eq('bid_round_id', roundId)

      // Get bid item IDs for this round to properly cascade delete
      const { data: bidItemsToDelete } = await supabase
        .from('bid_items')
        .select('id')
        .eq('bid_round_id', roundId)

      if (bidItemsToDelete?.length > 0) {
        const itemIds = bidItemsToDelete.map(item => item.id)
        await cascadeDeleteBidItems(itemIds)

        // Now delete bid items for this round
        await supabase
          .from('bid_items')
          .delete()
          .eq('bid_round_id', roundId)
      }

      // Delete drawings records
      if (drawings?.length > 0) {
        await supabase
          .from('drawings')
          .delete()
          .eq('bid_round_id', roundId)

        // Delete from storage
        const storagePaths = drawings.map(d => d.storage_path).filter(Boolean)
        if (storagePaths.length > 0) {
          await supabase.storage
            .from('drawings')
            .remove(storagePaths)
        }
      }

      // Delete bid round responses
      await supabase
        .from('bid_round_responses')
        .delete()
        .eq('bid_round_id', roundId)

      // Delete bid round invitations
      await supabase
        .from('bid_round_invitations')
        .delete()
        .eq('bid_round_id', roundId)

      // Finally delete the round itself
      const { error } = await supabase
        .from('bid_rounds')
        .delete()
        .eq('id', roundId)

      if (error) throw error

      toast.dismiss('delete-round')
      toast.success(`Deleted ${round?.name}`)

      // Clear expanded state if we deleted the expanded round
      if (expandedRound === roundId) {
        setExpandedRound(null)
      }

      loadRounds()
      // Notify parent to refresh bidItems (single source of truth)
      if (onRefresh) await onRefresh()
    } catch (error) {
      toast.dismiss('delete-round')
      console.error('Error deleting round:', error)
      toast.error('Failed to delete round')
    }
  }

  async function loadDrawingsForRound(roundId) {
    setLoadingDrawings(true)
    try {
      const { data, error } = await supabase
        .from('drawings')
        .select('*')
        .eq('bid_round_id', roundId)
        .order('uploaded_at', { ascending: false })

      if (error) throw error
      setRoundDrawings(data || [])
    } catch (error) {
      console.error('Error loading drawings:', error)
      toast.error('Failed to load drawings')
    } finally {
      setLoadingDrawings(false)
    }
  }

  function openViewDrawings(roundId) {
    setViewingDrawingsRoundId(roundId)
    loadDrawingsForRound(roundId)
  }

  async function deleteDrawing(drawingId, storagePath) {
    if (!confirm('Are you sure you want to delete this drawing? This will also delete any bid items extracted from it.')) {
      return
    }

    try {
      // Delete associated bid items first
      await supabase
        .from('bid_items')
        .delete()
        .eq('source_drawing_id', drawingId)

      // Delete the drawing record
      const { error: dbError } = await supabase
        .from('drawings')
        .delete()
        .eq('id', drawingId)

      if (dbError) throw dbError

      // Try to delete from storage (may fail if path doesn't exist)
      if (storagePath) {
        await supabase.storage
          .from('drawings')
          .remove([storagePath])
      }

      toast.success('Drawing deleted')
      loadDrawingsForRound(viewingDrawingsRoundId)
      loadRounds() // Refresh counts
    } catch (error) {
      console.error('Error deleting drawing:', error)
      toast.error('Failed to delete drawing')
    }
  }

  async function deleteAllDrawings(roundId) {
    const count = roundDrawings.length
    if (!confirm(`Are you sure you want to delete all ${count} drawings from this round? This will also delete all bid items extracted from them.`)) {
      return
    }

    try {
      toast.loading(`Deleting ${count} drawings...`, { id: 'delete-all' })

      // Get all drawing IDs and storage paths
      const drawingIds = roundDrawings.map(d => d.id)
      const storagePaths = roundDrawings.map(d => d.storage_path).filter(Boolean)

      // Delete all associated bid items
      await supabase
        .from('bid_items')
        .delete()
        .in('source_drawing_id', drawingIds)

      // Delete all drawing records
      const { error: dbError } = await supabase
        .from('drawings')
        .delete()
        .in('id', drawingIds)

      if (dbError) throw dbError

      // Try to delete from storage
      if (storagePaths.length > 0) {
        await supabase.storage
          .from('drawings')
          .remove(storagePaths)
      }

      toast.dismiss('delete-all')
      toast.success(`Deleted ${count} drawings`)
      setViewingDrawingsRoundId(null)
      loadRounds()
    } catch (error) {
      toast.dismiss('delete-all')
      console.error('Error deleting drawings:', error)
      toast.error('Failed to delete drawings')
    }
  }

  async function loadBidItemsForRound(roundId) {
    setLoadingBidItems(true)
    try {
      const { data, error } = await supabase
        .from('bid_items')
        .select('*, trades(id, name, division_code)')
        .eq('bid_round_id', roundId)
        .order('item_number', { ascending: true })

      if (error) throw error
      setRoundBidItems(data || [])
    } catch (error) {
      console.error('Error loading bid items:', error)
      toast.error('Failed to load bid items')
    } finally {
      setLoadingBidItems(false)
    }
  }

  function openViewBidItems(roundId) {
    setViewingBidItemsRoundId(roundId)
    loadBidItemsForRound(roundId)
  }

  async function deleteBidItem(itemId) {
    if (!confirm('Are you sure you want to delete this bid item?')) {
      return
    }

    try {
      // Use the shared delete function that properly cleans up all related data
      await deleteBidItemFromDB(itemId)

      toast.success('Bid item deleted')
      loadBidItemsForRound(viewingBidItemsRoundId)
      loadRounds() // Refresh counts
      // Notify parent to refresh bidItems (single source of truth)
      if (onRefresh) await onRefresh()
    } catch (error) {
      console.error('Error deleting bid item:', error)
      toast.error('Failed to delete bid item')
    }
  }

  async function deleteAllBidItems(roundId) {
    const count = roundBidItems.length
    if (!confirm(`Are you sure you want to delete all ${count} bid items from this round?\n\nThis action cannot be undone.`)) {
      return
    }

    try {
      toast.loading(`Deleting ${count} bid items...`, { id: 'delete-all-items' })

      // Get all item IDs for this round
      const itemIds = roundBidItems.map(item => item.id)

      // Cascade delete related data and clean up packages
      await cascadeDeleteBidItems(itemIds)

      // Now delete the bid items
      const { error } = await supabase
        .from('bid_items')
        .delete()
        .eq('bid_round_id', roundId)

      if (error) throw error

      toast.dismiss('delete-all-items')
      toast.success(`Deleted ${count} bid items`)
      setViewingBidItemsRoundId(null)
      loadRounds()
      // Notify parent to refresh bidItems (single source of truth)
      if (onRefresh) await onRefresh()
    } catch (error) {
      toast.dismiss('delete-all-items')
      console.error('Error deleting bid items:', error)
      toast.error('Failed to delete bid items')
    }
  }

  // Delete ALL bid items for the entire project (cleanup orphans and reset)
  async function clearAllProjectBidItems() {
    // Get all item IDs for this project
    const { data: items, count } = await supabase
      .from('bid_items')
      .select('id', { count: 'exact' })
      .eq('project_id', projectId)

    if (!count || count === 0) {
      toast('No bid items to delete')
      return
    }

    if (!confirm(`Are you sure you want to delete ALL ${count} bid items for this project?\n\nThis will remove all bid items from ALL rounds, all bid packages, and any orphaned items.\n\nThis action cannot be undone.`)) {
      return
    }

    try {
      toast.loading(`Deleting ${count} bid items...`, { id: 'clear-all-project' })

      const itemIds = items.map(item => item.id)

      // Cascade delete related data (skip package cleanup since we delete all packages)
      await cascadeDeleteBidItems(itemIds, false)

      // Now delete the bid items
      const { error } = await supabase
        .from('bid_items')
        .delete()
        .eq('project_id', projectId)

      if (error) throw error

      // Delete all packages for this project
      await supabase
        .from('scope_packages')
        .delete()
        .eq('project_id', projectId)

      toast.dismiss('clear-all-project')
      toast.success(`Deleted all ${count} bid items and packages`)
      loadRounds()
      // Notify parent to refresh bidItems (single source of truth)
      if (onRefresh) await onRefresh()
    } catch (error) {
      toast.dismiss('clear-all-project')
      console.error('Error clearing all bid items:', error)
      toast.error('Failed to clear bid items')
    }
  }

  async function uploadToSupabaseStorage(file, roundId) {
    const timestamp = Date.now()
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const storagePath = `projects/${projectId}/rounds/${roundId}/${timestamp}_${sanitizedFilename}`

    const { data, error } = await supabase.storage
      .from('drawings')
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false
      })

    if (error) {
      console.error('Storage upload error:', error)
      throw new Error(`Failed to upload file to storage: ${error.message}`)
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('drawings')
      .getPublicUrl(storagePath)

    return {
      storagePath: data.path,
      storageUrl: urlData.publicUrl,
      fileSize: file.size,
      mimeType: file.type
    }
  }

  async function processAndUploadImage(imageFile, roundId, originalPdfName = null) {
    // Upload to Supabase Storage
    const storageResult = await uploadToSupabaseStorage(imageFile, roundId)
    console.log(`Uploaded ${imageFile.name} to storage:`, storageResult.storagePath)

    // Call function to process the uploaded file with retry logic
    let lastError
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch('/.netlify/functions/process-uploaded-drawing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            bid_round_id: roundId,
            project_name: projectName,
            storage_path: storageResult.storagePath,
            storage_url: storageResult.storageUrl,
            original_filename: originalPdfName || imageFile.name,
            file_type: imageFile.type,
            file_size: imageFile.size,
            process_with_ai: true
          })
        })

        const contentType = response.headers.get('content-type')
        let result
        if (contentType && contentType.includes('application/json')) {
          result = await response.json()
        } else {
          const responseText = await response.text()
          console.error('Non-JSON response:', responseText.substring(0, 500))
          throw new Error('Server returned an invalid response.')
        }

        if (!response.ok) {
          throw new Error(result.details || result.error || 'Processing failed')
        }

        return result
      } catch (error) {
        lastError = error
        console.warn(`Attempt ${attempt} failed:`, error.message)
        if (attempt < 3) {
          // Wait before retry (2s, 4s)
          await new Promise(r => setTimeout(r, attempt * 2000))
        }
      }
    }

    throw lastError
  }

  // Helper to add delay between operations
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async function handleDrawingUpload(roundId, files) {
    console.log('handleDrawingUpload called with', files?.length, 'files')
    if (!files || files.length === 0) return

    setUploadingDrawings(true)
    setUploadProgress({ current: 0, total: files.length })

    let totalBidItemsCreated = 0
    let totalPagesProcessed = 0

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        console.log('Processing file:', file.name, 'type:', file.type)

        // Check if file is a PDF - process pages one at a time to avoid memory issues
        if (file.type === 'application/pdf') {
          let pdf
          try {
            setUploadProgress({
              current: i + 1,
              total: files.length,
              filename: file.name,
              phase: 'uploading original PDF'
            })

            // First, upload the original PDF to drawings/specifications folder for email attachments
            const timestamp = Date.now()
            const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
            const pdfStoragePath = `projects/${projectId}/drawings-specifications/${timestamp}_${sanitizedFilename}`

            const { data: pdfUpload, error: pdfUploadError } = await supabase.storage
              .from('drawings')
              .upload(pdfStoragePath, file, {
                contentType: 'application/pdf',
                upsert: false
              })

            if (pdfUploadError) {
              console.error('PDF storage upload error:', pdfUploadError)
            }

            const { data: pdfUrlData } = supabase.storage
              .from('drawings')
              .getPublicUrl(pdfStoragePath)

            const pdfStorageResult = {
              storagePath: pdfUpload?.path || pdfStoragePath,
              storageUrl: pdfUrlData.publicUrl,
              fileSize: file.size,
              mimeType: 'application/pdf'
            }
            console.log(`Original PDF uploaded to drawings-specifications folder:`, pdfStorageResult.storagePath)

            // Create a drawing record for the original PDF (for email attachments)
            const { data: pdfDrawing, error: pdfDrawingError } = await supabase
              .from('drawings')
              .insert({
                project_id: projectId,
                bid_round_id: roundId,
                original_filename: file.name,
                filename: file.name,
                storage_path: pdfStorageResult.storagePath,
                storage_url: pdfStorageResult.storageUrl,
                file_size: pdfStorageResult.fileSize,
                file_type: 'pdf',  // Use 'pdf' for original PDF files (column is VARCHAR(10))
                is_current: true,
                ai_processed: false
              })
              .select()
              .single()

            if (pdfDrawingError) {
              console.warn('Error creating PDF drawing record:', pdfDrawingError)
            } else {
              console.log(`PDF drawing record created: ${pdfDrawing.id}`)
            }

            setUploadProgress({
              current: i + 1,
              total: files.length,
              filename: file.name,
              phase: 'loading PDF'
            })

            pdf = await loadPdfDocument(file)
            const numPages = Math.min(pdf.numPages, 100) // Max 100 pages

            // Process each page one at a time (convert, upload, free memory)
            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
              setUploadProgress({
                current: i + 1,
                total: files.length,
                filename: `${file.name} (page ${pageNum}/${numPages})`,
                phase: 'converting page'
              })

              try {
                // Convert single page
                console.log(`Converting page ${pageNum}/${numPages}...`)
                const img = await convertPdfPageToImage(pdf, pageNum, file.name)
                console.log(`Page ${pageNum} converted, size: ${img.blob.size}`)

                // Update status
                setUploadProgress({
                  current: i + 1,
                  total: files.length,
                  filename: `${file.name} (page ${pageNum}/${numPages})`,
                  phase: 'processing with AI'
                })

                // Create File object and upload
                const imageFile = new File([img.blob], img.name, { type: 'image/jpeg' })
                const result = await processAndUploadImage(imageFile, roundId, file.name)

                // Track bid items
                const created = result.bid_items_created || 0
                totalBidItemsCreated += created
                totalPagesProcessed++

                console.log(`Page ${pageNum} processed:`, { created, summary: result.summary })

                // Force garbage collection hint
                img.blob = null

                // Small delay between pages to avoid network overload
                if (pageNum < numPages) {
                  await delay(500)
                }
              } catch (pageError) {
                console.error(`Error processing page ${pageNum}:`, pageError)
                // Continue with next page after a brief pause
                await delay(1000)
              }
            }

            // Clean up PDF
            pdf.destroy()
          } catch (pdfError) {
            console.error('PDF error:', pdfError)
            toast.error(`Failed to process PDF: ${pdfError.message}`)
            if (pdf) pdf.destroy()
            continue
          }
        } else {
          // For images, process directly
          setUploadProgress({
            current: i + 1,
            total: files.length,
            filename: file.name,
            phase: 'processing with AI'
          })

          const result = await processAndUploadImage(file, roundId)

          // Track bid items
          const created = result.bid_items_created || 0
          totalBidItemsCreated += created
          totalPagesProcessed++

          console.log(`Processed ${file.name}:`, {
            created,
            summary: result.summary
          })
        }
      }

      // Consolidate bid items by trade using AI
      if (totalBidItemsCreated > 0) {
        try {
          // First, get list of trades to consolidate
          setUploadProgress({
            current: files.length,
            total: files.length,
            filename: 'Preparing consolidation...',
            phase: 'consolidating'
          })

          const tradesResponse = await fetch('/.netlify/functions/consolidate-bid-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bid_round_id: roundId,
              project_id: projectId
            })
          })

          if (tradesResponse.ok) {
            const tradesResult = await tradesResponse.json()
            const trades = tradesResult.trades || []

            console.log(`Found ${trades.length} trades to consolidate`)

            let totalOriginal = 0
            let totalFinal = 0

            // Process each trade one at a time
            for (let t = 0; t < trades.length; t++) {
              const trade = trades[t]

              setUploadProgress({
                current: t + 1,
                total: trades.length,
                filename: `Consolidating ${trade.trade_name}...`,
                phase: 'consolidating'
              })

              toast.loading(`AI consolidating ${trade.trade_name}...`, { id: 'consolidate' })

              try {
                const tradeResponse = await fetch('/.netlify/functions/consolidate-bid-items', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    bid_round_id: roundId,
                    project_id: projectId,
                    trade_id: trade.trade_id
                  })
                })

                if (tradeResponse.ok) {
                  const result = await tradeResponse.json()
                  console.log(`Consolidated ${trade.trade_name}:`, result)
                  totalOriginal += result.original_count || 0
                  totalFinal += result.final_count || 0
                }
              } catch (tradeError) {
                console.error(`Error consolidating ${trade.trade_name}:`, tradeError)
              }

              toast.dismiss('consolidate')

              // Small delay between trades
              if (t < trades.length - 1) {
                await delay(500)
              }
            }

            if (totalOriginal > 0) {
              console.log(`Total consolidation: ${totalOriginal} -> ${totalFinal} items`)
              // Update count to reflect consolidation
              totalBidItemsCreated = totalBidItemsCreated - totalOriginal + totalFinal
            }
          }
        } catch (consolidateError) {
          toast.dismiss('consolidate')
          console.error('Consolidation error:', consolidateError)
          // Don't fail the upload if consolidation fails
        }
      }

      // Show success message
      let bidItemsMsg
      if (totalBidItemsCreated > 0) {
        bidItemsMsg = ` and created ${totalBidItemsCreated} scope item(s) from ${totalPagesProcessed} page(s)`
      } else {
        bidItemsMsg = ` (${totalPagesProcessed} page(s) processed, no bid items extracted)`
      }
      toast.success(`Uploaded ${files.length} drawing(s)${bidItemsMsg}`)
      loadRounds()
    } catch (error) {
      console.error('Upload error:', error)
      toast.error(`Upload failed: ${error.message}`)
    } finally {
      setUploadingDrawings(false)
      setUploadProgress(null)
    }
  }

  function formatDate(dateString) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const statusColors = {
    active: 'bg-green-100 text-green-800',
    closed: 'bg-gray-100 text-gray-800',
    superseded: 'bg-yellow-100 text-yellow-800'
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Loading bid rounds...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold">Bid Rounds</h2>
            <span className="text-sm text-gray-500">({rounds.length} rounds)</span>
          </div>
          <button
            onClick={clearAllProjectBidItems}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded border border-red-200"
            title="Delete all bid items for this project"
          >
            <Trash2 className="w-4 h-4" />
            Clear All Items
          </button>
          <button
            onClick={() => setShowNewRoundModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" />
            New Round
          </button>
        </div>

        {rounds.length === 0 ? (
          <div className="p-8 text-center">
            <Layers className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No Bid Rounds Yet</h3>
            <p className="text-sm text-gray-500 mb-4">
              Create your first bid round to start uploading drawings and collecting bids.
            </p>
            <button
              onClick={() => setShowNewRoundModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Create First Round
            </button>
          </div>
        ) : (
          <div className="divide-y">
            {rounds.map((round) => (
              <div key={round.id} className="border-b last:border-b-0">
                {/* Round Header */}
                <button
                  onClick={() => setExpandedRound(expandedRound === round.id ? null : round.id)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 group"
                >
                  <div className="flex items-center gap-4">
                    {expandedRound === round.id ? (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    )}
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        {editingRoundId === round.id ? (
                          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingRoundName}
                              onChange={(e) => setEditingRoundName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRoundName(round.id, e)
                                if (e.key === 'Escape') cancelEditingRound(e)
                              }}
                              className="px-2 py-1 border rounded text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              autoFocus
                            />
                            <button
                              onClick={(e) => handleSaveRoundName(round.id, e)}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                              title="Save"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={cancelEditingRound}
                              className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="font-medium text-gray-900">{round.name}</span>
                            <button
                              onClick={(e) => startEditingRound(round, e)}
                              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Edit name"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => deleteRound(round.id, e)}
                              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Delete round"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-xs ${statusColors[round.status]}`}>
                          {round.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500">
                        {round.drawing_revision && `${round.drawing_revision} • `}
                        Created {formatDate(round.created_at)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{round.drawings?.[0]?.count || 0}</div>
                      <div className="text-gray-500">Drawings</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{round.bid_items?.[0]?.count || 0}</div>
                      <div className="text-gray-500">Bid Items</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-gray-900">{round.response_count}</div>
                      <div className="text-gray-500">Responses</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium text-green-600">{formatCurrency(round.lowest_total)}</div>
                      <div className="text-gray-500">Lowest</div>
                    </div>
                  </div>
                </button>

                {/* Expanded Round Content */}
                {expandedRound === round.id && (
                  <div className="px-6 pb-6 pt-2 bg-gray-50 border-t">
                    {/* Actions */}
                    <div className="flex gap-2 mb-4">
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        multiple
                        accept=".pdf,.png,.jpg,.jpeg"
                        onChange={(e) => handleDrawingUpload(round.id, Array.from(e.target.files))}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingDrawings || round.status === 'superseded'}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border rounded hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Upload className="w-4 h-4" />
                        {uploadingDrawings ? 'Uploading...' : 'Upload Drawings'}
                      </button>
                      <button
                        onClick={() => openViewDrawings(round.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border rounded hover:bg-gray-50"
                      >
                        <Eye className="w-4 h-4" />
                        View Drawings ({round.drawings?.[0]?.count || 0})
                      </button>
                      <button
                        onClick={() => openViewBidItems(round.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border rounded hover:bg-gray-50"
                      >
                        <FileText className="w-4 h-4" />
                        View Bid Items ({round.bid_items?.[0]?.count || 0})
                      </button>
                    </div>

                    {/* Upload Progress */}
                    {uploadProgress && (
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
                        <div className="flex items-center gap-2 text-sm text-blue-800">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>
                            {uploadProgress.phase === 'uploading to storage'
                              ? 'Uploading to storage'
                              : uploadProgress.phase === 'processing with AI'
                              ? 'Processing with AI (this may take a minute for multi-page PDFs)'
                              : 'Uploading'
                            } ({uploadProgress.current} of {uploadProgress.total})...
                          </span>
                          {uploadProgress.filename && (
                            <span className="text-blue-600 truncate max-w-xs">{uploadProgress.filename}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Round Details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="bg-white p-3 rounded border">
                        <div className="text-xs text-gray-500 mb-1">Due Date</div>
                        <div className="font-medium">{formatDate(round.due_date) || 'Not set'}</div>
                      </div>
                      <div className="bg-white p-3 rounded border">
                        <div className="text-xs text-gray-500 mb-1">Drawing Revision</div>
                        <div className="font-medium">{round.drawing_revision || 'Not specified'}</div>
                      </div>
                      <div className="bg-white p-3 rounded border">
                        <div className="text-xs text-gray-500 mb-1">Lowest Bid</div>
                        <div className="font-medium text-green-600">{formatCurrency(round.lowest_total)}</div>
                      </div>
                      <div className="bg-white p-3 rounded border">
                        <div className="text-xs text-gray-500 mb-1">Average Bid</div>
                        <div className="font-medium">{formatCurrency(round.average_total)}</div>
                      </div>
                    </div>

                    {round.description && (
                      <div className="mb-4 p-3 bg-white rounded border">
                        <div className="text-xs text-gray-500 mb-1">Notes</div>
                        <div className="text-sm">{round.description}</div>
                      </div>
                    )}

                    {/* Bid Responses for this round */}
                    <RoundResponses roundId={round.id} projectName={projectName} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pricing Comparison Across Rounds */}
      {rounds.length > 1 && (
        <RoundComparison rounds={rounds} projectId={projectId} />
      )}

      {/* New Round Modal */}
      {showNewRoundModal && (
        <NewRoundModal
          existingRounds={rounds}
          onClose={() => setShowNewRoundModal(false)}
          onSubmit={createNewRound}
        />
      )}

      {/* View Drawings Modal */}
      {viewingDrawingsRoundId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Drawings for {rounds.find(r => r.id === viewingDrawingsRoundId)?.name}
                <span className="text-sm font-normal text-gray-500 ml-2">
                  ({roundDrawings.length} files)
                </span>
              </h2>
              <div className="flex items-center gap-2">
                {roundDrawings.length > 0 && (
                  <button
                    onClick={() => deleteAllDrawings(viewingDrawingsRoundId)}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded flex items-center gap-1"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete All
                  </button>
                )}
                <button
                  onClick={() => setViewingDrawingsRoundId(null)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {loadingDrawings ? (
                <div className="flex items-center justify-center gap-2 text-gray-500 py-8">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Loading drawings...
                </div>
              ) : roundDrawings.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No drawings uploaded yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {roundDrawings.map((drawing) => (
                    <div
                      key={drawing.id}
                      className="border rounded-lg p-4 flex items-center justify-between hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <FileText className="w-8 h-8 text-gray-400 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate">
                            {drawing.original_filename || drawing.filename}
                          </div>
                          <div className="text-sm text-gray-500 flex items-center gap-2 flex-wrap">
                            {drawing.drawing_number && (
                              <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">
                                {drawing.drawing_number}
                              </span>
                            )}
                            {drawing.title && <span className="truncate">{drawing.title}</span>}
                            {drawing.discipline && (
                              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs">
                                {drawing.discipline}
                              </span>
                            )}
                            <span className="text-gray-400">
                              {drawing.file_size ? `${(drawing.file_size / 1024).toFixed(0)} KB` : ''}
                            </span>
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            Uploaded {new Date(drawing.uploaded_at).toLocaleDateString()}
                            {drawing.ai_processed && ' • AI processed'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                        {drawing.storage_url && (
                          <a
                            href={drawing.storage_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                            title="Open in new tab"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          onClick={() => deleteDrawing(drawing.id, drawing.storage_path)}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Delete drawing"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t bg-gray-50">
              <button
                onClick={() => setViewingDrawingsRoundId(null)}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Bid Items Modal */}
      {viewingBidItemsRoundId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Bid Items for {rounds.find(r => r.id === viewingBidItemsRoundId)?.name}
                <span className="text-sm font-normal text-gray-500 ml-2">
                  ({roundBidItems.length} items)
                </span>
              </h2>
              <div className="flex items-center gap-2">
                {roundBidItems.length > 0 && (
                  <button
                    onClick={() => deleteAllBidItems(viewingBidItemsRoundId)}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded flex items-center gap-1"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete All
                  </button>
                )}
                <button
                  onClick={() => setViewingBidItemsRoundId(null)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {loadingBidItems ? (
                <div className="flex items-center justify-center gap-2 text-gray-500 py-8">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Loading bid items...
                </div>
              ) : roundBidItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No bid items in this round</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Group by trade */}
                  {Object.entries(
                    roundBidItems.reduce((acc, item) => {
                      const tradeName = item.trades?.name || 'Unassigned'
                      if (!acc[tradeName]) acc[tradeName] = []
                      acc[tradeName].push(item)
                      return acc
                    }, {})
                  ).map(([tradeName, items]) => (
                    <div key={tradeName} className="border rounded-lg overflow-hidden">
                      <div className="bg-gray-100 px-4 py-2 font-medium text-gray-700 flex items-center justify-between">
                        <span>{tradeName}</span>
                        <span className="text-sm text-gray-500">{items.length} item(s)</span>
                      </div>
                      <div className="divide-y">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="px-4 py-3 flex items-start justify-between hover:bg-gray-50 group"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400 font-mono">
                                  {item.item_number || '-'}
                                </span>
                                <span className="text-sm text-gray-900">
                                  {item.description}
                                </span>
                              </div>
                              {(item.quantity || item.notes) && (
                                <div className="text-xs text-gray-500 mt-1 flex gap-3">
                                  {item.quantity && <span>Qty: {item.quantity} {item.unit || ''}</span>}
                                  {item.notes && <span className="truncate max-w-md">{item.notes}</span>}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => deleteBidItem(item.id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                              title="Delete bid item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t bg-gray-50">
              <button
                onClick={() => setViewingBidItemsRoundId(null)}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Round Responses Component - Shows bid responses for a specific round
 */
function RoundResponses({ roundId, projectName }) {
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadResponses()
  }, [roundId])

  async function loadResponses() {
    try {
      const { data, error } = await supabase
        .from('bid_round_responses')
        .select(`
          *,
          subcontractor:subcontractor_id (id, company_name, contact_name, email)
        `)
        .eq('bid_round_id', roundId)
        .order('total_amount', { ascending: true })

      if (error) throw error
      setResponses(data || [])
    } catch (error) {
      console.error('Error loading responses:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Loading responses...</div>
  }

  if (responses.length === 0) {
    return (
      <div className="text-sm text-gray-500 p-4 bg-white rounded border text-center">
        No bid responses yet for this round.
      </div>
    )
  }

  const lowestAmount = Math.min(...responses.filter(r => r.total_amount).map(r => r.total_amount))

  return (
    <div className="bg-white rounded border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left p-3 font-medium">Subcontractor</th>
            <th className="text-right p-3 font-medium">Amount</th>
            <th className="text-center p-3 font-medium">Status</th>
            <th className="text-center p-3 font-medium">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {responses.map((response) => (
            <tr key={response.id} className="hover:bg-gray-50">
              <td className="p-3">
                <div className="font-medium">{response.subcontractor?.company_name}</div>
                <div className="text-xs text-gray-500">{response.subcontractor?.email}</div>
              </td>
              <td className="p-3 text-right">
                <div className={`font-medium ${response.total_amount === lowestAmount ? 'text-green-600' : ''}`}>
                  {formatCurrency(response.total_amount)}
                </div>
                {response.total_amount === lowestAmount && (
                  <span className="text-xs text-green-600">Lowest</span>
                )}
              </td>
              <td className="p-3 text-center">
                <span className={`px-2 py-1 rounded-full text-xs ${
                  response.status === 'approved' ? 'bg-green-100 text-green-800' :
                  response.status === 'rejected' ? 'bg-red-100 text-red-800' :
                  response.status === 'awarded' ? 'bg-purple-100 text-purple-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {response.status?.replace('_', ' ')}
                </span>
              </td>
              <td className="p-3 text-center">
                {response.price_change_percent ? (
                  <div className={`flex items-center justify-center gap-1 ${
                    response.price_change_percent < 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {response.price_change_percent < 0 ? (
                      <TrendingDown className="w-4 h-4" />
                    ) : response.price_change_percent > 0 ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : (
                      <Minus className="w-4 h-4" />
                    )}
                    {Math.abs(response.price_change_percent).toFixed(1)}%
                  </div>
                ) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Round Comparison Component - Compare pricing across rounds
 */
function RoundComparison({ rounds, projectId }) {
  const [comparisonData, setComparisonData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadComparison()
  }, [rounds])

  async function loadComparison() {
    try {
      // Get all subcontractors who have responded in any round
      const { data } = await supabase
        .from('bid_round_responses')
        .select(`
          bid_round_id,
          total_amount,
          subcontractor:subcontractor_id (id, company_name)
        `)
        .in('bid_round_id', rounds.map(r => r.id))

      // Group by subcontractor
      const bySubcontractor = {}
      data?.forEach(response => {
        const subId = response.subcontractor?.id
        if (!subId) return
        if (!bySubcontractor[subId]) {
          bySubcontractor[subId] = {
            subcontractor: response.subcontractor,
            rounds: {}
          }
        }
        bySubcontractor[subId].rounds[response.bid_round_id] = response.total_amount
      })

      setComparisonData(Object.values(bySubcontractor))
    } catch (error) {
      console.error('Error loading comparison:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading || comparisonData.length === 0) return null

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b">
        <h3 className="font-semibold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          Pricing Comparison Across Rounds
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Subcontractor</th>
              {rounds.map(round => (
                <th key={round.id} className="text-right p-3 font-medium">
                  {round.name}
                </th>
              ))}
              <th className="text-right p-3 font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {comparisonData.map((row) => {
              const amounts = rounds.map(r => row.rounds[r.id]).filter(Boolean)
              const firstAmount = amounts[0]
              const lastAmount = amounts[amounts.length - 1]
              const change = firstAmount && lastAmount ? ((lastAmount - firstAmount) / firstAmount * 100) : null

              return (
                <tr key={row.subcontractor.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium">{row.subcontractor.company_name}</td>
                  {rounds.map(round => (
                    <td key={round.id} className="p-3 text-right">
                      {formatCurrency(row.rounds[round.id])}
                    </td>
                  ))}
                  <td className="p-3 text-right">
                    {change !== null && (
                      <span className={change < 0 ? 'text-green-600' : change > 0 ? 'text-red-600' : ''}>
                        {change > 0 ? '+' : ''}{change.toFixed(1)}%
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * New Round Modal
 */
function NewRoundModal({ existingRounds, onClose, onSubmit }) {
  const [name, setName] = useState(`Round ${existingRounds.length + 1}`)
  const [revision, setRevision] = useState('')
  const [copyBidItems, setCopyBidItems] = useState(true)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    await onSubmit(name, copyBidItems)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Create New Bid Round</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Round Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g., DD Pricing, GMP Round 1"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Drawing Revision (optional)
            </label>
            <input
              type="text"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g., DD Set Rev 1, 100% CD"
            />
          </div>
          {existingRounds.length > 0 && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={copyBidItems}
                onChange={(e) => setCopyBidItems(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-700">
                Copy bid items from previous round
              </span>
            </label>
          )}
          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Round'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

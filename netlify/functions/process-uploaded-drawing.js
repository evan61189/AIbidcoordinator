/**
 * Process Uploaded Drawing
 *
 * Processes a drawing that was already uploaded to Supabase Storage.
 * Converts PDFs to images for more reliable AI analysis.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const config = {
  maxDuration: 300 // 5 minutes for AI processing
}

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'
const MAX_PAGES_PER_BATCH = 20 // Claude can handle ~20 images well

// Initialize clients
function getSupabase() {
  if (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    return createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    )
  }
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY
    )
  }
  return null
}

function getAnthropic() {
  if (process.env.ANTHROPIC_API_KEY) {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return null
}

/**
 * Download file from Supabase Storage
 */
async function downloadFromStorage(supabase, storagePath) {
  const { data, error } = await supabase.storage
    .from('drawings')
    .download(storagePath)

  if (error) {
    console.error('Storage download error:', error)
    throw new Error(`Failed to download file: ${error.message}`)
  }

  const arrayBuffer = await data.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  return {
    buffer,
    base64: buffer.toString('base64'),
    size: buffer.length
  }
}

/**
 * Convert PDF buffer to images using pdfjs-dist and canvas
 */
async function convertPdfToImages(pdfBuffer) {
  console.log('Converting PDF to images...')

  try {
    // Dynamic imports for PDF processing
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { createCanvas } = await import('canvas')

    // Load the PDF
    const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer })
    const pdf = await loadingTask.promise
    const numPages = pdf.numPages

    console.log(`PDF has ${numPages} pages`)

    const images = []
    const pagesToProcess = Math.min(numPages, MAX_PAGES_PER_BATCH * 2) // Process up to 40 pages

    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      console.log(`Rendering page ${pageNum}/${pagesToProcess}`)

      const page = await pdf.getPage(pageNum)

      // Use a reasonable scale for construction drawings (150 DPI)
      const scale = 1.5
      const viewport = page.getViewport({ scale })

      // Create canvas
      const canvas = createCanvas(viewport.width, viewport.height)
      const context = canvas.getContext('2d')

      // Render page to canvas
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise

      // Convert to PNG base64
      const imageBuffer = canvas.toBuffer('image/png')
      const base64 = imageBuffer.toString('base64')

      images.push({
        pageNum,
        base64,
        width: viewport.width,
        height: viewport.height
      })
    }

    console.log(`Converted ${images.length} pages to images`)
    return { success: true, images, totalPages: numPages }

  } catch (error) {
    console.error('PDF to image conversion failed:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * Analyze drawing images with Claude AI
 */
async function analyzeDrawingImages(anthropic, images, projectName) {
  const content = []

  // Add images (limit to MAX_PAGES_PER_BATCH per request)
  const imagesToProcess = images.slice(0, MAX_PAGES_PER_BATCH)

  console.log(`Analyzing ${imagesToProcess.length} images with Claude...`)

  for (const img of imagesToProcess) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: img.base64
      }
    })
  }

  content.push({
    type: 'text',
    text: `You are analyzing ${imagesToProcess.length} pages of construction drawings${projectName ? ` for "${projectName}"` : ''}.

Extract ALL bid items/scope items that a general contractor would need to solicit from subcontractors. Be thorough.

For EACH page, identify work items that need to be bid by trade.

CSI MasterFormat Division Codes:
- 01: General Requirements
- 02: Existing Conditions (demo, abatement)
- 03: Concrete
- 04: Masonry
- 05: Metals (structural steel, misc metals)
- 06: Wood/Plastics/Composites
- 07: Thermal/Moisture Protection
- 08: Openings (doors, windows, hardware)
- 09: Finishes (drywall, paint, flooring, ceilings)
- 10: Specialties
- 11: Equipment
- 12: Furnishings
- 14: Conveying Equipment
- 21: Fire Suppression
- 22: Plumbing
- 23: HVAC
- 26: Electrical
- 27: Communications
- 31: Earthwork
- 32: Exterior Improvements

Return JSON:
{
  "drawing_info": {
    "sheet_number": "A1.01",
    "title": "Floor Plan",
    "discipline": "Architectural"
  },
  "bid_items": [
    {
      "division_code": "09",
      "trade_name": "Finishes",
      "description": "Gypsum board partitions",
      "quantity": "TBD",
      "unit": "SF",
      "notes": "",
      "confidence": 0.85
    }
  ],
  "summary": "Description of drawings"
}

IMPORTANT: Extract 10-50+ bid items from these drawings. Be specific and thorough.`
  })

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    system: 'You are an expert construction estimator. Analyze these construction drawing images and extract comprehensive bid items by CSI MasterFormat. Return only valid JSON.',
    messages: [{ role: 'user', content }]
  })

  return message.content[0].text
}

/**
 * Analyze single image with Claude AI
 */
async function analyzeImageFile(anthropic, fileData, mimeType, projectName) {
  console.log('Analyzing image file directly...')

  const content = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: fileData.base64
      }
    },
    {
      type: 'text',
      text: `Analyze this construction drawing${projectName ? ` for "${projectName}"` : ''}.

Extract ALL bid items that a general contractor would need from subcontractors.

Return JSON:
{
  "drawing_info": { "sheet_number": "", "title": "", "discipline": "" },
  "bid_items": [
    { "division_code": "09", "trade_name": "Finishes", "description": "...", "quantity": "TBD", "unit": "SF", "notes": "", "confidence": 0.85 }
  ],
  "summary": "..."
}

Extract 5-20+ specific bid items. Be thorough.`
    }
  ]

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    system: 'Expert construction estimator. Extract bid items by CSI MasterFormat. Return only valid JSON.',
    messages: [{ role: 'user', content }]
  })

  return message.content[0].text
}

/**
 * Parse JSON from Claude response
 */
function parseAnalysisResponse(responseText) {
  console.log('Parsing response, length:', responseText.length)

  try {
    // Try code block first
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      const parsed = JSON.parse(codeBlockMatch[1].trim())
      console.log('Parsed from code block, bid_items:', parsed.bid_items?.length || 0)
      return parsed
    }

    // Try raw JSON
    const jsonStart = responseText.indexOf('{')
    if (jsonStart !== -1) {
      let depth = 0
      let jsonEnd = -1
      for (let i = jsonStart; i < responseText.length; i++) {
        if (responseText[i] === '{') depth++
        if (responseText[i] === '}') depth--
        if (depth === 0) {
          jsonEnd = i + 1
          break
        }
      }
      if (jsonEnd > jsonStart) {
        const parsed = JSON.parse(responseText.substring(jsonStart, jsonEnd))
        console.log('Parsed raw JSON, bid_items:', parsed.bid_items?.length || 0)
        return parsed
      }
    }
  } catch (e) {
    console.error('JSON parse error:', e.message)
    console.error('Response preview:', responseText.substring(0, 500))
  }

  return {
    drawing_info: {},
    bid_items: [],
    summary: 'Analysis completed but JSON parsing failed',
    raw_response: responseText.substring(0, 2000)
  }
}

/**
 * Convert MIME type to short file extension
 */
function getShortFileType(mimeType) {
  const mimeMap = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpg',
    'image/webp': 'webp'
  }
  return mimeMap[mimeType] || mimeType?.split('/').pop()?.substring(0, 10) || 'unknown'
}

/**
 * Truncate string to fit column limit
 */
function truncate(str, maxLen) {
  if (!str) return str
  return str.length > maxLen ? str.substring(0, maxLen) : str
}

/**
 * Save drawing record to database
 */
async function saveDrawingRecord(supabase, data) {
  const { data: drawing, error } = await supabase
    .from('drawings')
    .insert({
      project_id: data.projectId,
      bid_round_id: data.bidRoundId,
      filename: truncate(data.storagePath.split('/').pop(), 255),
      original_filename: truncate(data.originalFilename, 255),
      drawing_number: truncate(data.drawingInfo?.sheet_number, 50),
      title: truncate(data.drawingInfo?.title, 200),
      discipline: truncate(data.drawingInfo?.discipline_code || data.drawingInfo?.discipline, 50),
      revision: truncate(data.drawingInfo?.revision, 20),
      revision_date: data.drawingInfo?.revision_date,
      file_type: getShortFileType(data.fileType),
      file_size: data.fileSize,
      storage_path: data.storagePath,
      storage_url: data.storageUrl,
      version_number: 1,
      is_current: true,
      ai_processed: true,
      ai_processed_at: new Date().toISOString()
    })
    .select()
    .single()

  if (error) {
    console.error('Error saving drawing:', error)
    throw error
  }

  return drawing
}

/**
 * Save bid items extracted from drawing
 */
async function saveBidItems(supabase, projectId, bidRoundId, drawingId, bidItems, trades) {
  if (!bidItems || bidItems.length === 0) {
    console.log('No bid items to save')
    return []
  }

  if (!trades || trades.length === 0) {
    console.error('No trades available for mapping')
    return []
  }

  console.log(`Saving ${bidItems.length} bid items, ${trades.length} trades available`)

  // Map trade names and codes to IDs
  const tradeMap = {}
  let defaultTradeId = null
  trades.forEach(t => {
    tradeMap[t.division_code] = t.id
    tradeMap[t.division_code.replace(/^0/, '')] = t.id
    tradeMap[t.name.toLowerCase()] = t.id
    if (t.division_code === '01') {
      defaultTradeId = t.id
    }
  })

  if (!defaultTradeId && trades.length > 0) {
    defaultTradeId = trades[0].id
  }

  const itemsToInsert = bidItems.map((item, idx) => {
    const normalizedCode = item.division_code ?
      item.division_code.toString().padStart(2, '0') : null

    const tradeId = tradeMap[normalizedCode] ||
                  tradeMap[item.division_code] ||
                  tradeMap[item.trade_name?.toLowerCase()] ||
                  defaultTradeId

    return {
      project_id: projectId,
      bid_round_id: bidRoundId,
      trade_id: tradeId,
      source_drawing_id: drawingId,
      item_number: `${normalizedCode || '00'}-${String(idx + 1).padStart(3, '0')}`,
      description: truncate(item.description, 500),
      quantity: item.quantity,
      unit: item.unit,
      notes: item.notes,
      ai_generated: true,
      ai_confidence: item.confidence || 0.5,
      status: 'open'
    }
  }).filter(item => item.trade_id && item.description)

  if (itemsToInsert.length === 0) {
    console.log('No valid bid items after filtering')
    return []
  }

  console.log(`Inserting ${itemsToInsert.length} bid items`)

  const { data, error } = await supabase
    .from('bid_items')
    .insert(itemsToInsert)
    .select()

  if (error) {
    console.error('Error saving bid items:', error)
    return []
  }

  return data
}

export async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers }
  }

  if (event.httpMethod === 'GET') {
    const supabase = getSupabase()
    const anthropic = getAnthropic()

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        endpoint: 'process-uploaded-drawing',
        hasSupabase: !!supabase,
        hasAnthropic: !!anthropic,
        features: ['PDF to image conversion', 'Multi-page support']
      })
    }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  const supabase = getSupabase()
  const anthropic = getAnthropic()

  if (!supabase) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Supabase not configured' })
    }
  }

  if (!anthropic) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Anthropic API not configured' })
    }
  }

  try {
    const body = JSON.parse(event.body)
    const {
      project_id: projectId,
      bid_round_id: bidRoundId,
      project_name: projectName,
      storage_path: storagePath,
      storage_url: storageUrl,
      original_filename: originalFilename,
      file_type: fileType,
      file_size: fileSize,
      process_with_ai: processWithAI = true
    } = body

    if (!projectId || !storagePath) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'project_id and storage_path are required' })
      }
    }

    console.log(`Processing: ${storagePath}`)
    console.log(`Type: ${fileType}, Size: ${fileSize} bytes`)

    // Download file
    const fileData = await downloadFromStorage(supabase, storagePath)
    console.log(`Downloaded ${fileData.size} bytes`)

    let analysis = { drawing_info: {}, bid_items: [] }

    if (processWithAI) {
      let responseText

      if (fileType === 'application/pdf') {
        // Convert PDF to images first
        console.log('Converting PDF to images for analysis...')
        const conversion = await convertPdfToImages(fileData.buffer)

        if (conversion.success && conversion.images.length > 0) {
          console.log(`Successfully converted ${conversion.images.length} pages`)
          responseText = await analyzeDrawingImages(anthropic, conversion.images, projectName)
        } else {
          // Fallback: try document type anyway
          console.log('PDF conversion failed, trying document type...')
          try {
            const content = [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: fileData.base64
                }
              },
              {
                type: 'text',
                text: `Analyze these construction drawings for "${projectName || 'Unknown Project'}". Extract all bid items by CSI division. Return JSON with drawing_info, bid_items array, and summary.`
              }
            ]

            const message = await anthropic.messages.create({
              model: CLAUDE_MODEL,
              max_tokens: 8192,
              system: 'Expert construction estimator. Return only valid JSON.',
              messages: [{ role: 'user', content }]
            })
            responseText = message.content[0].text
          } catch (pdfError) {
            console.error('PDF document type also failed:', pdfError.message)
            analysis = {
              drawing_info: {},
              bid_items: [],
              summary: `PDF processing failed: ${pdfError.message}. Try uploading individual page images instead.`,
              error: pdfError.message
            }
          }
        }
      } else if (fileType && fileType.startsWith('image/')) {
        // Direct image analysis
        responseText = await analyzeImageFile(anthropic, fileData, fileType, projectName)
      } else {
        console.log('Unsupported file type:', fileType)
        analysis = {
          drawing_info: {},
          bid_items: [],
          summary: `Unsupported file type: ${fileType}`
        }
      }

      if (responseText) {
        analysis = parseAnalysisResponse(responseText)
      }
    }

    // Get trades for mapping
    const { data: trades } = await supabase.from('trades').select('id, division_code, name')

    // Save drawing record
    const drawing = await saveDrawingRecord(supabase, {
      projectId,
      bidRoundId,
      storagePath,
      storageUrl,
      originalFilename,
      fileType,
      fileSize,
      drawingInfo: analysis.drawing_info
    })

    // Save bid items
    let savedBidItems = []
    if (analysis.bid_items && analysis.bid_items.length > 0 && trades) {
      savedBidItems = await saveBidItems(
        supabase,
        projectId,
        bidRoundId,
        drawing.id,
        analysis.bid_items,
        trades
      )
    }

    console.log(`Complete: ${savedBidItems.length} bid items saved`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        drawing_id: drawing.id,
        storage_url: storageUrl,
        drawing_info: analysis.drawing_info,
        bid_items_extracted: analysis.bid_items?.length || 0,
        bid_items_created: savedBidItems.length,
        summary: analysis.summary,
        error: analysis.error || null
      })
    }

  } catch (error) {
    console.error('Processing error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to process drawing',
        details: error.message
      })
    }
  }
}

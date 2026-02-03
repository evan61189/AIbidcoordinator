/**
 * Upload and Process Drawings
 *
 * Handles drawing file uploads to Supabase Storage,
 * processes with AI to extract bid items, and tracks in database.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import busboy from 'busboy'

export const config = {
  maxDuration: 300 // 5 minutes for large file uploads + AI processing
}

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

// Initialize clients
function getSupabase() {
  if (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    return createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY // Use service key for storage operations
    )
  }
  // Fallback to anon key
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
 * Parse multipart form data upload
 */
async function parseUpload(event) {
  return new Promise((resolve, reject) => {
    const fields = {}
    const files = []

    const contentType = event.headers['content-type'] || event.headers['Content-Type']

    if (!contentType || !contentType.includes('multipart/form-data')) {
      reject(new Error('Expected multipart/form-data'))
      return
    }

    const bb = busboy({ headers: { 'content-type': contentType } })

    bb.on('field', (name, value) => {
      fields[name] = value
    })

    bb.on('file', (name, file, info) => {
      const { filename, mimeType } = info
      const chunks = []

      file.on('data', (chunk) => chunks.push(chunk))
      file.on('end', () => {
        const buffer = Buffer.concat(chunks)
        files.push({
          fieldName: name,
          filename: filename,
          mimeType: mimeType,
          size: buffer.length,
          buffer: buffer,
          base64: buffer.toString('base64')
        })
      })
    })

    bb.on('finish', () => resolve({ fields, files }))
    bb.on('error', reject)

    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body

    bb.end(body)
  })
}

/**
 * Upload file to Supabase Storage
 */
async function uploadToStorage(supabase, projectId, bidRoundId, file) {
  const timestamp = Date.now()
  const sanitizedFilename = file.filename.replace(/[^a-zA-Z0-9.-]/g, '_')
  const storagePath = `projects/${projectId}/rounds/${bidRoundId}/${timestamp}_${sanitizedFilename}`

  const { data, error } = await supabase.storage
    .from('drawings')
    .upload(storagePath, file.buffer, {
      contentType: file.mimeType,
      upsert: false
    })

  if (error) {
    console.error('Storage upload error:', error)
    throw new Error(`Failed to upload file: ${error.message}`)
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('drawings')
    .getPublicUrl(storagePath)

  return {
    storagePath: data.path,
    storageUrl: urlData.publicUrl,
    fileSize: file.size
  }
}

/**
 * Analyze drawing with Claude AI
 */
async function analyzeDrawing(anthropic, file, projectName, drawingType) {
  const content = []

  // Add the file based on type
  if (file.mimeType === 'application/pdf') {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: file.base64
      }
    })
  } else if (file.mimeType.startsWith('image/')) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: file.mimeType,
        data: file.base64
      }
    })
  }

  content.push({
    type: 'text',
    text: `You are analyzing construction drawings${projectName ? ` for the project "${projectName}"` : ''}${drawingType ? ` (${drawingType} drawings)` : ''}.

Your task is to extract ALL bid items/scope items that a general contractor would need to solicit from subcontractors. Be thorough and comprehensive.

For each sheet/page in the document, identify:
1. Drawing information (sheet number, title, discipline)
2. ALL work items that need to be bid by trade

CSI MasterFormat Division Codes:
- 01: General Requirements
- 02: Existing Conditions (demo, abatement)
- 03: Concrete
- 04: Masonry
- 05: Metals (structural steel, misc metals)
- 06: Wood/Plastics/Composites (rough carpentry, finish carpentry, casework)
- 07: Thermal/Moisture Protection (roofing, insulation, waterproofing)
- 08: Openings (doors, windows, hardware, glazing)
- 09: Finishes (drywall, paint, flooring, ceilings, tile)
- 10: Specialties (toilet accessories, signage, lockers)
- 11: Equipment (kitchen equipment, lab equipment)
- 12: Furnishings (furniture, window treatments)
- 13: Special Construction
- 14: Conveying Equipment (elevators)
- 21: Fire Suppression
- 22: Plumbing
- 23: HVAC
- 26: Electrical
- 27: Communications
- 28: Electronic Safety/Security
- 31: Earthwork
- 32: Exterior Improvements (paving, landscaping)
- 33: Utilities

Return a JSON object with this EXACT structure:
{
  "drawing_info": {
    "sheet_number": "A1.01",
    "title": "Floor Plan - Level 1",
    "discipline": "Architectural",
    "discipline_code": "A",
    "revision": "1",
    "revision_date": "2024-01-15"
  },
  "bid_items": [
    {
      "division_code": "09",
      "trade_name": "Finishes",
      "description": "Gypsum board partitions - full height to deck",
      "quantity": "Approx 2,500 LF",
      "unit": "LF",
      "notes": "Include acoustic insulation at rated walls",
      "confidence": 0.85
    },
    {
      "division_code": "09",
      "trade_name": "Finishes",
      "description": "Level 5 finish at all GWB surfaces",
      "quantity": "TBD",
      "unit": "SF",
      "notes": "",
      "confidence": 0.8
    }
  ],
  "summary": "First floor architectural plan showing office layout with conference rooms, open office areas, and support spaces."
}

IMPORTANT:
- Extract MULTIPLE bid items - most drawings have 5-20+ items
- Be specific in descriptions (e.g., "hollow metal door frames" not just "doors")
- Include quantities when visible or estimable
- Group related items appropriately
- Include ALL trades visible in the drawings`
  })

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    system: 'You are an expert construction estimator and bid coordinator. Your job is to analyze construction drawings and extract comprehensive bid items organized by CSI MasterFormat divisions. Be thorough - extract ALL scope items visible in the drawings. Return only valid JSON.',
    messages: [{ role: 'user', content }]
  })

  const responseText = message.content[0].text

  // Parse JSON
  try {
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim())
    }

    const jsonStart = responseText.indexOf('{')
    if (jsonStart !== -1) {
      let braceCount = 0
      let jsonEnd = -1
      for (let i = jsonStart; i < responseText.length; i++) {
        if (responseText[i] === '{') braceCount++
        if (responseText[i] === '}') braceCount--
        if (braceCount === 0) {
          jsonEnd = i + 1
          break
        }
      }
      if (jsonEnd > jsonStart) {
        return JSON.parse(responseText.substring(jsonStart, jsonEnd))
      }
    }
  } catch (e) {
    console.error('JSON parse error:', e.message)
  }

  return {
    drawing_info: {},
    bid_items: [],
    summary: 'Analysis completed but extraction failed',
    raw_response: responseText
  }
}

/**
 * Convert MIME type to short file extension (fits VARCHAR(10))
 */
function getShortFileType(mimeType) {
  const mimeMap = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
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

  // Map trade names and codes to IDs (handle both "9" and "09" formats)
  const tradeMap = {}
  let defaultTradeId = null
  trades.forEach(t => {
    // Store by division code as-is
    tradeMap[t.division_code] = t.id
    // Also store without leading zero (e.g., "9" for "09")
    tradeMap[t.division_code.replace(/^0/, '')] = t.id
    // Store by name (lowercase)
    tradeMap[t.name.toLowerCase()] = t.id
    // Track default trade (General Requirements)
    if (t.division_code === '01') {
      defaultTradeId = t.id
    }
  })

  // If no General Requirements trade, use first available
  if (!defaultTradeId && trades.length > 0) {
    defaultTradeId = trades[0].id
  }

  const itemsToInsert = bidItems.map((item, idx) => {
    // Normalize division code (pad single digits)
    const normalizedCode = item.division_code ?
      item.division_code.toString().padStart(2, '0') : null

    // Find trade ID with multiple fallbacks
    let tradeId = tradeMap[normalizedCode] ||
                  tradeMap[item.division_code] ||
                  tradeMap[item.trade_name?.toLowerCase()] ||
                  defaultTradeId

    if (!tradeId) {
      console.warn(`No trade found for item: ${item.description} (code: ${item.division_code}, trade: ${item.trade_name})`)
    }

    return {
      project_id: projectId,
      bid_round_id: bidRoundId,
      trade_id: tradeId,
      source_drawing_id: drawingId,
      item_number: `${normalizedCode || '00'}-${String(idx + 1).padStart(3, '0')}`,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      notes: item.notes,
      ai_generated: true,
      ai_confidence: item.confidence || 0.5,
      status: 'open'
    }
  }).filter(item => item.trade_id && item.description)

  if (itemsToInsert.length === 0) {
    console.log('No valid bid items to insert after filtering')
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

  // Health check
  if (event.httpMethod === 'GET') {
    const supabase = getSupabase()
    const anthropic = getAnthropic()

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        endpoint: 'upload-drawing',
        hasSupabase: !!supabase,
        hasAnthropic: !!anthropic,
        supportedTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
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

  try {
    console.log('Parsing upload...')
    const { fields, files } = await parseUpload(event)

    const projectId = fields.project_id
    const bidRoundId = fields.bid_round_id
    const projectName = fields.project_name
    const drawingType = fields.drawing_type
    const processWithAI = fields.process_with_ai !== 'false'

    if (!projectId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'project_id is required' })
      }
    }

    if (files.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No files uploaded' })
      }
    }

    console.log(`Processing ${files.length} file(s) for project ${projectId}`)

    // Get trades for bid item mapping
    const { data: trades } = await supabase.from('trades').select('id, division_code, name')

    const results = []

    for (const file of files) {
      console.log(`Processing: ${file.filename} (${file.mimeType}, ${file.size} bytes)`)

      // Upload to storage
      const storageResult = await uploadToStorage(supabase, projectId, bidRoundId || 'unassigned', file)
      console.log(`Uploaded to: ${storageResult.storagePath}`)

      let analysis = { drawing_info: {}, bid_items: [] }

      // Analyze with AI if enabled
      if (processWithAI && anthropic) {
        console.log('Analyzing with AI...')
        try {
          analysis = await analyzeDrawing(anthropic, file, projectName, drawingType)
          console.log(`AI extracted ${analysis.bid_items?.length || 0} bid items`)
        } catch (aiError) {
          console.error('AI analysis error:', aiError.message)
          analysis = { drawing_info: {}, bid_items: [], error: aiError.message }
        }
      }

      // Save drawing record
      const drawing = await saveDrawingRecord(supabase, {
        projectId,
        bidRoundId,
        storagePath: storageResult.storagePath,
        storageUrl: storageResult.storageUrl,
        originalFilename: file.filename,
        fileType: file.mimeType,
        fileSize: file.size,
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

      results.push({
        filename: file.filename,
        drawing_id: drawing.id,
        storage_url: storageResult.storageUrl,
        drawing_info: analysis.drawing_info,
        bid_items_created: savedBidItems.length,
        summary: analysis.summary
      })
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        files_processed: results.length,
        results
      })
    }

  } catch (error) {
    console.error('Upload error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to process upload',
        details: error.message
      })
    }
  }
}

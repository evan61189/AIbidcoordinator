/**
 * Process Uploaded Drawing
 *
 * Processes a drawing image that was already uploaded to Supabase Storage.
 * PDF to image conversion happens on the frontend - this only handles images.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const config = {
  maxDuration: 300 // 5 minutes for AI processing
}

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

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
 * Analyze image with Claude AI
 */
async function analyzeImage(anthropic, base64Data, mimeType, projectName) {
  console.log(`Analyzing image (${mimeType}, ${base64Data.length} chars base64)`)

  const content = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: base64Data
      }
    },
    {
      type: 'text',
      text: `You are analyzing a construction drawing page${projectName ? ` for "${projectName}"` : ''}.

Extract ALL bid items/scope items that a general contractor would need to solicit from subcontractors. Be thorough and comprehensive.

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
      "description": "Gypsum board partitions - full height",
      "quantity": "TBD",
      "unit": "SF",
      "notes": "",
      "confidence": 0.85
    }
  ],
  "summary": "Description of what this drawing shows"
}

IMPORTANT: Extract 5-20+ bid items from this drawing. Be specific and thorough.`
    }
  ]

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    temperature: 0, // Deterministic for consistent extraction across runs
    system: 'You are an expert construction estimator. Analyze this construction drawing and extract comprehensive bid items by CSI MasterFormat. Return only valid JSON.',
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

    // Build comprehensive notes including spec section and location
    const noteParts = []
    if (item.spec_section) noteParts.push(`Spec: ${item.spec_section}`)
    if (item.location) noteParts.push(`Location: ${item.location}`)
    if (item.notes) noteParts.push(item.notes)
    const combinedNotes = noteParts.join(' | ')

    return {
      project_id: projectId,
      bid_round_id: bidRoundId,
      trade_id: tradeId,
      source_drawing_id: drawingId,
      item_number: `${normalizedCode || '00'}-${String(idx + 1).padStart(3, '0')}`,
      description: truncate(item.description, 1000),
      quantity: item.quantity,
      unit: item.unit,
      notes: truncate(combinedNotes, 500),
      spec_section: item.spec_section || null,
      location: item.location || null,
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
        note: 'PDF conversion happens on frontend - this processes images only'
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
      // Determine mime type for image analysis
      let mimeType = fileType
      if (!mimeType || mimeType === 'application/pdf') {
        // If it's a PNG converted from PDF
        mimeType = 'image/png'
      }

      console.log('Starting AI analysis...')
      try {
        const responseText = await analyzeImage(anthropic, fileData.base64, mimeType, projectName)
        analysis = parseAnalysisResponse(responseText)
        console.log(`AI extracted ${analysis.bid_items?.length || 0} bid items`)
      } catch (aiError) {
        console.error('AI analysis error:', aiError.message)
        analysis = {
          drawing_info: {},
          bid_items: [],
          summary: `AI analysis failed: ${aiError.message}`,
          error: aiError.message
        }
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

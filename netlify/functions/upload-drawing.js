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
    text: `Analyze this construction drawing${projectName ? ` for "${projectName}"` : ''}${drawingType ? ` (${drawingType})` : ''}.

Extract:
1. Drawing information (sheet number, title, discipline, revision)
2. Bid items by CSI division

Return JSON:
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
      "description": "Description of work item",
      "quantity": "Qty or TBD",
      "unit": "SF/LF/EA/LS",
      "notes": "Special notes",
      "confidence": 0.85
    }
  ],
  "summary": "Brief description of what this drawing shows"
}`
  })

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: 'You are an expert construction estimator. Analyze drawings and extract bid items by CSI MasterFormat. Return only valid JSON.',
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
 * Save drawing record to database
 */
async function saveDrawingRecord(supabase, data) {
  const { data: drawing, error } = await supabase
    .from('drawings')
    .insert({
      project_id: data.projectId,
      bid_round_id: data.bidRoundId,
      filename: data.storagePath.split('/').pop(),
      original_filename: data.originalFilename,
      drawing_number: data.drawingInfo?.sheet_number,
      title: data.drawingInfo?.title,
      discipline: data.drawingInfo?.discipline_code || data.drawingInfo?.discipline,
      revision: data.drawingInfo?.revision,
      revision_date: data.drawingInfo?.revision_date,
      file_type: data.fileType,
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
  if (!bidItems || bidItems.length === 0) return []

  // Map trade names to IDs
  const tradeMap = {}
  trades.forEach(t => {
    tradeMap[t.division_code] = t.id
    tradeMap[t.name.toLowerCase()] = t.id
  })

  const itemsToInsert = bidItems.map((item, idx) => {
    // Find trade ID
    let tradeId = tradeMap[item.division_code] ||
                  tradeMap[item.trade_name?.toLowerCase()] ||
                  trades.find(t => t.division_code === '01')?.id // Default to General Requirements

    return {
      project_id: projectId,
      bid_round_id: bidRoundId,
      trade_id: tradeId,
      source_drawing_id: drawingId,
      item_number: `${item.division_code || '00'}-${String(idx + 1).padStart(3, '0')}`,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      notes: item.notes,
      ai_generated: true,
      ai_confidence: item.confidence || 0.5,
      status: 'open'
    }
  }).filter(item => item.trade_id) // Only insert items with valid trade

  if (itemsToInsert.length === 0) return []

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

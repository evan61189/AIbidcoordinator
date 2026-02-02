/**
 * AI Drawing Analysis using Anthropic Claude Vision
 *
 * Analyzes construction drawings to automatically generate bid items by trade
 * Supports up to 30 pages for typical Clipper Construction jobs
 */

import Anthropic from '@anthropic-ai/sdk'

// Netlify function configuration - extend timeout for AI processing
export const config = {
  maxDuration: 300 // 5 minutes for Netlify Pro
}

// Process one image at a time to avoid timeouts
const BATCH_SIZE = 1
const MAX_IMAGES = 30

// Use Claude 3.5 Sonnet for best accuracy with construction drawings
const CLAUDE_MODEL = 'claude-3-5-sonnet-20241022'

// CSI MasterFormat divisions for categorization
const CSI_DIVISIONS = {
  '01': 'General Requirements',
  '02': 'Existing Conditions',
  '03': 'Concrete',
  '04': 'Masonry',
  '05': 'Metals',
  '06': 'Wood, Plastics, and Composites',
  '07': 'Thermal and Moisture Protection',
  '08': 'Openings',
  '09': 'Finishes',
  '10': 'Specialties',
  '11': 'Equipment',
  '12': 'Furnishings',
  '13': 'Special Construction',
  '14': 'Conveying Equipment',
  '21': 'Fire Suppression',
  '22': 'Plumbing',
  '23': 'HVAC',
  '25': 'Integrated Automation',
  '26': 'Electrical',
  '27': 'Communications',
  '28': 'Electronic Safety and Security',
  '31': 'Earthwork',
  '32': 'Exterior Improvements',
  '33': 'Utilities'
}

/**
 * Analyze a batch of images with Claude
 */
async function analyzeBatch(anthropic, images, batchNumber, totalBatches, projectName, drawingType, additionalContext) {
  console.log(`Batch ${batchNumber}: Processing ${images.length} image(s)`)

  const imageContents = images.map((img, idx) => {
    // Extract base64 data, handling various formats
    let base64Data = img.data
    let mediaType = img.media_type || 'image/png'

    // Remove data URI prefix if present
    const dataUriMatch = base64Data.match(/^data:([^;]+);base64,(.+)$/)
    if (dataUriMatch) {
      mediaType = dataUriMatch[1]
      base64Data = dataUriMatch[2]
    }

    console.log(`Image ${idx + 1}: type=${mediaType}, size=${base64Data.length} chars`)

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64Data
      }
    }
  })

  const systemPrompt = `You are an expert construction estimator and quantity surveyor. Your task is to analyze construction drawings and extract a comprehensive list of bid items organized by CSI MasterFormat trade divisions.

For each item you identify, provide:
1. The appropriate CSI division code and trade name
2. A clear description of the work item
3. Estimated quantity if discernible (with units like SF, LF, EA, CY, etc.)
4. Any special notes or considerations

Be thorough and identify ALL visible scope items. Consider:
- Structural elements (foundations, framing, steel)
- Architectural elements (walls, ceilings, finishes, doors, windows)
- MEP systems (plumbing, HVAC, electrical if visible)
- Site work and exterior elements
- Specialties and equipment

Always organize by trade/division for easy bid solicitation.`

  const batchInfo = totalBatches > 1
    ? `\n\nThis is batch ${batchNumber} of ${totalBatches} from the drawing set. Focus on extracting items visible in these specific sheets.`
    : ''

  const userPrompt = `Analyze these construction drawings${projectName ? ` for "${projectName}"` : ''}${drawingType ? ` (${drawingType} drawings)` : ''} and generate a comprehensive list of bid items organized by CSI trade division.
${batchInfo}
${additionalContext ? `\nAdditional context: ${additionalContext}` : ''}

Return your analysis as a JSON object with this exact structure:
{
  "drawing_summary": "Brief description of what these specific sheets show",
  "sheets_analyzed": ["List of sheet numbers/names if visible"],
  "bid_items": [
    {
      "division_code": "XX",
      "trade_name": "Trade Name",
      "item_number": "XX-001",
      "description": "Detailed description of the work item",
      "quantity": "Estimated quantity or 'TBD'",
      "unit": "Unit of measure (SF, LF, EA, LS, etc.)",
      "notes": "Any special considerations, alternates, or clarifications"
    }
  ],
  "items_to_verify": ["Items that need field verification or clarification"]
}

Be comprehensive - it's better to include more items that can be combined later than to miss scope.`

  console.log(`Batch ${batchNumber}: Calling Claude API...`)
  const startTime = Date.now()

  let message
  try {
    message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContents,
            { type: 'text', text: userPrompt }
          ]
        }
      ],
      system: systemPrompt
    })
  } catch (apiError) {
    console.error(`Batch ${batchNumber}: Claude API error:`, apiError.message)
    throw apiError
  }

  const elapsed = Date.now() - startTime
  console.log(`Batch ${batchNumber}: Claude responded in ${elapsed}ms`)

  const responseText = message.content[0].text

  // Try to parse JSON from response
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (parseError) {
    console.error('JSON parse error in batch:', parseError)
  }

  return {
    drawing_summary: 'Analysis completed but structured extraction failed',
    bid_items: [],
    raw_analysis: responseText
  }
}

/**
 * Merge and deduplicate bid items from multiple batches
 */
function mergeBatchResults(batchResults) {
  const allItems = []
  const summaries = []
  const sheetsAnalyzed = []
  const itemsToVerify = []
  let projectType = 'Unknown'

  for (const result of batchResults) {
    if (result.drawing_summary) {
      summaries.push(result.drawing_summary)
    }
    if (result.project_type && result.project_type !== 'Unknown') {
      projectType = result.project_type
    }
    if (result.sheets_analyzed) {
      sheetsAnalyzed.push(...result.sheets_analyzed)
    }
    if (result.bid_items) {
      allItems.push(...result.bid_items)
    }
    if (result.items_to_verify) {
      itemsToVerify.push(...result.items_to_verify)
    }
  }

  // Deduplicate bid items by description similarity
  const uniqueItems = []
  const seenDescriptions = new Set()

  for (const item of allItems) {
    // Normalize description for comparison
    const normalizedDesc = item.description.toLowerCase().trim()

    // Check if we've seen a very similar item
    let isDuplicate = false
    for (const seen of seenDescriptions) {
      if (normalizedDesc === seen ||
          (normalizedDesc.length > 20 && seen.includes(normalizedDesc.substring(0, 20)))) {
        isDuplicate = true
        break
      }
    }

    if (!isDuplicate) {
      seenDescriptions.add(normalizedDesc)
      uniqueItems.push(item)
    }
  }

  // Sort by division code
  uniqueItems.sort((a, b) => {
    const codeA = a.division_code || '99'
    const codeB = b.division_code || '99'
    return codeA.localeCompare(codeB)
  })

  // Renumber items
  const itemCounts = {}
  for (const item of uniqueItems) {
    const code = item.division_code || '00'
    itemCounts[code] = (itemCounts[code] || 0) + 1
    item.item_number = `${code}-${String(itemCounts[code]).padStart(3, '0')}`
  }

  return {
    drawing_summary: summaries.join(' | '),
    project_type: projectType,
    sheets_analyzed: [...new Set(sheetsAnalyzed)],
    bid_items: uniqueItems,
    items_to_verify: [...new Set(itemsToVerify)],
    recommendations: [
      'Review all quantities against actual takeoff',
      'Verify scope items span all sheets in the drawing set',
      'Confirm MEP coordination requirements'
    ]
  }
}

export async function handler(event) {
  // Set CORS and content-type headers for all responses
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers }
  }

  // GET request - return status/health check
  if (event.httpMethod === 'GET') {
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        hasApiKey,
        model: CLAUDE_MODEL,
        maxImages: MAX_IMAGES,
        batchSize: BATCH_SIZE
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Anthropic API key not configured. Add ANTHROPIC_API_KEY to Netlify environment variables.' })
    }
  }

  let parsedBody
  try {
    parsedBody = JSON.parse(event.body)
  } catch (parseError) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Invalid request body. Could not parse JSON.',
        details: 'Request may be too large or malformed.'
      })
    }
  }

  try {
    const { images, project_name, drawing_type, additional_context } = parsedBody

    if (!images || !Array.isArray(images) || images.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'At least one image is required. Send base64 encoded images.' })
      }
    }

    // Check payload size - warn if images might be too large
    const totalSize = images.reduce((acc, img) => acc + (img.data?.length || 0), 0)
    if (totalSize > 5000000) { // ~5MB warning threshold
      console.warn(`Large payload: ${(totalSize / 1000000).toFixed(2)}MB`)
    }

    // Initialize Anthropic client inside handler to ensure API key is available
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })

    // Limit to MAX_IMAGES
    const imagesToProcess = images.slice(0, MAX_IMAGES)
    const totalImages = imagesToProcess.length

    // Split into batches
    const batches = []
    for (let i = 0; i < imagesToProcess.length; i += BATCH_SIZE) {
      batches.push(imagesToProcess.slice(i, i + BATCH_SIZE))
    }

    console.log(`Processing ${totalImages} images in ${batches.length} batch(es)`)

    // Process batches (sequentially to avoid rate limits)
    const batchResults = []
    for (let i = 0; i < batches.length; i++) {
      console.log(`Processing batch ${i + 1} of ${batches.length}...`)
      const result = await analyzeBatch(
        anthropic,
        batches[i],
        i + 1,
        batches.length,
        project_name,
        drawing_type,
        additional_context
      )
      batchResults.push(result)
    }

    // Merge results from all batches
    const mergedResult = mergeBatchResults(batchResults)

    // Add CSI trade names if only codes provided
    if (mergedResult.bid_items) {
      mergedResult.bid_items = mergedResult.bid_items.map(item => ({
        ...item,
        trade_name: item.trade_name || CSI_DIVISIONS[item.division_code] || 'Other'
      }))
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        analysis: mergedResult,
        images_analyzed: totalImages,
        batches_processed: batches.length,
        model_used: CLAUDE_MODEL
      })
    }

  } catch (error) {
    console.error('Error analyzing drawings:', error)

    // Provide more specific error messages
    let errorMessage = 'Failed to analyze drawings'
    let statusCode = 500

    if (error.status === 401) {
      errorMessage = 'Invalid Anthropic API key. Please check your configuration.'
      statusCode = 401
    } else if (error.status === 429) {
      errorMessage = 'Rate limit exceeded. Please wait and try again.'
      statusCode = 429
    } else if (error.status === 400) {
      errorMessage = 'Invalid request to AI service. Image format may be unsupported.'
      statusCode = 400
    } else if (error.message?.includes('Could not process image')) {
      errorMessage = 'Unable to process one or more images. Please ensure images are clear and in a supported format (PNG, JPG).'
    }

    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: errorMessage,
        details: error.message
      })
    }
  }
}

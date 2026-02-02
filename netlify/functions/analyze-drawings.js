/**
 * AI Drawing Analysis using Anthropic Claude Vision
 *
 * Analyzes construction drawings to automatically generate bid items by trade
 */

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

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

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Anthropic API key not configured' })
    }
  }

  try {
    const { images, project_name, drawing_type, additional_context } = JSON.parse(event.body)

    if (!images || !Array.isArray(images) || images.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'At least one image is required. Send base64 encoded images.' })
      }
    }

    // Build the image content for Claude
    const imageContents = images.slice(0, 10).map(img => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.media_type || 'image/png',
        data: img.data.replace(/^data:image\/\w+;base64,/, '') // Strip data URL prefix if present
      }
    }))

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

    const userPrompt = `Analyze these construction drawings${project_name ? ` for "${project_name}"` : ''}${drawing_type ? ` (${drawing_type} drawings)` : ''} and generate a comprehensive list of bid items organized by CSI trade division.

${additional_context ? `Additional context: ${additional_context}` : ''}

Return your analysis as a JSON object with this exact structure:
{
  "drawing_summary": "Brief description of what the drawings show",
  "project_type": "Type of construction (commercial, residential, industrial, etc.)",
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
  "recommendations": ["Any recommendations for the bidding process"],
  "items_to_verify": ["Items that need field verification or clarification"]
}

Be comprehensive - it's better to include more items that can be combined later than to miss scope.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
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

    // Extract the response
    const responseText = message.content[0].text

    // Try to parse JSON from response
    let analysisResult
    try {
      // Find JSON in the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON found in response')
      }
    } catch (parseError) {
      // If JSON parsing fails, return structured error with raw analysis
      console.error('JSON parse error:', parseError)
      analysisResult = {
        drawing_summary: 'Analysis completed but structured extraction failed',
        project_type: 'Unknown',
        bid_items: [],
        raw_analysis: responseText,
        parse_error: true
      }
    }

    // Add CSI trade names if only codes provided
    if (analysisResult.bid_items) {
      analysisResult.bid_items = analysisResult.bid_items.map(item => ({
        ...item,
        trade_name: item.trade_name || CSI_DIVISIONS[item.division_code] || 'Other'
      }))
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        analysis: analysisResult,
        images_analyzed: images.length,
        model_used: 'claude-sonnet-4-20250514'
      })
    }

  } catch (error) {
    console.error('Error analyzing drawings:', error)

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to analyze drawings',
        details: error.message
      })
    }
  }
}

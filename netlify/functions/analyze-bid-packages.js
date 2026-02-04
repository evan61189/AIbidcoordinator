const Anthropic = require('@anthropic-ai/sdk').default

/**
 * AI-powered bid package analysis
 * Groups bid items based on how subcontractors typically bid work together.
 */

// Condensed trade groupings for faster processing
const TRADE_GROUPINGS = `
SUBCONTRACTOR PACKAGES (group bid items by these trade bundles):
- DEMOLITION: demo, selective demo, hazmat, site clearing
- SITEWORK: excavation, grading, utilities, erosion control
- CONCRETE: foundations, slabs, tilt-up, site concrete, rebar
- MASONRY: CMU, brick, stone veneer
- STRUCTURAL STEEL: steel, metal deck, misc metals, stairs, railings
- DRYWALL/ACOUSTICAL: metal studs, drywall, insulation batts, ACT ceilings, acoustical
- ROOFING: roofing, roof insulation, flashings, sheet metal
- GLAZING: windows, storefronts, curtain wall, skylights
- DOORS/HARDWARE: doors, frames, hardware, access doors
- PAINTING: paint, coatings, wall coverings
- FLOORING: carpet, VCT, LVT, rubber, wood floor, tile, epoxy
- ELECTRICAL: power, wiring, lighting, panels (NOT low voltage/fire alarm)
- LOW VOLTAGE: data, voice, AV, security rough-in, cable tray (SEPARATE from electrical)
- FIRE ALARM: fire alarm panels, detectors, notification (SEPARATE from electrical & sprinklers)
- PLUMBING: fixtures, piping, water heaters, gas
- HVAC: HVAC equipment, ductwork, controls, TAB
- FIRE PROTECTION: sprinklers, standpipes, fire pump
- SPECIALTIES: toilet partitions, accessories, lockers, signage
`

exports.handler = async (event) => {
  // Always return JSON with proper headers
  const jsonResponse = (statusCode, data) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  try {
    let bidItems
    try {
      const body = JSON.parse(event.body)
      bidItems = body.bidItems
    } catch (e) {
      return jsonResponse(400, { error: 'Invalid JSON in request body' })
    }

    if (!bidItems || bidItems.length === 0) {
      return jsonResponse(400, { error: 'No bid items provided' })
    }

    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      return jsonResponse(500, { error: 'ANTHROPIC_API_KEY not configured. Add it in Netlify site settings.' })
    }

    console.log(`Analyzing ${bidItems.length} bid items...`)

    // Build concise bid item list
    const itemList = bidItems.map(item =>
      `- ${item.id}: ${item.trade?.division_code || '??'} ${item.description}`
    ).join('\n')

    const prompt = `Group these bid items into subcontractor packages based on how contractors typically bid work together.

${TRADE_GROUPINGS}

CRITICAL RULES:
1. ELECTRICAL, LOW VOLTAGE, and FIRE ALARM must be SEPARATE packages
2. FIRE PROTECTION (sprinklers) separate from FIRE ALARM
3. DRYWALL sub typically includes: metal studs, drywall, wall insulation, acoustical ceilings

BID ITEMS:
${itemList}

Return ONLY valid JSON:
{"packages":[{"name":"Package Name","subcontractorType":"Trade Type","bidItemIds":["id1","id2"]}]}`

    let anthropic
    try {
      anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      })
    } catch (e) {
      console.error('Failed to initialize Anthropic client:', e)
      return jsonResponse(500, { error: 'Failed to initialize AI client: ' + e.message })
    }

    let response
    try {
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    } catch (e) {
      console.error('Anthropic API error:', e)
      return jsonResponse(500, {
        error: 'AI API error: ' + e.message,
        details: e.status ? `Status: ${e.status}` : undefined
      })
    }

    const responseText = response.content[0]?.text
    if (!responseText) {
      return jsonResponse(500, { error: 'Empty response from AI' })
    }

    // Extract JSON from response
    let jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('No JSON in response:', responseText.substring(0, 200))
      return jsonResponse(500, { error: 'No valid JSON in AI response' })
    }

    let analysis
    try {
      analysis = JSON.parse(jsonMatch[0])
    } catch (e) {
      console.error('JSON parse error:', e, jsonMatch[0].substring(0, 200))
      return jsonResponse(500, { error: 'Failed to parse AI response as JSON' })
    }

    console.log(`Successfully created ${analysis.packages?.length || 0} packages`)
    return jsonResponse(200, { success: true, analysis })

  } catch (error) {
    console.error('Unexpected error:', error)
    return jsonResponse(500, {
      error: error.message || 'Unknown error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
}

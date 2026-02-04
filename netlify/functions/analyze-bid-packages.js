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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  try {
    const { bidItems } = JSON.parse(event.body)

    if (!bidItems || bidItems.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No bid items provided' })
      }
    }

    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

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

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })

    const responseText = response.content[0].text

    // Extract JSON from response
    let jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No valid JSON in AI response')
    }

    const analysis = JSON.parse(jsonMatch[0])

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        analysis
      })
    }

  } catch (error) {
    console.error('Error analyzing bid packages:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message,
        details: error.status ? `API Status: ${error.status}` : undefined
      })
    }
  }
}

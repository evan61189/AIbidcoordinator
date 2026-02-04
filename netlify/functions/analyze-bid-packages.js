const Anthropic = require('@anthropic-ai/sdk').default

/**
 * AI-powered bid package analysis
 * Groups bid items based on how subcontractors typically bid work together.
 */

// Condensed but complete trade groupings
const TRADE_RULES = `
GROUP BID ITEMS BY THESE SUBCONTRACTOR PACKAGES:

1. DEMOLITION: selective demo, structural demo, hazmat, concrete removal, site clearing
2. SITEWORK: excavation, grading, utilities, erosion control, dewatering (NOT paving/landscaping)
3. LANDSCAPING: planting, irrigation, sod, mulch
4. PAVING: asphalt, concrete paving, striping, curbs
5. CONCRETE: foundations, slabs, tilt-up, site concrete, rebar
6. MASONRY: CMU, brick, stone veneer
7. STRUCTURAL STEEL: steel, metal deck, misc metals, stairs, railings
8. DRYWALL/ACOUSTICAL: metal studs, drywall, wall insulation, ACT ceilings, acoustical, firestopping
9. ROOFING: membrane, roof insulation, flashings, sheet metal, gutters
10. WATERPROOFING: below-grade waterproofing, air/vapor barriers, sealants
11. GLAZING: windows, storefronts, curtain wall, skylights
12. DOORS/HARDWARE: doors, frames, hardware, access doors
13. PAINTING: paint, stain, wall coverings, coatings
14. FLOORING: carpet, VCT, LVT, rubber, tile, wood, epoxy, base
15. ELECTRICAL: power, wiring, lighting, panels (NOT low voltage, NOT fire alarm)
16. LOW VOLTAGE: data/voice cabling, AV, security rough-in (SEPARATE from electrical)
17. FIRE ALARM: alarm panels, detectors, notification devices (SEPARATE from electrical & sprinklers)
18. PLUMBING: fixtures, piping, water heaters, gas
19. HVAC: equipment, ductwork, controls, TAB
20. FIRE PROTECTION: sprinklers, standpipes, fire pump (SEPARATE from fire alarm)
21. SPECIALTIES: toilet partitions, accessories, lockers, signage

CRITICAL: Electrical, Low Voltage, Fire Alarm, and Fire Protection must be 4 SEPARATE packages.
`

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { bidItems } = JSON.parse(event.body || '{}')

    if (!bidItems?.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No bid items provided' }) }
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) }
    }

    // Build concise item list (just ID and description)
    const items = bidItems.map(i => `${i.id}|${i.description}`).join('\n')

    const prompt = `${TRADE_RULES}

ITEMS:
${items}

Return JSON only: {"packages":[{"name":"Name","bidItemIds":["id1","id2"]}]}`

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })

    const text = response.content[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)

    if (!match) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Invalid AI response' }) }
    }

    const analysis = JSON.parse(match[0])
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, analysis }) }

  } catch (error) {
    console.error('Error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Unknown error' })
    }
  }
}

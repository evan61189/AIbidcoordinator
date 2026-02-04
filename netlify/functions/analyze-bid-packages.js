let Anthropic
try {
  Anthropic = require('@anthropic-ai/sdk').default
} catch (e) {
  console.error('Failed to load Anthropic SDK:', e)
}

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

// Helper to retry API calls
async function callWithRetry(fn, maxRetries = 2) {
  let lastError
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      console.log(`Attempt ${i + 1} failed: ${error.message}`)
      if (i < maxRetries && error.status === 500) {
        // Wait before retry (1s, 2s)
        await new Promise(r => setTimeout(r, (i + 1) * 1000))
      }
    }
  }
  throw lastError
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '{}' }
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    // Parse request body with better error handling
    let bidItems
    try {
      const body = event.body ? JSON.parse(event.body) : {}
      bidItems = body.bidItems
    } catch (parseErr) {
      console.error('Request body parse error:', parseErr.message, 'Body:', event.body?.substring(0, 100))
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) }
    }

    if (!bidItems?.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No bid items provided' }) }
    }

    if (!Anthropic) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Anthropic SDK failed to load' }) }
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) }
    }

    console.log(`Analyzing ${bidItems.length} bid items...`)

    // Build concise item list (just ID and description)
    const items = bidItems.map(i => `${i.id}|${i.description}`).join('\n')

    const prompt = `${TRADE_RULES}

ITEMS:
${items}

Return JSON only: {"packages":[{"name":"Name","bidItemIds":["id1","id2"]}]}`

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    // Call API with retry logic
    const response = await callWithRetry(() =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }]
      })
    )

    const text = response.content[0]?.text || ''
    console.log('AI response length:', text.length)
    console.log('AI response preview:', text.substring(0, 500))

    const match = text.match(/\{[\s\S]*\}/)

    if (!match) {
      console.log('No JSON match found in response')
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Invalid AI response - no JSON found', raw: text.substring(0, 500) }) }
    }

    console.log('Matched JSON length:', match[0].length)

    let analysis
    try {
      analysis = JSON.parse(match[0])
    } catch (parseError) {
      console.log('JSON parse error:', parseError.message)
      console.log('Matched text preview:', match[0].substring(0, 500))
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to parse AI JSON', parseError: parseError.message, raw: match[0].substring(0, 500) }) }
    }

    console.log(`Successfully created ${analysis.packages?.length || 0} packages`)
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, analysis }) }

  } catch (error) {
    console.error('Error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error.message || 'Unknown error',
        isApiError: error.status === 500,
        hint: error.status === 500 ? 'Anthropic API is experiencing issues. Please try again in a few minutes.' : undefined
      })
    }
  }
}

const Anthropic = require('@anthropic-ai/sdk').default

/**
 * AI-powered bid package analysis
 * Uses construction industry knowledge to suggest how bid items should be grouped
 * for subcontractor invitations BEFORE bids are received.
 */

const INDUSTRY_KNOWLEDGE = `
COMMON SUBCONTRACTOR TRADE GROUPINGS IN COMMERCIAL CONSTRUCTION:

1. DEMOLITION SUBCONTRACTOR
   - Selective demolition
   - Structural demolition
   - Interior demolition
   - Hazmat abatement (asbestos, lead - sometimes separate specialty)
   - Concrete sawing/removal
   - Site clearing
   - Note: Often first trade on site, may include rubbish removal

2. SITEWORK/EARTHWORK SUBCONTRACTOR
   - Excavation
   - Grading
   - Soil compaction
   - Underground utilities (storm, sanitary, water, gas)
   - Erosion control
   - Dewatering
   - Import/export of fill
   - Retaining walls (sometimes)
   - Note: SEPARATE from paving and landscaping

3. LANDSCAPING SUBCONTRACTOR
   - Planting (trees, shrubs, groundcover)
   - Irrigation systems
   - Sod/seeding
   - Mulch and landscape materials
   - Landscape maintenance (if included)
   - Sometimes includes: Site furnishings, pavers

4. PAVING SUBCONTRACTOR
   - Asphalt paving
   - Concrete paving (parking lots, drives)
   - Striping and marking
   - Curbs and gutters (sometimes with concrete sub)
   - Speed bumps, signage bases

5. CONCRETE SUBCONTRACTOR
   - Foundations
   - Slab on grade
   - Elevated slabs
   - Tilt-up panels
   - Site concrete (sidewalks, curbs)
   - Concrete polishing/finishing
   - Reinforcing steel (sometimes separate)

6. MASONRY SUBCONTRACTOR
   - CMU (concrete masonry units)
   - Brick veneer
   - Stone veneer
   - Structural brick
   - Glass block
   - Sometimes includes: Stone pavers, rough stone

7. STRUCTURAL STEEL/METALS SUBCONTRACTOR
   - Structural steel
   - Metal decking
   - Miscellaneous metals (stairs, railings, ladders, bollards)
   - Steel joists
   - Ornamental metals (sometimes separate specialty)

8. ROUGH CARPENTRY/FRAMING SUBCONTRACTOR
   - Wood framing (if applicable)
   - Blocking and backing
   - Rough hardware
   - Sheathing
   - Note: On commercial, often part of drywall sub scope

9. DRYWALL/INTERIOR SYSTEMS SUBCONTRACTOR
   - Metal stud framing (light gauge steel framing)
   - Drywall/gypsum board
   - Wall insulation (batt insulation in wall cavities)
   - Acoustical ceilings (suspended ceiling systems, ACT)
   - Acoustical ceiling framing/grid
   - Acoustical sealants and firestopping
   - Shaft wall systems
   - Drywall finishing/taping
   - Sometimes includes: FRP panels, wall protection, sound batts

10. ROOFING SUBCONTRACTOR
    - Roofing membrane/system (TPO, EPDM, built-up, metal)
    - Roof insulation
    - Flashings
    - Sheet metal (gutters, downspouts, copings)
    - Roof accessories (hatches, vents, curbs)
    - Sometimes includes: Waterproofing, air barriers, vapor barriers

11. WATERPROOFING/BUILDING ENVELOPE SUBCONTRACTOR
    - Below-grade waterproofing
    - Air barriers
    - Vapor barriers
    - Joint sealants (exterior)
    - Dampproofing
    - Note: Sometimes combined with roofing

12. GLAZING SUBCONTRACTOR
    - Windows (aluminum, vinyl)
    - Storefronts
    - Curtain wall
    - Skylights
    - Glass and glazing
    - Aluminum entrance doors
    - Note: Glass railings sometimes separate

13. DOORS/FRAMES/HARDWARE SUBCONTRACTOR
    - Hollow metal frames
    - Wood doors
    - Hollow metal doors
    - Finish hardware (hinges, locksets, closers, stops)
    - Access doors
    - Specialty doors (sometimes separate): overhead, rolling, fire-rated

14. PAINTING SUBCONTRACTOR
    - Interior painting
    - Exterior painting
    - Staining and sealing
    - Wall coverings (wallpaper, vinyl)
    - Specialty coatings (epoxy, intumescent)
    - Sometimes includes: Caulking/sealants (interior)

15. FLOORING SUBCONTRACTOR
    - Carpet
    - VCT (vinyl composition tile)
    - LVT/LVP (luxury vinyl)
    - Rubber flooring
    - Ceramic/porcelain tile
    - Quarry tile
    - Wood flooring
    - Polished concrete (sometimes with concrete sub)
    - Epoxy flooring (sometimes specialty)
    - Base (rubber, vinyl, wood)

16. TILE SUBCONTRACTOR (sometimes separate from flooring)
    - Ceramic tile
    - Porcelain tile
    - Natural stone tile
    - Glass tile
    - Tile backer board
    - Waterproofing for wet areas
    - Note: Often separate for complex tile work

17. ELECTRICAL SUBCONTRACTOR
    - Power distribution (panels, transformers, switchgear)
    - Branch wiring and devices (outlets, switches)
    - Lighting fixtures
    - Lighting controls (dimmers, occupancy sensors)
    - Motor connections
    - Temporary power
    - Note: LOW VOLTAGE and FIRE ALARM are often SEPARATE packages

18. LOW VOLTAGE SUBCONTRACTOR
    - Data cabling (Cat6, fiber)
    - Voice cabling
    - Audio/visual rough-in
    - Security system rough-in (cameras, card readers)
    - Paging/intercom systems
    - Wireless access points
    - Cable tray and pathways
    - Note: Often bid SEPARATE from electrical power

19. FIRE ALARM SUBCONTRACTOR
    - Fire alarm control panels
    - Smoke detectors
    - Heat detectors
    - Pull stations
    - Notification devices (horns, strobes)
    - Duct detectors
    - Monitoring connections
    - Note: SEPARATE from fire sprinklers, often SEPARATE from electrical

20. PLUMBING SUBCONTRACTOR
    - Plumbing fixtures (toilets, sinks, urinals)
    - Domestic water piping
    - Sanitary/waste piping
    - Storm drainage (interior)
    - Gas piping
    - Water heaters
    - Roof drains
    - Sometimes includes: Medical gas systems

21. HVAC/MECHANICAL SUBCONTRACTOR
    - HVAC equipment (RTUs, AHUs, split systems, VRF)
    - Ductwork and fittings
    - Duct insulation
    - Grilles, registers, diffusers
    - Controls/BAS (building automation)
    - Piping (hydronic, refrigerant)
    - Testing and balancing
    - Exhaust systems
    - Sometimes includes: Kitchen exhaust hoods, lab exhaust

22. FIRE PROTECTION/SPRINKLER SUBCONTRACTOR
    - Fire sprinkler systems (wet, dry, preaction)
    - Standpipes
    - Fire pumps
    - Backflow preventers
    - Fire department connections
    - Note: SEPARATE from fire alarm

23. INSULATION SUBCONTRACTOR (sometimes separate)
    - Mechanical insulation (pipe, duct, equipment)
    - Building insulation (spray foam, rigid)
    - Firestopping (sometimes with drywall)
    - Note: Often split between drywall (wall batts) and mechanical (pipe/duct)

24. SPECIALTIES SUBCONTRACTOR
    - Toilet partitions and accessories
    - Lockers
    - Fire extinguishers and cabinets
    - Signage (sometimes separate)
    - Corner guards/wall protection
    - Projection screens
    - Flagpoles
    - Note: Often multiple small packages

25. EQUIPMENT SUBCONTRACTOR (various)
    - Food service equipment
    - Laboratory equipment
    - Medical equipment
    - Detention equipment
    - Athletic equipment
    - Note: Usually specialty subs for each type

26. ELEVATOR/CONVEYING SUBCONTRACTOR
    - Elevators (hydraulic, traction)
    - Escalators
    - Dumbwaiters
    - Lifts
`

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  try {
    const { bidItems, bids } = JSON.parse(event.body)

    if (!bidItems || bidItems.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No bid items provided' })
      }
    }

    // Build context for AI
    const bidItemDescriptions = bidItems.map(item => ({
      id: item.id,
      description: item.description,
      trade: item.trade ? `${item.trade.division_code} - ${item.trade.name}` : 'Unknown',
      tradeCode: item.trade?.division_code,
      tradeName: item.trade?.name
    }))

    // If we have existing bids, include that info as supplementary
    let bidPatternContext = ''
    if (bids && bids.length > 0) {
      const subBidPatterns = {}
      for (const bid of bids) {
        if (bid.status !== 'submitted' || !bid.subcontractor?.id) continue
        const subId = bid.subcontractor.id
        const subName = bid.subcontractor.company_name
        if (!subBidPatterns[subId]) {
          subBidPatterns[subId] = { name: subName, trades: new Set() }
        }
        if (bid.bid_item?.trade) {
          subBidPatterns[subId].trades.add(bid.bid_item.trade.name)
        }
      }
      const patterns = Object.values(subBidPatterns).map(s => ({
        sub: s.name,
        trades: [...s.trades]
      }))
      if (patterns.length > 0) {
        bidPatternContext = `\n\nEXISTING BID PATTERNS (subcontractors who have already bid together):\n${JSON.stringify(patterns, null, 2)}`
      }
    }

    const prompt = `You are an expert commercial construction estimator with deep knowledge of how subcontractors typically bundle their work.

YOUR TASK: Analyze the bid items below and group them into logical "bid packages" based on how subcontractors in the real world would typically bid this work together.

${INDUSTRY_KNOWLEDGE}

BID ITEMS TO ANALYZE:
${JSON.stringify(bidItemDescriptions, null, 2)}
${bidPatternContext}

CRITICAL INSTRUCTIONS:
1. Group bid items based on which subcontractor trade would typically bid them together
2. IMPORTANT: Keep these as SEPARATE packages (not combined):
   - ELECTRICAL (power, lighting) - separate package
   - LOW VOLTAGE (data, voice, AV, security rough-in) - separate package
   - FIRE ALARM (detection, notification) - separate package
   - FIRE PROTECTION/SPRINKLERS - separate package
3. A "Drywall Sub" typically includes metal framing, insulation, drywall, AND acoustical ceilings
4. Keep DEMOLITION as its own package
5. Keep SITEWORK separate from LANDSCAPING separate from PAVING
6. Items that don't fit common groupings can remain ungrouped or be in small specialty packages

IMPORTANT: Return ONLY valid JSON in this exact format, no other text:
{
  "packages": [
    {
      "name": "Drywall & Acoustical Package",
      "subcontractorType": "Drywall/Interior Systems Subcontractor",
      "description": "Interior wall and ceiling systems",
      "bidItemIds": ["uuid1", "uuid2", "uuid3"],
      "reasoning": "Metal framing, drywall, insulation, and acoustical ceilings are typically bid together by drywall contractors",
      "relatedPackages": ["Painting Package", "Flooring Package"]
    }
  ],
  "ungroupedItems": ["uuid-for-specialty-item"],
  "customerDivisions": [
    {
      "divisionCode": "09",
      "divisionName": "Finishes",
      "displayName": "Interior Finishes",
      "bidItemIds": ["uuid1", "uuid2"]
    }
  ],
  "notes": "Any special considerations or alternative grouping suggestions"
}

The "relatedPackages" field should list other packages that the same subcontractor MIGHT also bid (e.g., an electrician might bid Electrical AND Low Voltage AND Fire Alarm).

Focus on creating packages that match how subcontractors actually bid work, not just CSI division groupings.`

    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured. Add it in Netlify site settings.')
    }

    // Initialize Anthropic client inside handler to ensure env vars are available
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
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

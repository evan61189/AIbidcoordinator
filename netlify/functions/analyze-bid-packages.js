const Anthropic = require('@anthropic-ai/sdk').default

const anthropic = new Anthropic()

/**
 * AI-powered bid package analysis
 * Uses construction industry knowledge to suggest how bid items should be grouped
 * for subcontractor invitations BEFORE bids are received.
 *
 * Common subcontractor groupings in commercial construction:
 * - Drywall Sub: Metal framing, wall insulation, drywall, acoustical ceilings, acoustical sealants
 * - Electrical Sub: Power distribution, lighting, low voltage, fire alarm (sometimes separate)
 * - Plumbing Sub: Plumbing fixtures, piping, sometimes med gas
 * - HVAC Sub: Heating, ventilation, AC, controls, ductwork insulation
 * - Concrete Sub: Foundations, slabs, tilt-up, precast
 * - Roofing Sub: Roofing, flashing, sometimes waterproofing
 * - Glazing Sub: Windows, storefronts, curtain wall, skylights
 * - Painting Sub: Painting, wall coverings, specialty coatings
 * - Flooring Sub: Carpet, VCT, tile, wood flooring, polished concrete
 * - Fire Protection Sub: Sprinklers, standpipes (often separate from electrical fire alarm)
 */

const INDUSTRY_KNOWLEDGE = `
COMMON SUBCONTRACTOR TRADE GROUPINGS IN COMMERCIAL CONSTRUCTION:

1. DRYWALL/INTERIOR SYSTEMS SUBCONTRACTOR
   - Metal stud framing (light gauge steel framing)
   - Drywall/gypsum board
   - Wall insulation (batt insulation in wall cavities)
   - Acoustical ceilings (suspended ceiling systems, ACT)
   - Acoustical ceiling framing/grid
   - Acoustical sealants and firestopping
   - Shaft wall systems
   - Sometimes includes: FRP panels, wall protection

2. ELECTRICAL SUBCONTRACTOR
   - Power distribution and wiring
   - Lighting fixtures and controls
   - Low voltage systems (data/voice cabling)
   - Fire alarm systems (detection, notification - NOT sprinklers)
   - Security rough-in
   - Sometimes separate: Low voltage/data (specialty sub)
   - Sometimes separate: Fire alarm (specialty sub)

3. PLUMBING SUBCONTRACTOR
   - Plumbing fixtures (toilets, sinks, etc.)
   - Domestic water piping
   - Sanitary/waste piping
   - Storm drainage
   - Gas piping
   - Sometimes includes: Medical gas systems

4. HVAC/MECHANICAL SUBCONTRACTOR
   - HVAC equipment (RTUs, split systems, chillers)
   - Ductwork
   - Duct insulation
   - Controls/BAS
   - Piping (hydronic)
   - Testing and balancing
   - Sometimes includes: Kitchen exhaust hoods

5. CONCRETE SUBCONTRACTOR
   - Foundations
   - Slab on grade
   - Elevated slabs
   - Tilt-up panels
   - Site concrete (sidewalks, curbs)
   - Reinforcing steel (sometimes separate)

6. STRUCTURAL STEEL/METALS SUBCONTRACTOR
   - Structural steel
   - Metal decking
   - Miscellaneous metals (stairs, railings, ladders)
   - Ornamental metals (sometimes separate)

7. ROOFING SUBCONTRACTOR
   - Roofing membrane/system
   - Roof insulation
   - Flashings
   - Sheet metal (gutters, downspouts)
   - Sometimes includes: Waterproofing, air barriers

8. GLAZING SUBCONTRACTOR
   - Windows
   - Storefronts
   - Curtain wall
   - Skylights
   - Glass and glazing
   - Entrance doors (aluminum)

9. PAINTING SUBCONTRACTOR
   - Interior painting
   - Exterior painting
   - Staining
   - Wall coverings
   - Specialty coatings
   - Sometimes includes: Caulking/sealants

10. FLOORING SUBCONTRACTOR
    - Carpet
    - VCT (vinyl composition tile)
    - LVT (luxury vinyl tile)
    - Ceramic/porcelain tile
    - Wood flooring
    - Polished concrete
    - Epoxy flooring
    - Rubber/resilient flooring

11. FIRE PROTECTION/SPRINKLER SUBCONTRACTOR
    - Fire sprinkler systems
    - Standpipes
    - Fire pumps
    - Note: SEPARATE from fire alarm (electrical)

12. MASONRY SUBCONTRACTOR
    - CMU (concrete masonry units)
    - Brick veneer
    - Stone veneer
    - Sometimes includes: Rough stone, pavers

13. SITEWORK/EARTHWORK SUBCONTRACTOR
    - Excavation
    - Grading
    - Utilities (underground)
    - Paving (asphalt, concrete)
    - Landscaping (sometimes separate)

14. DOORS/FRAMES/HARDWARE SUBCONTRACTOR
    - Hollow metal frames
    - Wood doors
    - Hardware (hinges, locksets, closers)
    - Specialty doors (sometimes separate)

15. SPECIALTIES (often separate small packages)
    - Toilet accessories
    - Signage
    - Fire extinguishers/cabinets
    - Lockers
    - Corner guards/wall protection
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

INSTRUCTIONS:
1. Group bid items based on which subcontractor trade would typically bid them together
2. Use the industry knowledge above - a "Drywall Sub" typically includes metal framing, insulation, drywall, AND acoustical ceilings
3. Create packages named after the subcontractor type (e.g., "Drywall Package", "Electrical Package")
4. Items that don't fit common groupings can remain ungrouped or be in small specialty packages
5. Consider local market norms - some items could go either way (e.g., low voltage might be with electrical or separate)

IMPORTANT: Return ONLY valid JSON in this exact format, no other text:
{
  "packages": [
    {
      "name": "Drywall & Acoustical Package",
      "subcontractorType": "Drywall/Interior Systems Subcontractor",
      "description": "Interior wall and ceiling systems",
      "bidItemIds": ["uuid1", "uuid2", "uuid3"],
      "reasoning": "Metal framing, drywall, insulation, and acoustical ceilings are typically bid together by drywall contractors"
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

Focus on creating packages that match how subcontractors actually bid work, not just CSI division groupings.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
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
      body: JSON.stringify({ error: error.message })
    }
  }
}

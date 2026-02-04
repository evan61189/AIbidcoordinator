const Anthropic = require('@anthropic-ai/sdk').default

const anthropic = new Anthropic()

/**
 * AI-powered bid package analysis
 * Analyzes submitted bids to detect common trade pairings and suggest scope packages
 * Example: Framing (06) + Drywall (09) + Insulation (07) often bid together
 */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  try {
    const { bids, bidItems } = JSON.parse(event.body)

    if (!bids || !bidItems) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing bids or bidItems' })
      }
    }

    // Analyze which subcontractors bid on which items together
    const subBidPatterns = {}
    for (const bid of bids) {
      if (bid.status !== 'submitted' || !bid.subcontractor?.id) continue

      const subId = bid.subcontractor.id
      const subName = bid.subcontractor.company_name

      if (!subBidPatterns[subId]) {
        subBidPatterns[subId] = {
          name: subName,
          bidItemIds: new Set(),
          trades: new Set()
        }
      }

      subBidPatterns[subId].bidItemIds.add(bid.bid_item?.id)
      if (bid.bid_item?.trade) {
        subBidPatterns[subId].trades.add(bid.bid_item.trade.division_code + ' - ' + bid.bid_item.trade.name)
      }
    }

    // Build context for AI
    const bidItemDescriptions = bidItems.map(item => ({
      id: item.id,
      description: item.description,
      trade: item.trade ? `${item.trade.division_code} - ${item.trade.name}` : 'Unknown',
      tradeCode: item.trade?.division_code
    }))

    const subPatternsList = Object.entries(subBidPatterns).map(([id, data]) => ({
      subcontractor: data.name,
      trades: [...data.trades],
      itemCount: data.bidItemIds.size
    }))

    const prompt = `You are an expert construction estimator. Analyze these bid items and subcontractor bidding patterns to suggest logical scope packages.

BID ITEMS:
${JSON.stringify(bidItemDescriptions, null, 2)}

SUBCONTRACTOR BIDDING PATTERNS (who bid on what together):
${JSON.stringify(subPatternsList, null, 2)}

Based on:
1. Common construction trade pairings (e.g., framing/drywall/insulation, electrical/low voltage, plumbing/HVAC)
2. Which subcontractors bid multiple items together
3. CSI division groupings that make sense for customer presentation

Suggest scope packages. Each package should group items that are commonly bid together or logically belong together for customer pricing.

IMPORTANT: Return ONLY valid JSON in this exact format, no other text:
{
  "packages": [
    {
      "name": "Package Name (e.g., Interior Wall Systems)",
      "description": "Brief description for customers",
      "bidItemIds": ["uuid1", "uuid2"],
      "reasoning": "Why these items are grouped"
    }
  ],
  "ungroupedItems": ["uuid3"],
  "customerDivisions": [
    {
      "divisionCode": "06",
      "divisionName": "Wood, Plastics, and Composites",
      "displayName": "Framing & Carpentry",
      "bidItemIds": ["uuid1"]
    }
  ]
}

The customerDivisions should provide customer-friendly names for each CSI division that has bid items.`

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
        analysis,
        subPatterns: subPatternsList
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

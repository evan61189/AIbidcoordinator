import Anthropic from '@anthropic-ai/sdk'

/**
 * AI-powered bid allocation suggestion
 * Analyzes items in a package bid and suggests how to distribute the total amount
 * across divisions and individual items based on industry cost knowledge.
 */

const ALLOCATION_PROMPT = `You are a construction cost estimation expert. Given a package bid total and the items included, suggest how to distribute the cost across CSI divisions and individual items.

Use your knowledge of typical construction costs to make realistic allocations. Consider:
- Fume hoods and biosafety cabinets are expensive ($15k-$50k+ each)
- Lab casework/cabinets are moderately expensive ($200-500/linear foot)
- Epoxy countertops are expensive ($100-200/sq ft)
- Safety showers/eyewash stations are relatively inexpensive ($2k-5k)
- Electrical panels and switchgear are expensive
- Card readers and access control hardware are moderate ($500-2000 each)
- Data cabling is relatively inexpensive per drop
- Fire alarm devices are moderate cost

Return a JSON object with this exact structure:
{
  "division_allocations": {
    "DIVISION_CODE": {
      "percent": NUMBER,
      "amount": NUMBER,
      "reasoning": "Brief explanation"
    }
  },
  "item_allocations": {
    "ITEM_ID": {
      "amount": NUMBER,
      "reasoning": "Brief explanation"
    }
  }
}

The sum of all division percentages must equal 100.
The sum of all division amounts must equal the total bid amount.
Item allocations within each division should sum to that division's amount.`

export async function handler(event) {
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

    const { totalAmount, packageName, items } = JSON.parse(event.body || '{}')

    if (!totalAmount || !items?.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing totalAmount or items' }) }
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) }
    }

    // Group items by division for the prompt
    const itemsByDivision = {}
    for (const item of items) {
      const divCode = item.division_code || '00'
      if (!itemsByDivision[divCode]) {
        itemsByDivision[divCode] = {
          name: item.division_name || 'Unknown',
          items: []
        }
      }
      itemsByDivision[divCode].items.push({
        id: item.id,
        description: item.description
      })
    }

    // Build the prompt
    const itemsList = Object.entries(itemsByDivision).map(([code, div]) => {
      const itemDescriptions = div.items.map(i => `  - ${i.id}: ${i.description}`).join('\n')
      return `Division ${code} - ${div.name}:\n${itemDescriptions}`
    }).join('\n\n')

    const userPrompt = `Package: ${packageName}
Total Bid Amount: $${totalAmount.toLocaleString()}

Items by Division:
${itemsList}

Suggest how to allocate the $${totalAmount.toLocaleString()} across these divisions and items.
Return JSON only.`

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      temperature: 0,
      system: ALLOCATION_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const text = response.content[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)

    if (!match) {
      // Fallback to even distribution
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          allocation: createEvenAllocation(totalAmount, itemsByDivision),
          method: 'even_fallback'
        })
      }
    }

    const allocation = JSON.parse(match[0])

    // Validate and normalize the allocation
    const normalizedAllocation = normalizeAllocation(allocation, totalAmount, itemsByDivision)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        allocation: normalizedAllocation,
        method: 'ai_suggested'
      })
    }

  } catch (error) {
    console.error('Error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Unknown error' })
    }
  }
}

// Create even distribution as fallback
function createEvenAllocation(totalAmount, itemsByDivision) {
  const divisionCodes = Object.keys(itemsByDivision)
  const totalItems = Object.values(itemsByDivision).reduce((sum, div) => sum + div.items.length, 0)

  const divisionAllocations = {}
  const itemAllocations = {}

  for (const [code, div] of Object.entries(itemsByDivision)) {
    const divItemCount = div.items.length
    const divPercent = (divItemCount / totalItems) * 100
    const divAmount = Math.round(totalAmount * (divItemCount / totalItems))

    divisionAllocations[code] = {
      percent: Math.round(divPercent * 10) / 10,
      amount: divAmount,
      reasoning: 'Even distribution based on item count'
    }

    const perItemAmount = Math.round(divAmount / divItemCount)
    for (const item of div.items) {
      itemAllocations[item.id] = {
        amount: perItemAmount,
        reasoning: 'Even distribution within division'
      }
    }
  }

  return { division_allocations: divisionAllocations, item_allocations: itemAllocations }
}

// Normalize allocation to ensure amounts sum correctly
function normalizeAllocation(allocation, totalAmount, itemsByDivision) {
  const divAllocations = allocation.division_allocations || {}
  const itemAllocations = allocation.item_allocations || {}

  // Calculate actual sum
  let divSum = 0
  for (const div of Object.values(divAllocations)) {
    divSum += div.amount || 0
  }

  // Scale if needed
  if (divSum !== totalAmount && divSum > 0) {
    const scale = totalAmount / divSum
    for (const code of Object.keys(divAllocations)) {
      divAllocations[code].amount = Math.round(divAllocations[code].amount * scale)
      divAllocations[code].percent = Math.round((divAllocations[code].amount / totalAmount) * 1000) / 10
    }
  }

  // Ensure item allocations exist and sum correctly within divisions
  for (const [code, div] of Object.entries(itemsByDivision)) {
    const divAmount = divAllocations[code]?.amount || 0
    const divItems = div.items

    // Check if we have item allocations for this division
    let itemSum = 0
    for (const item of divItems) {
      if (itemAllocations[item.id]) {
        itemSum += itemAllocations[item.id].amount || 0
      }
    }

    // If items don't sum to division amount, redistribute
    if (itemSum !== divAmount || itemSum === 0) {
      const perItem = Math.round(divAmount / divItems.length)
      for (const item of divItems) {
        itemAllocations[item.id] = {
          amount: perItem,
          reasoning: itemAllocations[item.id]?.reasoning || 'Distributed within division'
        }
      }
    }
  }

  return { division_allocations: divAllocations, item_allocations: itemAllocations }
}

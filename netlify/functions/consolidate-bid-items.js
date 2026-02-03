/**
 * Consolidate Bid Items using AI
 *
 * Takes all extracted bid items for a round and uses AI to consolidate
 * them into clear, general scope descriptions by trade.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const config = {
  maxDuration: 300 // 5 minutes for AI processing
}

function getSupabase() {
  if (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    return createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    )
  }
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY
    )
  }
  return null
}

function getAnthropic() {
  if (process.env.ANTHROPIC_API_KEY) {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return null
}

/**
 * Use AI to consolidate items for a trade into clear scope descriptions
 */
async function consolidateTradeItems(anthropic, tradeName, items) {
  const itemDescriptions = items.map((item, i) => `${i + 1}. ${item.description}`).join('\n')

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: `You are a construction estimator creating clear, concise bid scope descriptions for subcontractors.

Your job is to take a list of detailed extracted items and consolidate them into general scope line items that are:
- Easy to understand at a glance
- Comprehensive (covering all the detailed items)
- Written in standard construction bidding language
- Not overly specific (use phrases like "all types as indicated on drawings" instead of listing every type)`,
    messages: [{
      role: 'user',
      content: `Consolidate these ${tradeName} bid items into 2-6 clear, general scope descriptions:

${itemDescriptions}

Return JSON array of consolidated items:
[
  {
    "description": "All gypsum board wall partitions as indicated on drawings, including all partition types per partition schedule",
    "notes": "Includes framing, insulation, blocking, and accessories"
  }
]

Guidelines:
- Combine similar items into general statements
- Use "as indicated on drawings" or "per specifications" instead of listing every detail
- Keep descriptions to 1-2 sentences max
- Include important notes about what's included
- Aim for 2-6 consolidated items, not one for every original item`
    }]
  })

  try {
    const text = response.content[0].text
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
  } catch (e) {
    console.error('Failed to parse AI response:', e)
  }

  return null
}

export async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  const supabase = getSupabase()
  const anthropic = getAnthropic()

  if (!supabase) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Supabase not configured' })
    }
  }

  if (!anthropic) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Anthropic API not configured' })
    }
  }

  try {
    const body = JSON.parse(event.body)
    const { bid_round_id: bidRoundId, project_id: projectId } = body

    if (!bidRoundId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'bid_round_id is required' })
      }
    }

    console.log(`AI consolidating bid items for round: ${bidRoundId}`)

    // Fetch all bid items with trade info
    const { data: items, error: fetchError } = await supabase
      .from('bid_items')
      .select('*, trades(id, name, division_code)')
      .eq('bid_round_id', bidRoundId)
      .eq('ai_generated', true)
      .order('trade_id')

    if (fetchError) {
      throw new Error(`Failed to fetch bid items: ${fetchError.message}`)
    }

    if (!items || items.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No items to consolidate',
          original_count: 0,
          final_count: 0
        })
      }
    }

    console.log(`Found ${items.length} AI-generated bid items`)

    // Group items by trade
    const itemsByTrade = {}
    for (const item of items) {
      const tradeId = item.trade_id
      const tradeName = item.trades?.name || 'Unknown'
      if (!itemsByTrade[tradeId]) {
        itemsByTrade[tradeId] = {
          tradeName,
          divisionCode: item.trades?.division_code || '00',
          items: []
        }
      }
      itemsByTrade[tradeId].items.push(item)
    }

    const tradeCount = Object.keys(itemsByTrade).length
    console.log(`Items grouped into ${tradeCount} trades`)

    let totalConsolidated = 0
    let totalCreated = 0

    // Process each trade
    for (const [tradeId, tradeData] of Object.entries(itemsByTrade)) {
      const { tradeName, divisionCode, items: tradeItems } = tradeData

      // Skip trades with only 1-2 items
      if (tradeItems.length <= 2) {
        console.log(`Skipping ${tradeName} - only ${tradeItems.length} items`)
        continue
      }

      console.log(`Consolidating ${tradeItems.length} items for ${tradeName}...`)

      // Use AI to consolidate
      const consolidated = await consolidateTradeItems(anthropic, tradeName, tradeItems)

      if (!consolidated || consolidated.length === 0) {
        console.log(`AI returned no consolidated items for ${tradeName}`)
        continue
      }

      console.log(`AI created ${consolidated.length} consolidated items for ${tradeName}`)

      // Delete old items
      const oldIds = tradeItems.map(i => i.id)
      const { error: deleteError } = await supabase
        .from('bid_items')
        .delete()
        .in('id', oldIds)

      if (deleteError) {
        console.error(`Failed to delete old items for ${tradeName}:`, deleteError)
        continue
      }

      // Insert consolidated items
      const newItems = consolidated.map((item, idx) => ({
        project_id: projectId || tradeItems[0].project_id,
        bid_round_id: bidRoundId,
        trade_id: tradeId,
        item_number: `${divisionCode}-${String(idx + 1).padStart(3, '0')}`,
        description: item.description,
        notes: item.notes || null,
        quantity: 'Per drawings',
        unit: 'LS',
        ai_generated: true,
        ai_confidence: 0.9,
        status: 'open'
      }))

      const { error: insertError } = await supabase
        .from('bid_items')
        .insert(newItems)

      if (insertError) {
        console.error(`Failed to insert consolidated items for ${tradeName}:`, insertError)
        continue
      }

      totalConsolidated += tradeItems.length
      totalCreated += consolidated.length
    }

    const finalCount = items.length - totalConsolidated + totalCreated

    console.log(`Consolidation complete: ${items.length} -> ${finalCount} items`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        original_count: items.length,
        final_count: finalCount,
        trades_processed: tradeCount,
        items_consolidated: totalConsolidated,
        items_created: totalCreated
      })
    }

  } catch (error) {
    console.error('Consolidation error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to consolidate bid items',
        details: error.message
      })
    }
  }
}

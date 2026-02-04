/**
 * Consolidate Bid Items using AI
 *
 * Takes bid items for a single trade and uses AI to consolidate
 * them into clear, general scope descriptions.
 *
 * Call once per trade to avoid timeouts.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const config = {
  maxDuration: 60 // 1 minute per trade should be plenty
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

  // Calculate target item count based on input count for more predictable results
  const targetMin = Math.max(2, Math.ceil(items.length / 10))
  const targetMax = Math.min(8, Math.ceil(items.length / 3))
  const targetCount = Math.min(targetMax, Math.max(targetMin, 4))

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    temperature: 0, // Deterministic for consistent consolidation
    system: `You are a construction estimator creating clear, concise bid scope descriptions for subcontractors.

Your job is to take a list of detailed extracted items and consolidate them into general scope line items that are:
- Easy to understand at a glance
- Comprehensive (covering all the detailed items)
- Written in standard construction bidding language
- Not overly specific (use phrases like "all types as indicated on drawings" instead of listing every type)`,
    messages: [{
      role: 'user',
      content: `Consolidate these ${items.length} ${tradeName} bid items into EXACTLY ${targetCount} clear, general scope descriptions:

${itemDescriptions}

Return JSON array of consolidated items:
[
  {
    "description": "All gypsum board wall partitions as indicated on drawings, including all partition types per partition schedule",
    "notes": "Includes framing, insulation, blocking, and accessories"
  }
]

IMPORTANT: Return EXACTLY ${targetCount} consolidated items.

Guidelines:
- Combine similar items into general statements
- Use "as indicated on drawings" or "per specifications" instead of listing every detail
- Keep descriptions to 1-2 sentences max
- Include important notes about what's included`
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
    const { bid_round_id: bidRoundId, project_id: projectId, trade_id: tradeId } = body

    if (!bidRoundId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'bid_round_id is required' })
      }
    }

    // If no trade_id specified, return list of trades to process
    if (!tradeId) {
      console.log(`Getting trades to consolidate for round: ${bidRoundId}`)

      const { data: items, error: fetchError } = await supabase
        .from('bid_items')
        .select('trade_id, trades(id, name, division_code)')
        .eq('bid_round_id', bidRoundId)
        .eq('ai_generated', true)

      if (fetchError) {
        throw new Error(`Failed to fetch bid items: ${fetchError.message}`)
      }

      // Group by trade and count
      const tradeCounts = {}
      for (const item of items || []) {
        const tid = item.trade_id
        if (!tradeCounts[tid]) {
          tradeCounts[tid] = {
            trade_id: tid,
            trade_name: item.trades?.name || 'Unknown',
            division_code: item.trades?.division_code || '00',
            count: 0
          }
        }
        tradeCounts[tid].count++
      }

      // Only return trades with 3+ items (worth consolidating)
      const tradesToProcess = Object.values(tradeCounts).filter(t => t.count >= 3)

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          total_items: items?.length || 0,
          trades: tradesToProcess
        })
      }
    }

    // Process a single trade
    console.log(`Consolidating trade ${tradeId} for round: ${bidRoundId}`)

    // Fetch items for this trade
    const { data: tradeItems, error: fetchError } = await supabase
      .from('bid_items')
      .select('*, trades(id, name, division_code)')
      .eq('bid_round_id', bidRoundId)
      .eq('trade_id', tradeId)
      .eq('ai_generated', true)

    if (fetchError) {
      throw new Error(`Failed to fetch trade items: ${fetchError.message}`)
    }

    if (!tradeItems || tradeItems.length < 3) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Not enough items to consolidate',
          original_count: tradeItems?.length || 0,
          final_count: tradeItems?.length || 0
        })
      }
    }

    const tradeName = tradeItems[0].trades?.name || 'Unknown'
    const divisionCode = tradeItems[0].trades?.division_code || '00'

    console.log(`Consolidating ${tradeItems.length} items for ${tradeName}...`)

    // Use AI to consolidate
    const consolidated = await consolidateTradeItems(anthropic, tradeName, tradeItems)

    if (!consolidated || consolidated.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'AI could not consolidate items',
          original_count: tradeItems.length,
          final_count: tradeItems.length
        })
      }
    }

    console.log(`AI created ${consolidated.length} consolidated items`)

    // Delete old items
    const oldIds = tradeItems.map(i => i.id)
    const { error: deleteError } = await supabase
      .from('bid_items')
      .delete()
      .in('id', oldIds)

    if (deleteError) {
      throw new Error(`Failed to delete old items: ${deleteError.message}`)
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
      throw new Error(`Failed to insert consolidated items: ${insertError.message}`)
    }

    console.log(`Consolidation complete for ${tradeName}: ${tradeItems.length} -> ${consolidated.length}`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        trade_name: tradeName,
        original_count: tradeItems.length,
        final_count: consolidated.length
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

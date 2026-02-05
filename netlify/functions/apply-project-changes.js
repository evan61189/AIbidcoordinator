/**
 * Apply approved changes from the AI assistant
 */

import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY
    )
  }
  return null
}

export async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '{}' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { project_id, changes } = JSON.parse(event.body)

    if (!project_id || !changes || !Array.isArray(changes)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'project_id and changes array required' }) }
    }

    const supabase = getSupabase()
    if (!supabase) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database not configured' }) }
    }

    const results = []

    for (const change of changes) {
      try {
        const result = await applyChange(supabase, project_id, change)
        results.push({ change, success: true, result })
      } catch (error) {
        results.push({ change, success: false, error: error.message })
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: failCount === 0,
        message: `Applied ${successCount} change(s)${failCount > 0 ? `, ${failCount} failed` : ''}`,
        results
      })
    }

  } catch (error) {
    console.error('Apply changes error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Failed to apply changes' })
    }
  }
}

async function applyChange(supabase, projectId, change) {
  const { type, details } = change

  switch (type) {
    case 'update_bid':
      return await updateBid(supabase, details)

    case 'select_bid':
      return await selectBid(supabase, projectId, details)

    case 'add_markup':
      return await addMarkup(supabase, projectId, details)

    case 'update_estimate':
      return await updateEstimate(supabase, details)

    case 'create_package':
      return await createPackage(supabase, projectId, details)

    case 'assign_items':
      return await assignItems(supabase, details)

    case 'move_bid_item':
      return await moveBidItem(supabase, details)

    case 'delete_bid_item':
      return await deleteBidItem(supabase, details)

    default:
      throw new Error(`Unknown change type: ${type}`)
  }
}

async function updateBid(supabase, details) {
  const { bid_id, amount, notes } = details

  if (!bid_id) throw new Error('bid_id required')

  const updates = {}
  if (amount !== undefined) updates.amount = amount
  if (notes !== undefined) updates.notes = notes
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('bids')
    .update(updates)
    .eq('id', bid_id)
    .select()
    .single()

  if (error) throw error
  return { updated: data }
}

async function selectBid(supabase, projectId, details) {
  const { bid_item_id, subcontractor_id, bid_id } = details

  // If bid_id provided, just mark it as selected
  if (bid_id) {
    // For now, we'll track selection in a separate way or update the bid status
    // This could be implemented with a 'selected_bids' table or a flag
    return { selected_bid_id: bid_id }
  }

  // Otherwise find the bid by item and subcontractor
  if (!bid_item_id || !subcontractor_id) {
    throw new Error('Either bid_id or both bid_item_id and subcontractor_id required')
  }

  const { data: bid } = await supabase
    .from('bids')
    .select('id')
    .eq('bid_item_id', bid_item_id)
    .eq('subcontractor_id', subcontractor_id)
    .single()

  if (!bid) throw new Error('Bid not found')

  return { selected_bid_id: bid.id }
}

async function addMarkup(supabase, projectId, details) {
  const { markup_percent, apply_to } = details

  if (markup_percent === undefined) throw new Error('markup_percent required')

  // Store markup settings for the project
  const { error } = await supabase
    .from('projects')
    .update({
      markup_percent: markup_percent,
      updated_at: new Date().toISOString()
    })
    .eq('id', projectId)

  if (error) throw error

  return { markup_applied: markup_percent, apply_to: apply_to || 'all' }
}

async function updateEstimate(supabase, details) {
  const { bid_item_id, estimated_cost } = details

  if (!bid_item_id) throw new Error('bid_item_id required')

  const { data, error } = await supabase
    .from('bid_items')
    .update({
      estimated_cost: estimated_cost,
      updated_at: new Date().toISOString()
    })
    .eq('id', bid_item_id)
    .select()
    .single()

  if (error) throw error
  return { updated: data }
}

async function createPackage(supabase, projectId, details) {
  const { name, description, bid_item_ids } = details

  if (!name) throw new Error('Package name required')

  // Create the package
  const { data: pkg, error: pkgError } = await supabase
    .from('scope_packages')
    .insert({
      project_id: projectId,
      name,
      description: description || ''
    })
    .select()
    .single()

  if (pkgError) throw pkgError

  // Add items if provided
  if (bid_item_ids?.length > 0) {
    const items = bid_item_ids.map(itemId => ({
      scope_package_id: pkg.id,
      bid_item_id: itemId
    }))

    const { error: itemsError } = await supabase
      .from('scope_package_items')
      .insert(items)

    if (itemsError) throw itemsError
  }

  return { created_package: pkg, items_added: bid_item_ids?.length || 0 }
}

async function assignItems(supabase, details) {
  const { package_id, bid_item_ids, remove_from_other_packages } = details

  if (!package_id || !bid_item_ids?.length) {
    throw new Error('package_id and bid_item_ids required')
  }

  // Optionally remove items from other packages first
  if (remove_from_other_packages) {
    await supabase
      .from('scope_package_items')
      .delete()
      .in('bid_item_id', bid_item_ids)
  }

  // Add to new package
  const items = bid_item_ids.map(itemId => ({
    scope_package_id: package_id,
    bid_item_id: itemId
  }))

  const { error } = await supabase
    .from('scope_package_items')
    .upsert(items, { onConflict: 'scope_package_id,bid_item_id' })

  if (error) throw error

  return { assigned: bid_item_ids.length }
}

async function moveBidItem(supabase, details) {
  const { bid_item_id, trade_id } = details

  if (!bid_item_id) throw new Error('bid_item_id required')
  if (!trade_id) throw new Error('trade_id required')

  // Get the trade info for the response
  const { data: trade } = await supabase
    .from('trades')
    .select('name, division_code')
    .eq('id', trade_id)
    .single()

  const { data, error } = await supabase
    .from('bid_items')
    .update({
      trade_id: trade_id,
      updated_at: new Date().toISOString()
    })
    .eq('id', bid_item_id)
    .select()
    .single()

  if (error) throw error

  return {
    moved: data,
    new_division: trade ? `${trade.division_code} - ${trade.name}` : trade_id
  }
}

async function deleteBidItem(supabase, details) {
  const { bid_item_id } = details

  if (!bid_item_id) throw new Error('bid_item_id required')

  // First, remove from any scope packages
  await supabase
    .from('scope_package_items')
    .delete()
    .eq('bid_item_id', bid_item_id)

  // Delete any bids associated with this item
  await supabase
    .from('bids')
    .delete()
    .eq('bid_item_id', bid_item_id)

  // Delete the bid item itself
  const { error } = await supabase
    .from('bid_items')
    .delete()
    .eq('id', bid_item_id)

  if (error) throw error

  return { deleted: bid_item_id }
}

/**
 * Consolidate Bid Items
 *
 * Deduplicates bid items within a bid round by merging similar items.
 */

import { createClient } from '@supabase/supabase-js'

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

/**
 * Normalize description for comparison
 */
function normalizeDescription(desc) {
  if (!desc) return ''
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')        // Normalize whitespace
    .trim()
}

/**
 * Calculate similarity between two strings (simple word overlap)
 */
function calculateSimilarity(str1, str2) {
  const words1 = new Set(normalizeDescription(str1).split(' ').filter(w => w.length > 2))
  const words2 = new Set(normalizeDescription(str2).split(' ').filter(w => w.length > 2))

  if (words1.size === 0 || words2.size === 0) return 0

  const intersection = [...words1].filter(w => words2.has(w)).length
  const union = new Set([...words1, ...words2]).size

  return intersection / union // Jaccard similarity
}

/**
 * Group similar bid items
 */
function groupSimilarItems(items, similarityThreshold = 0.7) {
  const groups = []
  const used = new Set()

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue

    const group = [items[i]]
    used.add(i)

    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue

      // Must be same trade
      if (items[i].trade_id !== items[j].trade_id) continue

      const similarity = calculateSimilarity(items[i].description, items[j].description)

      if (similarity >= similarityThreshold) {
        group.push(items[j])
        used.add(j)
      }
    }

    groups.push(group)
  }

  return groups
}

/**
 * Merge a group of similar items into one
 */
function mergeGroup(group) {
  if (group.length === 1) return { keep: group[0], delete: [] }

  // Sort by confidence (highest first) and description length (longest first)
  const sorted = [...group].sort((a, b) => {
    const confDiff = (b.ai_confidence || 0) - (a.ai_confidence || 0)
    if (confDiff !== 0) return confDiff
    return (b.description?.length || 0) - (a.description?.length || 0)
  })

  const keep = sorted[0]
  const toDelete = sorted.slice(1)

  // Combine notes from all items
  const allNotes = group
    .map(item => item.notes)
    .filter(n => n && n.trim())
  const uniqueNotes = [...new Set(allNotes)]

  // Combine locations
  const allLocations = group
    .map(item => item.location)
    .filter(l => l && l.trim())
  const uniqueLocations = [...new Set(allLocations)]

  // Update the keeper with combined info
  const updates = {}
  if (uniqueNotes.length > 0) {
    updates.notes = uniqueNotes.join('; ')
  }
  if (uniqueLocations.length > 1) {
    updates.location = uniqueLocations.join(', ')
  }

  return { keep, delete: toDelete, updates }
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
  if (!supabase) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Supabase not configured' })
    }
  }

  try {
    const body = JSON.parse(event.body)
    const { bid_round_id: bidRoundId, similarity_threshold: threshold = 0.7 } = body

    if (!bidRoundId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'bid_round_id is required' })
      }
    }

    console.log(`Consolidating bid items for round: ${bidRoundId}`)

    // Fetch all bid items for this round
    const { data: items, error: fetchError } = await supabase
      .from('bid_items')
      .select('*')
      .eq('bid_round_id', bidRoundId)
      .eq('ai_generated', true) // Only consolidate AI-generated items
      .order('created_at', { ascending: true })

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
          final_count: 0,
          removed_count: 0
        })
      }
    }

    console.log(`Found ${items.length} AI-generated bid items`)

    // Group similar items
    const groups = groupSimilarItems(items, threshold)
    console.log(`Grouped into ${groups.length} unique items`)

    let removedCount = 0
    let updatedCount = 0

    // Process each group
    for (const group of groups) {
      if (group.length === 1) continue // No duplicates

      const { keep, delete: toDelete, updates } = mergeGroup(group)

      // Update the keeper if needed
      if (updates && Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('bid_items')
          .update(updates)
          .eq('id', keep.id)

        if (updateError) {
          console.error(`Failed to update item ${keep.id}:`, updateError)
        } else {
          updatedCount++
        }
      }

      // Delete duplicates
      const deleteIds = toDelete.map(item => item.id)
      if (deleteIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('bid_items')
          .delete()
          .in('id', deleteIds)

        if (deleteError) {
          console.error(`Failed to delete duplicates:`, deleteError)
        } else {
          removedCount += deleteIds.length
        }
      }
    }

    console.log(`Consolidation complete: removed ${removedCount} duplicates, updated ${updatedCount} items`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        original_count: items.length,
        final_count: items.length - removedCount,
        removed_count: removedCount,
        updated_count: updatedCount,
        groups_count: groups.length
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

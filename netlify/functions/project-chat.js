/**
 * AI Project Assistant - Chat endpoint
 * Handles questions about the project and proposes modifications
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

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
    const { project_id, message, conversation_history = [] } = JSON.parse(event.body)

    if (!project_id || !message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'project_id and message are required' }) }
    }

    const supabase = getSupabase()
    if (!supabase) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database not configured' }) }
    }

    // Fetch comprehensive project data
    const projectData = await fetchProjectData(supabase, project_id)

    // Build context for AI
    const systemPrompt = buildSystemPrompt(projectData)

    // Build messages array with conversation history
    const messages = [
      ...conversation_history.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user', content: message }
    ]

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages
    })

    const assistantMessage = response.content[0]?.text || ''

    // Parse for any proposed changes
    const proposedChanges = parseProposedChanges(assistantMessage)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        response: assistantMessage,
        proposed_changes: proposedChanges,
        has_changes: proposedChanges.length > 0
      })
    }

  } catch (error) {
    console.error('Project chat error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Failed to process request' })
    }
  }
}

async function fetchProjectData(supabase, projectId) {
  // Fetch project details
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  // Fetch bid items with trade info
  const { data: bidItems } = await supabase
    .from('bid_items')
    .select(`
      id, item_number, description, quantity, unit, estimated_cost,
      trade:trades (id, name, division_code)
    `)
    .eq('project_id', projectId)

  // Fetch all bids for this project's items
  const bidItemIds = bidItems?.map(i => i.id) || []
  let bids = []
  if (bidItemIds.length > 0) {
    const { data: bidsData } = await supabase
      .from('bids')
      .select(`
        id, amount, status, notes, submitted_at,
        subcontractor:subcontractors (id, company_name, email),
        bid_item_id
      `)
      .in('bid_item_id', bidItemIds)

    bids = bidsData || []
  }

  // Fetch scope packages
  const { data: scopePackages } = await supabase
    .from('scope_packages')
    .select(`
      id, name, description,
      items:scope_package_items (bid_item_id)
    `)
    .eq('project_id', projectId)

  // Organize bids by item and find lowest
  const bidsByItem = {}
  const lowestBidsByItem = {}
  for (const bid of bids) {
    if (!bidsByItem[bid.bid_item_id]) {
      bidsByItem[bid.bid_item_id] = []
    }
    bidsByItem[bid.bid_item_id].push(bid)

    if (bid.amount && bid.status === 'submitted') {
      if (!lowestBidsByItem[bid.bid_item_id] || bid.amount < lowestBidsByItem[bid.bid_item_id].amount) {
        lowestBidsByItem[bid.bid_item_id] = bid
      }
    }
  }

  // Organize by package
  const packageSummaries = (scopePackages || []).map(pkg => {
    const itemIds = pkg.items?.map(i => i.bid_item_id) || []
    const packageBids = bids.filter(b => itemIds.includes(b.bid_item_id))

    // Find subs who bid on this package
    const subBids = {}
    for (const bid of packageBids) {
      if (!bid.subcontractor || bid.status !== 'submitted' || !bid.amount) continue
      const subId = bid.subcontractor.id
      if (!subBids[subId]) {
        subBids[subId] = {
          subcontractor: bid.subcontractor,
          total: 0,
          itemCount: 0
        }
      }
      subBids[subId].total += bid.amount
      subBids[subId].itemCount++
    }

    const subTotals = Object.values(subBids).sort((a, b) => a.total - b.total)

    return {
      name: pkg.name,
      itemCount: itemIds.length,
      bidders: subTotals.map(s => ({
        company: s.subcontractor.company_name,
        total: s.total,
        itemsCovered: s.itemCount
      })),
      lowestBid: subTotals[0] ? {
        company: subTotals[0].subcontractor.company_name,
        total: subTotals[0].total
      } : null
    }
  })

  return {
    project,
    bidItems: bidItems || [],
    bids,
    bidsByItem,
    lowestBidsByItem,
    scopePackages: scopePackages || [],
    packageSummaries
  }
}

function buildSystemPrompt(data) {
  const { project, bidItems, bids, lowestBidsByItem, packageSummaries } = data

  // Calculate totals
  let totalLowestBids = 0
  for (const bid of Object.values(lowestBidsByItem)) {
    totalLowestBids += bid.amount || 0
  }

  // Build package summary text
  const packageText = packageSummaries.map(pkg => {
    const biddersText = pkg.bidders.length > 0
      ? pkg.bidders.map(b => `    - ${b.company}: $${b.total.toLocaleString()} (${b.itemsCovered} items)`).join('\n')
      : '    No bids yet'
    return `  ${pkg.name} (${pkg.itemCount} items):\n    Lowest: ${pkg.lowestBid ? `${pkg.lowestBid.company} at $${pkg.lowestBid.total.toLocaleString()}` : 'No bids'}\n${biddersText}`
  }).join('\n\n')

  // Build bid items summary
  const itemsText = bidItems.slice(0, 50).map(item => {
    const lowest = lowestBidsByItem[item.id]
    const bidsForItem = data.bidsByItem[item.id] || []
    return `  - ${item.item_number || ''} ${item.description}: ${lowest ? `$${lowest.amount.toLocaleString()} (${lowest.subcontractor?.company_name})` : 'No bids'} [${bidsForItem.length} bid(s)]`
  }).join('\n')

  return `You are an AI assistant for construction bid coordination at Clipper Construction. You help estimators and project managers analyze bids, answer questions, and make modifications to estimates.

CURRENT PROJECT: ${project?.name || 'Unknown'}
Location: ${project?.location || 'N/A'}
Bid Date: ${project?.bid_date || 'N/A'}
Status: ${project?.status || 'N/A'}

PROJECT SUMMARY:
- Total Bid Items: ${bidItems.length}
- Total Bids Received: ${bids.filter(b => b.status === 'submitted').length}
- Sum of Lowest Bids: $${totalLowestBids.toLocaleString()}

BID PACKAGES:
${packageText || 'No packages defined'}

BID ITEMS (first 50):
${itemsText || 'No bid items'}

CAPABILITIES:
1. ANSWER QUESTIONS about bids, packages, subcontractors, and pricing
2. PROPOSE CHANGES to the estimate (these require user approval before applying)

When the user asks you to MAKE A CHANGE (like updating a bid amount, selecting a different subcontractor, adding markup, etc.), you MUST respond with a structured change proposal in this exact format:

<proposed_change>
{
  "type": "update_bid" | "select_bid" | "add_markup" | "update_estimate" | "create_package" | "assign_items",
  "description": "Human-readable description of what will change",
  "target": "What is being modified (item name, package name, etc.)",
  "current_value": "The current state",
  "new_value": "What it will become",
  "details": { /* type-specific details */ }
}
</proposed_change>

You can include multiple <proposed_change> blocks if the user's request requires multiple changes.

For QUESTIONS (not changes), just answer naturally with the data available.

Examples of questions you can answer:
- "Who has the lowest electrical bid?"
- "What's the total for all MEP packages?"
- "Which packages don't have any bids yet?"
- "Compare the two lowest plumbing bids"

Examples of changes that need approval:
- "Select ABC Electric for all electrical items"
- "Add 10% markup to all bids"
- "Update the HVAC estimate to $150,000"
- "Move insulation items to the HVAC package"

Always be specific with numbers and company names. If you don't have enough information to answer, say so.`
}

function parseProposedChanges(response) {
  const changes = []
  const regex = /<proposed_change>\s*([\s\S]*?)\s*<\/proposed_change>/g
  let match

  while ((match = regex.exec(response)) !== null) {
    try {
      const jsonStr = match[1].trim()
      const change = JSON.parse(jsonStr)
      changes.push(change)
    } catch (e) {
      console.warn('Failed to parse proposed change:', e.message)
    }
  }

  return changes
}

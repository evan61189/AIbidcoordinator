import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not set. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
)

// Helper functions for common database operations

export async function fetchProjects(status = null) {
  let query = supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function fetchProject(id) {
  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      bid_items (
        *,
        trade:trades (*),
        bids (
          *,
          subcontractor:subcontractors (*)
        )
      ),
      drawings (*),
      project_subcontractors (
        subcontractor:subcontractors (*)
      )
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createProject(project) {
  const { data, error } = await supabase
    .from('projects')
    .insert(project)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateProject(id, updates) {
  const { data, error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteProject(id) {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function fetchSubcontractors(activeOnly = true) {
  let query = supabase
    .from('subcontractors')
    .select(`
      *,
      trades:subcontractor_trades (
        trade:trades (*)
      )
    `)
    .order('company_name')

  if (activeOnly) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function fetchSubcontractor(id) {
  const { data, error } = await supabase
    .from('subcontractors')
    .select(`
      *,
      trades:subcontractor_trades (
        trade:trades (*)
      ),
      bids (
        *,
        bid_item:bid_items (
          *,
          project:projects (name, project_number)
        )
      ),
      communications (*)
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function createSubcontractor(subcontractor, tradeIds = []) {
  const { data, error } = await supabase
    .from('subcontractors')
    .insert(subcontractor)
    .select()
    .single()

  if (error) throw error

  // Add trade associations
  if (tradeIds.length > 0) {
    const tradeLinks = tradeIds.map(tradeId => ({
      subcontractor_id: data.id,
      trade_id: tradeId
    }))

    await supabase.from('subcontractor_trades').insert(tradeLinks)
  }

  return data
}

export async function updateSubcontractor(id, updates, tradeIds = null) {
  const { data, error } = await supabase
    .from('subcontractors')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  // Update trade associations if provided
  if (tradeIds !== null) {
    await supabase.from('subcontractor_trades').delete().eq('subcontractor_id', id)

    if (tradeIds.length > 0) {
      const tradeLinks = tradeIds.map(tradeId => ({
        subcontractor_id: id,
        trade_id: tradeId
      }))
      await supabase.from('subcontractor_trades').insert(tradeLinks)
    }
  }

  return data
}

export async function fetchTrades() {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .order('division_code')

  if (error) throw error
  return data
}

export async function fetchBidItems(projectId) {
  const { data, error } = await supabase
    .from('bid_items')
    .select(`
      *,
      trade:trades (*),
      bids (
        *,
        subcontractor:subcontractors (*)
      )
    `)
    .eq('project_id', projectId)
    .order('item_number')

  if (error) throw error
  return data
}

export async function createBidItem(bidItem) {
  const { data, error } = await supabase
    .from('bid_items')
    .insert(bidItem)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function createBid(bid) {
  const { data, error } = await supabase
    .from('bids')
    .insert(bid)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateBid(id, updates) {
  const { data, error } = await supabase
    .from('bids')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteBids(ids) {
  const { error } = await supabase
    .from('bids')
    .delete()
    .in('id', ids)

  if (error) throw error
  return true
}

export async function fetchBids(filters = {}) {
  let query = supabase
    .from('bids')
    .select(`
      *,
      subcontractor:subcontractors (*),
      bid_item:bid_items (
        *,
        project:projects (*),
        trade:trades (*)
      )
    `)
    .order('created_at', { ascending: false })

  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }

  if (filters.projectId) {
    query = query.eq('bid_item.project_id', filters.projectId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function fetchDrawingsForProject(projectId) {
  const { data, error } = await supabase
    .from('drawings')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function logCommunication(communication) {
  const { data, error } = await supabase
    .from('communications')
    .insert(communication)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getDashboardStats() {
  const [projects, bids, subcontractors] = await Promise.all([
    supabase.from('projects').select('id, status'),
    supabase.from('bids').select('id, status'),
    supabase.from('subcontractors').select('id').eq('is_active', true)
  ])

  const activeProjects = projects.data?.filter(p => p.status === 'bidding').length || 0
  const pendingBids = bids.data?.filter(b => b.status === 'invited').length || 0
  const submittedBids = bids.data?.filter(b => b.status === 'submitted').length || 0
  const totalSubcontractors = subcontractors.data?.length || 0

  return { activeProjects, pendingBids, submittedBids, totalSubcontractors }
}

// Bid Responses (from parsed emails)
export async function fetchBidResponses(status = null) {
  let query = supabase
    .from('bid_responses')
    .select(`
      *,
      project:projects (id, name),
      subcontractor:subcontractors (id, company_name, email),
      inbound_email:inbound_emails (id, from_email, from_name, subject, received_at)
    `)
    .order('created_at', { ascending: false })

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function updateBidResponse(id, updates) {
  const { data, error } = await supabase
    .from('bid_responses')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function approveBidResponse(bidResponseId, bidId) {
  // Update the bid with the amount from the response
  const { data: response } = await supabase
    .from('bid_responses')
    .select('total_amount, line_items')
    .eq('id', bidResponseId)
    .single()

  if (response) {
    // Update the bid record
    await supabase
      .from('bids')
      .update({
        amount: response.total_amount,
        status: 'submitted',
        submitted_at: new Date().toISOString()
      })
      .eq('id', bidId)

    // Mark response as approved
    await supabase
      .from('bid_responses')
      .update({
        status: 'approved',
        bid_id: bidId,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', bidResponseId)
  }

  return response
}

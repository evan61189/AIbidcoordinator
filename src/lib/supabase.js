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

// ============================================
// PROJECTS
// ============================================

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

// ============================================
// SUBCONTRACTORS
// ============================================

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

export async function createSubcontractor(subcontractor) {
  const { data, error } = await supabase
    .from('subcontractors')
    .insert(subcontractor)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateSubcontractor(id, updates) {
  const { data, error } = await supabase
    .from('subcontractors')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// ============================================
// TRADES
// ============================================

export async function fetchTrades() {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .order('division_code')

  if (error) throw error
  return data
}

// ============================================
// BID ITEMS
// ============================================

export async function fetchProjectBidItems(projectId) {
  // Get active bid rounds for this project
  const { data: rounds } = await supabase
    .from('bid_rounds')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'active')

  const activeRoundIds = rounds?.map(r => r.id) || []

  if (activeRoundIds.length === 0) {
    return []
  }

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
    .in('bid_round_id', activeRoundIds)
    .order('item_number')

  if (error) throw error
  return data || []
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

export async function updateBidItem(id, updates) {
  // If changing trade/division, remove from scope packages
  if (updates.trade_id) {
    await supabase
      .from('scope_package_items')
      .delete()
      .eq('bid_item_id', id)
  }

  const { data, error } = await supabase
    .from('bid_items')
    .update(updates)
    .eq('id', id)
    .select(`*, trade:trades (*)`)
    .single()

  if (error) throw error
  return data
}

export async function deleteBidItem(id) {
  // Get affected packages before deleting
  const { data: packageItems } = await supabase
    .from('scope_package_items')
    .select('scope_package_id')
    .eq('bid_item_id', id)

  const affectedPackageIds = packageItems?.map(p => p.scope_package_id) || []

  // Delete from scope_package_items
  await supabase.from('scope_package_items').delete().eq('bid_item_id', id)

  // Delete associated bids
  await supabase.from('bids').delete().eq('bid_item_id', id)

  // Delete the bid item
  const { error } = await supabase.from('bid_items').delete().eq('id', id)
  if (error) throw error

  // Clean up empty packages
  for (const pkgId of affectedPackageIds) {
    const { count } = await supabase
      .from('scope_package_items')
      .select('*', { count: 'exact', head: true })
      .eq('scope_package_id', pkgId)

    if (count === 0) {
      await supabase.from('scope_packages').delete().eq('id', pkgId)
    }
  }
}

export async function deleteAllProjectBidItems(projectId) {
  const { error } = await supabase
    .from('bid_items')
    .delete()
    .eq('project_id', projectId)

  if (error) throw error
}

// ============================================
// BIDS
// ============================================

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
}

export async function fetchBidsForLeveling(projectId) {
  const { data, error } = await supabase
    .from('bids')
    .select(`
      id, amount, notes, status, submitted_at,
      subcontractor:subcontractors (id, company_name, contact_name, email),
      bid_item:bid_items (
        id, description, item_number, project_id,
        trade:trades (id, name, division_code)
      )
    `)
    .eq('bid_item.project_id', projectId)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })

  if (error) throw error
  return (data || []).filter(b => b.bid_item)
}

// ============================================
// DRAWINGS
// ============================================

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

// ============================================
// BID RESPONSES
// ============================================

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

// ============================================
// SCOPE PACKAGES
// ============================================

export async function fetchScopePackages(projectId) {
  const { data, error } = await supabase
    .from('scope_packages')
    .select(`*, items:scope_package_items (bid_item_id)`)
    .eq('project_id', projectId)
    .order('created_at')

  if (error) {
    console.warn('scope_packages query failed:', error.message)
    return []
  }
  return data
}

export async function createScopePackage(projectId, name, description, bidItemIds = []) {
  const { data: pkg, error } = await supabase
    .from('scope_packages')
    .insert({ project_id: projectId, name, description })
    .select()
    .single()

  if (error) throw error

  if (bidItemIds.length > 0) {
    const links = bidItemIds.map(bidItemId => ({
      scope_package_id: pkg.id,
      bid_item_id: bidItemId
    }))
    await supabase.from('scope_package_items').insert(links)
  }

  return pkg
}

export async function updateScopePackage(id, updates, bidItemIds = null) {
  const { data, error } = await supabase
    .from('scope_packages')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  if (bidItemIds !== null) {
    await supabase.from('scope_package_items').delete().eq('scope_package_id', id)

    if (bidItemIds.length > 0) {
      const links = bidItemIds.map(bidItemId => ({
        scope_package_id: id,
        bid_item_id: bidItemId
      }))
      await supabase.from('scope_package_items').insert(links)
    }
  }

  return data
}

export async function deleteScopePackage(id) {
  const { error } = await supabase
    .from('scope_packages')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ============================================
// PACKAGE BIDS
// ============================================

export async function fetchPackageBids(status = null, projectId = null) {
  let query = supabase
    .from('package_bids')
    .select(`
      *,
      scope_package:scope_packages (id, name),
      subcontractor:subcontractors (id, company_name, contact_name, email),
      project:projects (id, name),
      bid_response:bid_responses (id, total_amount, ai_confidence_score),
      clarification:bid_clarifications (id, status, packages_requested)
    `)
    .order('created_at', { ascending: false })

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  if (projectId) {
    query = query.eq('project_id', projectId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function updatePackageBid(id, updates) {
  const { data, error } = await supabase
    .from('package_bids')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// Consolidated approve/reject into status update
export async function approvePackageBid(id) {
  return updatePackageBid(id, {
    status: 'approved',
    approved_at: new Date().toISOString()
  })
}

export async function rejectPackageBid(id) {
  return updatePackageBid(id, { status: 'rejected' })
}

export async function fetchApprovedPackageBidsForProject(projectId) {
  const { data, error } = await supabase
    .from('package_bids')
    .select(`
      *,
      scope_package:scope_packages (
        id, name,
        scope_package_items (
          bid_item_id,
          bid_item:bid_items (
            id, description, item_number,
            trade:trades (id, name, division_code)
          )
        )
      ),
      subcontractor:subcontractors (id, company_name)
    `)
    .eq('project_id', projectId)
    .eq('status', 'approved')
    .order('amount', { ascending: true })

  if (error) throw error
  return data
}

// ============================================
// BID INVITATIONS
// ============================================

export async function fetchPendingInvitations() {
  const { data, error } = await supabase
    .from('bid_invitations')
    .select(`
      *,
      project:projects (id, name),
      subcontractor:subcontractors (id, company_name, contact_name, email)
    `)
    .in('status', ['sent', 'delivered', 'opened'])
    .order('sent_at', { ascending: false })

  if (error) throw error
  return data
}

// ============================================
// DASHBOARD
// ============================================

export async function getDashboardStats() {
  const [projects, bids, subcontractors] = await Promise.all([
    supabase.from('projects').select('id, status'),
    supabase.from('bids').select('id, status'),
    supabase.from('subcontractors').select('id').eq('is_active', true)
  ])

  return {
    activeProjects: projects.data?.filter(p => p.status === 'bidding').length || 0,
    pendingBids: bids.data?.filter(b => b.status === 'invited').length || 0,
    submittedBids: bids.data?.filter(b => b.status === 'submitted').length || 0,
    totalSubcontractors: subcontractors.data?.length || 0
  }
}

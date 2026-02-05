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

// Fetch bid items for a project - only from active rounds
export async function fetchProjectBidItems(projectId) {
  // First get active bid rounds for this project
  const { data: rounds } = await supabase
    .from('bid_rounds')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'active')

  const activeRoundIds = rounds?.map(r => r.id) || []

  if (activeRoundIds.length === 0) {
    // No active rounds - return empty
    return []
  }

  // Fetch bid items from active rounds only
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

// Delete all bid items for a project (cleanup orphans)
export async function deleteAllProjectBidItems(projectId) {
  const { error } = await supabase
    .from('bid_items')
    .delete()
    .eq('project_id', projectId)

  if (error) throw error
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

export async function createSubcontractor(subcontractor) {
  // package_types is stored directly on the subcontractors table as a text array
  const { data, error } = await supabase
    .from('subcontractors')
    .insert(subcontractor)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateSubcontractor(id, updates) {
  // package_types is stored directly on the subcontractors table as a text array
  const { data, error } = await supabase
    .from('subcontractors')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
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

export async function updateBidItem(id, updates) {
  // If changing trade/division, remove from scope packages so item can be re-assigned
  // This prevents items from staying in mismatched packages after moving divisions
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
    .select(`
      *,
      trade:trades (*)
    `)
    .single()

  if (error) throw error
  return data
}

export async function deleteBidItem(id) {
  // First delete any scope_package_items referencing this bid item
  await supabase
    .from('scope_package_items')
    .delete()
    .eq('bid_item_id', id)

  // Then delete the bid item itself
  const { error } = await supabase
    .from('bid_items')
    .delete()
    .eq('id', id)

  if (error) throw error
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

// ============================================
// SCOPE PACKAGES - For bid leveling comparison
// ============================================

export async function fetchScopePackages(projectId) {
  const { data, error } = await supabase
    .from('scope_packages')
    .select(`
      *,
      items:scope_package_items (
        bid_item_id
      )
    `)
    .eq('project_id', projectId)
    .order('created_at')

  // Return empty array if table doesn't exist or other error
  // This allows the app to work before migrations are run
  if (error) {
    console.warn('scope_packages query failed (table may not exist):', error.message)
    return []
  }
  return data
}

export async function createScopePackage(projectId, name, description, bidItemIds = []) {
  // Create the package
  const { data: pkg, error: pkgError } = await supabase
    .from('scope_packages')
    .insert({ project_id: projectId, name, description })
    .select()
    .single()

  if (pkgError) throw pkgError

  // Add bid items to package
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

  // Update bid item associations if provided
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

export async function fetchBidsForLeveling(projectId) {
  // Fetch all submitted bids for a project with their bid items and subcontractors
  const { data, error } = await supabase
    .from('bids')
    .select(`
      id,
      amount,
      notes,
      status,
      submitted_at,
      subcontractor:subcontractors (id, company_name, contact_name, email),
      bid_item:bid_items (
        id,
        description,
        item_number,
        trade:trades (id, name, division_code),
        project_id
      )
    `)
    .eq('bid_item.project_id', projectId)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })

  if (error) throw error
  // Filter out nulls from the join
  return (data || []).filter(b => b.bid_item)
}

// ============================================
// PACKAGE BIDS - For package-level bid management
// ============================================

export async function fetchPackageBids(status = null, projectId = null) {
  let query = supabase
    .from('package_bids')
    .select(`
      *,
      scope_package:scope_packages (id, name, package_type),
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
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function approvePackageBid(packageBidId) {
  const { data, error } = await supabase
    .from('package_bids')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', packageBidId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function rejectPackageBid(packageBidId) {
  const { data, error } = await supabase
    .from('package_bids')
    .update({
      status: 'rejected',
      updated_at: new Date().toISOString()
    })
    .eq('id', packageBidId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Fetch approved package bids for bid leveling views
export async function fetchApprovedPackageBidsForProject(projectId) {
  const { data, error } = await supabase
    .from('package_bids')
    .select(`
      *,
      scope_package:scope_packages (
        id,
        name,
        package_type,
        scope_package_items (
          bid_item_id,
          bid_item:bid_items (
            id,
            description,
            item_number,
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
// BID INVITATIONS - For tracking sent invitations
// ============================================

export async function fetchBidInvitations(status = null, projectId = null) {
  let query = supabase
    .from('bid_invitations')
    .select(`
      *,
      project:projects (id, name),
      subcontractor:subcontractors (id, company_name, contact_name, email)
    `)
    .order('sent_at', { ascending: false })

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

export async function fetchPendingInvitations() {
  // Fetch invitations that haven't received a reply yet
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

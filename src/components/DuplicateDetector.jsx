import { useState, useEffect } from 'react'
import {
  Copy,
  AlertTriangle,
  Merge,
  X,
  Check,
  ChevronDown,
  ChevronUp,
  Users,
  Mail,
  Phone,
  MapPin,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { supabase } from '../lib/supabase'

/**
 * Calculate similarity between two strings using Levenshtein distance
 */
function stringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0

  const s1 = str1.toLowerCase().trim()
  const s2 = str2.toLowerCase().trim()

  if (s1 === s2) return 1

  const longer = s1.length > s2.length ? s1 : s2
  const shorter = s1.length > s2.length ? s2 : s1

  if (longer.length === 0) return 1

  // Calculate Levenshtein distance
  const costs = []
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j
      } else if (j > 0) {
        let newValue = costs[j - 1]
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
        }
        costs[j - 1] = lastValue
        lastValue = newValue
      }
    }
    if (i > 0) costs[s2.length] = lastValue
  }

  return 1 - costs[s2.length] / longer.length
}

/**
 * Normalize company name for comparison
 */
function normalizeCompanyName(name) {
  if (!name) return ''

  return name
    .toLowerCase()
    .trim()
    // Remove common suffixes
    .replace(/\b(inc|llc|llp|corp|co|ltd|company|incorporated|limited|plumbing|electric|electrical|mechanical|hvac|construction|contractors?|services?|enterprises?)\b\.?/gi, '')
    // Remove special characters
    .replace(/[^a-z0-9\s]/g, '')
    // Remove extra spaces
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find potential duplicates in a list of subcontractors
 */
function findPotentialDuplicates(subcontractors) {
  const duplicateGroups = []
  const processed = new Set()

  for (let i = 0; i < subcontractors.length; i++) {
    if (processed.has(subcontractors[i].id)) continue

    const current = subcontractors[i]
    const currentNorm = normalizeCompanyName(current.company_name)
    const group = [current]

    for (let j = i + 1; j < subcontractors.length; j++) {
      if (processed.has(subcontractors[j].id)) continue

      const other = subcontractors[j]
      const otherNorm = normalizeCompanyName(other.company_name)

      // Calculate similarity score
      const nameSimilarity = stringSimilarity(currentNorm, otherNorm)

      // Check for exact email match
      const emailMatch = current.email && other.email &&
        current.email.toLowerCase() === other.email.toLowerCase()

      // Check for exact phone match (normalized)
      const phoneMatch = current.phone && other.phone &&
        current.phone.replace(/\D/g, '') === other.phone.replace(/\D/g, '')

      // Consider duplicates if:
      // - Names are >80% similar
      // - Or exact email match
      // - Or exact phone match
      if (nameSimilarity > 0.8 || emailMatch || phoneMatch) {
        group.push(other)
        processed.add(other.id)
      }
    }

    if (group.length > 1) {
      duplicateGroups.push({
        id: `group-${current.id}`,
        members: group,
        similarity: group.length > 1 ?
          stringSimilarity(
            normalizeCompanyName(group[0].company_name),
            normalizeCompanyName(group[1].company_name)
          ) : 1
      })
      processed.add(current.id)
    }
  }

  return duplicateGroups.sort((a, b) => b.similarity - a.similarity)
}

export default function DuplicateDetector({ onClose }) {
  const [subcontractors, setSubcontractors] = useState([])
  const [duplicateGroups, setDuplicateGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState(null)
  const [merging, setMerging] = useState(null)
  const [selectedPrimary, setSelectedPrimary] = useState({})

  useEffect(() => {
    loadSubcontractors()
  }, [])

  async function loadSubcontractors() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('subcontractors')
        .select(`
          *,
          trades:subcontractor_trades (
            trade:trades (id, name, division_code)
          )
        `)
        .eq('is_active', true)
        .order('company_name')

      if (error) throw error
      setSubcontractors(data || [])
      scanForDuplicates(data || [])
    } catch (error) {
      console.error('Error loading subcontractors:', error)
    } finally {
      setLoading(false)
    }
  }

  function scanForDuplicates(subs) {
    setScanning(true)
    const groups = findPotentialDuplicates(subs)
    setDuplicateGroups(groups)

    // Pre-select the first member of each group as primary
    const primaries = {}
    groups.forEach(group => {
      // Select the one with most complete data as primary
      const sorted = [...group.members].sort((a, b) => {
        const scoreA = (a.email ? 1 : 0) + (a.phone ? 1 : 0) + (a.contact_name ? 1 : 0) + (a.trades?.length || 0)
        const scoreB = (b.email ? 1 : 0) + (b.phone ? 1 : 0) + (b.contact_name ? 1 : 0) + (b.trades?.length || 0)
        return scoreB - scoreA
      })
      primaries[group.id] = sorted[0].id
    })
    setSelectedPrimary(primaries)
    setScanning(false)
  }

  async function mergeGroup(groupId) {
    const group = duplicateGroups.find(g => g.id === groupId)
    if (!group) return

    const primaryId = selectedPrimary[groupId]
    const primarySub = group.members.find(m => m.id === primaryId)
    const duplicates = group.members.filter(m => m.id !== primaryId)

    if (!primarySub || duplicates.length === 0) return

    setMerging(groupId)

    try {
      // Merge data into primary record
      // Combine unique trades
      const allTradeIds = new Set()
      group.members.forEach(member => {
        member.trades?.forEach(t => {
          if (t.trade?.id) allTradeIds.add(t.trade.id)
        })
      })

      // Update primary with any missing data from duplicates
      const updateData = {}
      duplicates.forEach(dup => {
        if (!primarySub.contact_name && dup.contact_name) updateData.contact_name = dup.contact_name
        if (!primarySub.email && dup.email) updateData.email = dup.email
        if (!primarySub.phone && dup.phone) updateData.phone = dup.phone
        if (!primarySub.address && dup.address) updateData.address = dup.address
        if (!primarySub.city && dup.city) updateData.city = dup.city
        if (!primarySub.state && dup.state) updateData.state = dup.state
        if (!primarySub.zip && dup.zip) updateData.zip = dup.zip
        if (!primarySub.notes && dup.notes) {
          updateData.notes = dup.notes
        } else if (primarySub.notes && dup.notes && primarySub.notes !== dup.notes) {
          updateData.notes = `${primarySub.notes}\n\n[Merged from ${dup.company_name}]: ${dup.notes}`
        }
      })

      if (Object.keys(updateData).length > 0) {
        await supabase
          .from('subcontractors')
          .update(updateData)
          .eq('id', primaryId)
      }

      // Update trade associations
      if (allTradeIds.size > 0) {
        // Remove existing trades for primary
        await supabase
          .from('subcontractor_trades')
          .delete()
          .eq('subcontractor_id', primaryId)

        // Insert all unique trades
        const tradeLinks = Array.from(allTradeIds).map(tradeId => ({
          subcontractor_id: primaryId,
          trade_id: tradeId
        }))
        await supabase.from('subcontractor_trades').insert(tradeLinks)
      }

      // Update references in bids table
      for (const dup of duplicates) {
        await supabase
          .from('bids')
          .update({ subcontractor_id: primaryId })
          .eq('subcontractor_id', dup.id)
      }

      // Update references in communications table
      for (const dup of duplicates) {
        await supabase
          .from('communications')
          .update({ subcontractor_id: primaryId })
          .eq('subcontractor_id', dup.id)
      }

      // Mark duplicates as inactive (soft delete)
      for (const dup of duplicates) {
        await supabase
          .from('subcontractors')
          .update({
            is_active: false,
            notes: `[MERGED INTO ${primarySub.company_name}] ${dup.notes || ''}`
          })
          .eq('id', dup.id)
      }

      // Refresh data
      loadSubcontractors()

    } catch (error) {
      console.error('Error merging duplicates:', error)
      alert('Failed to merge records. Please try again.')
    } finally {
      setMerging(null)
    }
  }

  async function dismissGroup(groupId) {
    setDuplicateGroups(groups => groups.filter(g => g.id !== groupId))
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="text-gray-600 mt-3">Loading subcontractors...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Copy className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Duplicate Detection</h2>
              <p className="text-sm text-gray-500">
                {duplicateGroups.length > 0
                  ? `Found ${duplicateGroups.length} potential duplicate group(s)`
                  : 'No duplicates detected'
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scanForDuplicates(subcontractors)}
              disabled={scanning}
              className="btn btn-secondary btn-sm flex items-center gap-1"
            >
              {scanning ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Rescan
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {duplicateGroups.length > 0 ? (
            <div className="space-y-4">
              {duplicateGroups.map(group => (
                <div
                  key={group.id}
                  className="border border-orange-200 rounded-lg overflow-hidden bg-orange-50"
                >
                  {/* Group Header */}
                  <div
                    className="p-4 cursor-pointer hover:bg-orange-100 transition-colors"
                    onClick={() => setExpandedGroup(expandedGroup === group.id ? null : group.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="h-5 w-5 text-orange-500" />
                        <div>
                          <p className="font-medium text-gray-900">
                            {group.members.length} potential duplicates
                          </p>
                          <p className="text-sm text-gray-600">
                            {group.members.map(m => m.company_name).join(' | ')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-orange-600 font-medium">
                          {Math.round(group.similarity * 100)}% similar
                        </span>
                        {expandedGroup === group.id ? (
                          <ChevronUp className="h-5 w-5 text-gray-400" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedGroup === group.id && (
                    <div className="border-t border-orange-200 bg-white p-4">
                      <p className="text-sm text-gray-600 mb-4">
                        Select the primary record to keep. Data from other records will be merged into it.
                      </p>

                      <div className="space-y-3">
                        {group.members.map(member => (
                          <div
                            key={member.id}
                            className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                              selectedPrimary[group.id] === member.id
                                ? 'border-primary-500 bg-primary-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                            onClick={() => setSelectedPrimary({
                              ...selectedPrimary,
                              [group.id]: member.id
                            })}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-3">
                                <input
                                  type="radio"
                                  checked={selectedPrimary[group.id] === member.id}
                                  onChange={() => setSelectedPrimary({
                                    ...selectedPrimary,
                                    [group.id]: member.id
                                  })}
                                  className="mt-1"
                                />
                                <div>
                                  <p className="font-medium text-gray-900">
                                    {member.company_name}
                                    {selectedPrimary[group.id] === member.id && (
                                      <span className="ml-2 text-xs text-primary-600 font-normal">
                                        (Primary)
                                      </span>
                                    )}
                                  </p>
                                  {member.contact_name && (
                                    <p className="text-sm text-gray-600">{member.contact_name}</p>
                                  )}
                                  <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-500">
                                    {member.email && (
                                      <span className="flex items-center gap-1">
                                        <Mail className="h-3 w-3" />
                                        {member.email}
                                      </span>
                                    )}
                                    {member.phone && (
                                      <span className="flex items-center gap-1">
                                        <Phone className="h-3 w-3" />
                                        {member.phone}
                                      </span>
                                    )}
                                    {member.city && (
                                      <span className="flex items-center gap-1">
                                        <MapPin className="h-3 w-3" />
                                        {member.city}, {member.state}
                                      </span>
                                    )}
                                  </div>
                                  {member.trades?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      {member.trades.map((t, idx) => (
                                        <span
                                          key={idx}
                                          className="badge bg-gray-100 text-gray-700 text-xs"
                                        >
                                          {t.trade?.division_code || t.trade?.name}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="text-right text-xs text-gray-400">
                                ID: {member.id.substring(0, 8)}...
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200">
                        <button
                          onClick={() => dismissGroup(group.id)}
                          className="btn btn-secondary btn-sm"
                        >
                          Not Duplicates
                        </button>
                        <button
                          onClick={() => mergeGroup(group.id)}
                          disabled={merging === group.id}
                          className="btn btn-primary btn-sm flex items-center gap-1"
                        >
                          {merging === group.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Merge className="h-4 w-4" />
                          )}
                          Merge Records
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-300" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Duplicates Found</h3>
              <p className="text-gray-500 mb-4">
                Your subcontractor database looks clean! No potential duplicates were detected.
              </p>
              <p className="text-sm text-gray-400">
                Scanned {subcontractors.length} subcontractors
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-500">
            {subcontractors.length} total subcontractors
          </p>
          <button onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

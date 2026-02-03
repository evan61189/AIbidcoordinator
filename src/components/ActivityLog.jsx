import { useState, useEffect } from 'react'
import {
  Activity,
  Search,
  Filter,
  Calendar,
  FolderKanban,
  Users,
  FileText,
  Mail,
  MessageSquare,
  Bell,
  ChevronDown,
  ChevronUp,
  X,
  RefreshCw,
  Download
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { format, formatDistanceToNow, subDays } from 'date-fns'

const CATEGORY_ICONS = {
  project: FolderKanban,
  bid: FileText,
  subcontractor: Users,
  communication: Mail,
  rfi: MessageSquare,
  addendum: Bell,
  drawing: FileText,
  system: Activity,
  user: Users
}

const CATEGORY_COLORS = {
  project: 'bg-blue-100 text-blue-700',
  bid: 'bg-green-100 text-green-700',
  subcontractor: 'bg-purple-100 text-purple-700',
  communication: 'bg-cyan-100 text-cyan-700',
  rfi: 'bg-yellow-100 text-yellow-700',
  addendum: 'bg-orange-100 text-orange-700',
  drawing: 'bg-pink-100 text-pink-700',
  system: 'bg-gray-100 text-gray-700',
  user: 'bg-indigo-100 text-indigo-700'
}

const IMPORTANCE_COLORS = {
  low: 'border-l-gray-300',
  normal: 'border-l-blue-400',
  high: 'border-l-orange-500',
  critical: 'border-l-red-600'
}

export default function ActivityLog({ projectId, subcontractorId, onClose }) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(0)

  const [filters, setFilters] = useState({
    category: 'all',
    dateRange: '7d',
    importance: 'all',
    search: ''
  })

  const [expandedActivity, setExpandedActivity] = useState(null)

  const LIMIT = 50

  useEffect(() => {
    loadActivities(true)
  }, [projectId, subcontractorId, filters])

  async function loadActivities(reset = false) {
    if (reset) {
      setLoading(true)
      setOffset(0)
    } else {
      setLoadingMore(true)
    }

    try {
      let query = supabase
        .from('activity_log')
        .select(`
          *,
          project:projects (name, project_number),
          subcontractor:subcontractors (company_name)
        `)
        .order('created_at', { ascending: false })

      // Apply filters
      if (projectId) {
        query = query.eq('project_id', projectId)
      }
      if (subcontractorId) {
        query = query.eq('subcontractor_id', subcontractorId)
      }
      if (filters.category !== 'all') {
        query = query.eq('action_category', filters.category)
      }
      if (filters.importance !== 'all') {
        query = query.eq('importance', filters.importance)
      }

      // Date range filter
      const now = new Date()
      switch (filters.dateRange) {
        case '24h':
          query = query.gte('created_at', subDays(now, 1).toISOString())
          break
        case '7d':
          query = query.gte('created_at', subDays(now, 7).toISOString())
          break
        case '30d':
          query = query.gte('created_at', subDays(now, 30).toISOString())
          break
        case '90d':
          query = query.gte('created_at', subDays(now, 90).toISOString())
          break
        // 'all' - no date filter
      }

      // Search filter
      if (filters.search) {
        query = query.ilike('description', `%${filters.search}%`)
      }

      // Pagination
      const currentOffset = reset ? 0 : offset
      query = query.range(currentOffset, currentOffset + LIMIT - 1)

      const { data, error } = await query

      if (error) throw error

      if (reset) {
        setActivities(data || [])
      } else {
        setActivities(prev => [...prev, ...(data || [])])
      }

      setHasMore((data?.length || 0) === LIMIT)
      setOffset(currentOffset + (data?.length || 0))

    } catch (error) {
      console.error('Error loading activities:', error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  function exportToCSV() {
    const headers = ['Date', 'Time', 'Category', 'Action', 'Description', 'Project', 'Subcontractor', 'Importance']
    const rows = activities.map(a => [
      format(new Date(a.created_at), 'yyyy-MM-dd'),
      format(new Date(a.created_at), 'HH:mm:ss'),
      a.action_category,
      a.action,
      a.description.replace(/"/g, '""'),
      a.project?.name || '',
      a.subcontractor?.company_name || '',
      a.importance
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `activity_log_${format(new Date(), 'yyyy-MM-dd')}.csv`
    link.click()
  }

  function getActionIcon(category) {
    const Icon = CATEGORY_ICONS[category] || Activity
    return Icon
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="text-gray-600 mt-3">Loading activity...</p>
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
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Activity className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Activity Log</h2>
              <p className="text-sm text-gray-500">
                {activities.length} activities
                {projectId && ' for this project'}
                {subcontractorId && ' for this subcontractor'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportToCSV}
              className="btn btn-secondary btn-sm flex items-center gap-1"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              onClick={() => loadActivities(true)}
              className="btn btn-secondary btn-sm flex items-center gap-1"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-200 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search activities..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="input pl-10"
              />
            </div>
            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              className="input w-full sm:w-40"
            >
              <option value="all">All Categories</option>
              <option value="project">Projects</option>
              <option value="bid">Bids</option>
              <option value="subcontractor">Subcontractors</option>
              <option value="communication">Communications</option>
              <option value="rfi">RFIs</option>
              <option value="addendum">Addenda</option>
              <option value="drawing">Drawings</option>
            </select>
            <select
              value={filters.dateRange}
              onChange={(e) => setFilters({ ...filters, dateRange: e.target.value })}
              className="input w-full sm:w-36"
            >
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
            </select>
            <select
              value={filters.importance}
              onChange={(e) => setFilters({ ...filters, importance: e.target.value })}
              className="input w-full sm:w-32"
            >
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        {/* Activity List */}
        <div className="flex-1 overflow-y-auto">
          {activities.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {activities.map((activity) => {
                const Icon = getActionIcon(activity.action_category)
                const isExpanded = expandedActivity === activity.id

                return (
                  <div
                    key={activity.id}
                    className={`border-l-4 ${IMPORTANCE_COLORS[activity.importance]} bg-white`}
                  >
                    <div
                      className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setExpandedActivity(isExpanded ? null : activity.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${CATEGORY_COLORS[activity.action_category]}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-900">{activity.description}</p>
                          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDistanceToNow(new Date(activity.created_at))} ago
                            </span>
                            {activity.project?.name && (
                              <span className="flex items-center gap-1">
                                <FolderKanban className="h-3 w-3" />
                                {activity.project.name}
                              </span>
                            )}
                            {activity.subcontractor?.company_name && (
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {activity.subcontractor.company_name}
                              </span>
                            )}
                            <span className={`badge text-xs ${CATEGORY_COLORS[activity.action_category]}`}>
                              {activity.action_category}
                            </span>
                            {activity.importance !== 'normal' && (
                              <span className={`badge text-xs ${
                                activity.importance === 'critical' ? 'bg-red-100 text-red-700' :
                                activity.importance === 'high' ? 'bg-orange-100 text-orange-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {activity.importance}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center">
                          {isExpanded ? (
                            <ChevronUp className="h-5 w-5 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-gray-400" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100">
                        <div className="pl-11 pt-3 space-y-3">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-gray-500">Action:</span>
                              <span className="ml-2 text-gray-900 font-mono text-xs">
                                {activity.action}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500">Timestamp:</span>
                              <span className="ml-2 text-gray-900">
                                {format(new Date(activity.created_at), 'PPpp')}
                              </span>
                            </div>
                            {activity.performed_by && (
                              <div>
                                <span className="text-gray-500">Performed by:</span>
                                <span className="ml-2 text-gray-900">{activity.performed_by}</span>
                              </div>
                            )}
                            {activity.entity_type && (
                              <div>
                                <span className="text-gray-500">Entity:</span>
                                <span className="ml-2 text-gray-900">
                                  {activity.entity_type} ({activity.entity_id?.substring(0, 8)}...)
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Show changes if available */}
                          {(activity.old_values || activity.new_values) && (
                            <div className="border-t border-gray-200 pt-3">
                              <p className="text-sm font-medium text-gray-700 mb-2">Changes:</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                {activity.old_values && (
                                  <div className="bg-red-50 rounded p-2">
                                    <p className="font-medium text-red-700 mb-1">Before:</p>
                                    <pre className="text-red-600 overflow-auto">
                                      {JSON.stringify(activity.old_values, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {activity.new_values && (
                                  <div className="bg-green-50 rounded p-2">
                                    <p className="font-medium text-green-700 mb-1">After:</p>
                                    <pre className="text-green-600 overflow-auto">
                                      {JSON.stringify(activity.new_values, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Activity className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>No activities found</p>
              <p className="text-sm">Try adjusting your filters</p>
            </div>
          )}

          {/* Load More */}
          {hasMore && activities.length > 0 && (
            <div className="p-4 text-center">
              <button
                onClick={() => loadActivities(false)}
                disabled={loadingMore}
                className="btn btn-secondary"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                    Loading...
                  </span>
                ) : (
                  'Load More'
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

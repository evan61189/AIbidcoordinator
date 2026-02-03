import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  FolderKanban,
  Users,
  Clock,
  CheckCircle2,
  Plus,
  ArrowRight,
  Zap,
  Mail,
  AlertCircle,
  AlertTriangle,
  Bell,
  Calendar,
  TrendingUp,
  Send,
  Eye,
  FileText,
  RefreshCw,
  DollarSign,
  Timer
} from 'lucide-react'
import { supabase, getDashboardStats, fetchProjects } from '../lib/supabase'
import { format, isPast, isToday, isTomorrow, addDays, differenceInDays, differenceInHours, formatDistanceToNow } from 'date-fns'
import ReminderSettings from '../components/ReminderSettings'
import { Settings } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState({
    activeProjects: 0,
    totalSubcontractors: 0,
    pendingBids: 0,
    submittedBids: 0
  })
  const [recentProjects, setRecentProjects] = useState([])
  const [bidsDueSoon, setBidsDueSoon] = useState([])
  const [nonResponders, setNonResponders] = useState([])
  const [pendingReviews, setPendingReviews] = useState([])
  const [recentActivity, setRecentActivity] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [sendingReminder, setSendingReminder] = useState(null)
  const [showReminderSettings, setShowReminderSettings] = useState(false)

  useEffect(() => {
    loadDashboardData()
  }, [])

  async function loadDashboardData() {
    try {
      const [dashStats, projects] = await Promise.all([
        getDashboardStats(),
        fetchProjects()
      ])

      setStats(dashStats)
      setRecentProjects(projects?.slice(0, 5) || [])

      // Fetch bids due within the next 7 days
      const nextWeek = addDays(new Date(), 7)
      const { data: upcomingBids } = await supabase
        .from('bid_items')
        .select(`
          *,
          project:projects (id, name, project_number),
          trade:trades (name, division_code)
        `)
        .lte('bid_due_date', nextWeek.toISOString())
        .gte('bid_due_date', new Date().toISOString())
        .eq('status', 'open')
        .order('bid_due_date')
        .limit(10)

      setBidsDueSoon(upcomingBids || [])

      // Fetch non-responders (invited more than 3 days ago, no response)
      const threeDaysAgo = addDays(new Date(), -3)
      const { data: pendingInvites } = await supabase
        .from('bids')
        .select(`
          *,
          subcontractor:subcontractors (id, company_name, email, phone),
          bid_item:bid_items (
            id, description, bid_due_date,
            project:projects (id, name)
          )
        `)
        .eq('status', 'invited')
        .lt('invitation_sent_at', threeDaysAgo.toISOString())
        .order('invitation_sent_at')
        .limit(10)

      setNonResponders(pendingInvites || [])

      // Fetch pending bid reviews (submitted but not reviewed)
      const { data: pendingBidReviews } = await supabase
        .from('bids')
        .select(`
          *,
          subcontractor:subcontractors (id, company_name),
          bid_item:bid_items (
            id, description,
            project:projects (id, name),
            trade:trades (name)
          )
        `)
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: false })
        .limit(8)

      setPendingReviews(pendingBidReviews || [])

      // Fetch recent activity (communications and bid updates)
      const { data: recentComms } = await supabase
        .from('communications')
        .select(`
          *,
          subcontractor:subcontractors (company_name),
          project:projects (name)
        `)
        .order('created_at', { ascending: false })
        .limit(10)

      // Format activity items
      const activityItems = (recentComms || []).map(comm => ({
        id: comm.id,
        type: comm.type,
        description: `${comm.type === 'email_sent' ? 'Email sent to' : comm.type === 'email_received' ? 'Email received from' : 'Note added for'} ${comm.subcontractor?.company_name || 'Unknown'}`,
        project: comm.project?.name,
        timestamp: comm.created_at
      }))

      setRecentActivity(activityItems)

      // Build alerts
      const newAlerts = []

      // Overdue bids
      const { data: overdueBids } = await supabase
        .from('bid_items')
        .select('id')
        .lt('bid_due_date', new Date().toISOString())
        .eq('status', 'open')

      if (overdueBids?.length > 0) {
        newAlerts.push({
          type: 'error',
          message: `${overdueBids.length} bid item(s) are past due`,
          link: '/bids?filter=overdue'
        })
      }

      // Bids due today
      const bidsToday = upcomingBids?.filter(b => isToday(new Date(b.bid_due_date))) || []
      if (bidsToday.length > 0) {
        newAlerts.push({
          type: 'warning',
          message: `${bidsToday.length} bid(s) due TODAY`,
          link: '/bids?filter=due-today'
        })
      }

      // Non-responders needing follow-up
      if ((pendingInvites?.length || 0) > 5) {
        newAlerts.push({
          type: 'info',
          message: `${pendingInvites.length} subcontractors haven't responded in 3+ days`,
          link: '#non-responders'
        })
      }

      // Unreviewed bids
      if ((pendingBidReviews?.length || 0) > 5) {
        newAlerts.push({
          type: 'info',
          message: `${pendingBidReviews.length} submitted bids waiting for review`,
          link: '#pending-reviews'
        })
      }

      setAlerts(newAlerts)

    } catch (error) {
      console.error('Error loading dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  async function sendFollowUpReminder(bid) {
    if (!bid.subcontractor?.email) {
      alert('No email address for this subcontractor')
      return
    }

    setSendingReminder(bid.id)

    try {
      const response = await fetch('/.netlify/functions/send-bid-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_email: bid.subcontractor.email,
          to_name: bid.subcontractor.company_name,
          subject: `Reminder: Bid Request for ${bid.bid_item?.project?.name || 'Project'}`,
          project_name: bid.bid_item?.project?.name || 'Project',
          bid_due_date: bid.bid_item?.bid_due_date ? format(new Date(bid.bid_item.bid_due_date), 'MMMM d, yyyy') : 'ASAP',
          custom_message: 'This is a friendly reminder about our bid request. We would appreciate receiving your proposal at your earliest convenience.',
          sender_company: 'Clipper Construction',
          project_id: bid.bid_item?.project?.id,
          subcontractor_id: bid.subcontractor.id
        })
      })

      if (response.ok) {
        // Log the follow-up
        await supabase.from('communications').insert({
          subcontractor_id: bid.subcontractor.id,
          project_id: bid.bid_item?.project?.id,
          type: 'email_sent',
          subject: `Follow-up reminder sent`,
          notes: 'Automated follow-up reminder from dashboard'
        })

        // Update bid with reminder timestamp
        await supabase
          .from('bids')
          .update({ last_reminder_at: new Date().toISOString() })
          .eq('id', bid.id)

        // Refresh non-responders list
        loadDashboardData()
      } else {
        throw new Error('Failed to send reminder')
      }
    } catch (error) {
      console.error('Error sending reminder:', error)
      alert('Failed to send reminder. Please try again.')
    } finally {
      setSendingReminder(null)
    }
  }

  function getDueLabel(dueDate) {
    const date = new Date(dueDate)
    if (isPast(date) && !isToday(date)) return { text: 'OVERDUE', class: 'bg-red-100 text-red-800' }
    if (isToday(date)) return { text: 'TODAY', class: 'bg-orange-100 text-orange-800' }
    if (isTomorrow(date)) return { text: 'Tomorrow', class: 'bg-yellow-100 text-yellow-800' }
    const days = differenceInDays(date, new Date())
    return { text: `${days} days`, class: 'bg-blue-100 text-blue-800' }
  }

  const statCards = [
    { label: 'Active Projects', value: stats.activeProjects, icon: FolderKanban, color: 'bg-blue-500', link: '/projects?status=bidding' },
    { label: 'Subcontractors', value: stats.totalSubcontractors, icon: Users, color: 'bg-purple-500', link: '/subcontractors' },
    { label: 'Pending Invitations', value: stats.pendingBids, icon: Clock, color: 'bg-yellow-500', link: '/bids?status=invited' },
    { label: 'Bids Received', value: stats.submittedBids, icon: CheckCircle2, color: 'bg-green-500', link: '/bids?status=submitted' },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Welcome to your bid coordination center</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadDashboardData}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <Link to="/projects/new" className="btn btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New Project
          </Link>
        </div>
      </div>

      {/* Alert Banners */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between p-3 rounded-lg ${
                alert.type === 'error' ? 'bg-red-50 border border-red-200' :
                alert.type === 'warning' ? 'bg-orange-50 border border-orange-200' :
                'bg-blue-50 border border-blue-200'
              }`}
            >
              <div className="flex items-center gap-3">
                {alert.type === 'error' ? (
                  <AlertCircle className="h-5 w-5 text-red-600" />
                ) : alert.type === 'warning' ? (
                  <AlertTriangle className="h-5 w-5 text-orange-600" />
                ) : (
                  <Bell className="h-5 w-5 text-blue-600" />
                )}
                <span className={`text-sm font-medium ${
                  alert.type === 'error' ? 'text-red-800' :
                  alert.type === 'warning' ? 'text-orange-800' :
                  'text-blue-800'
                }`}>
                  {alert.message}
                </span>
              </div>
              {alert.link && (
                <Link
                  to={alert.link}
                  className={`text-sm font-medium ${
                    alert.type === 'error' ? 'text-red-600 hover:text-red-800' :
                    alert.type === 'warning' ? 'text-orange-600 hover:text-orange-800' :
                    'text-blue-600 hover:text-blue-800'
                  }`}
                >
                  View →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Link key={stat.label} to={stat.link} className="card p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${stat.color}`}>
                <stat.icon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-sm text-gray-600">{stat.label}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Bids Due Soon */}
      {bidsDueSoon.length > 0 && (
        <div className="card" id="bids-due-soon">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-orange-50">
            <div className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-orange-600" />
              <h2 className="font-semibold text-gray-900">Bids Due This Week</h2>
              <span className="badge bg-orange-100 text-orange-800">{bidsDueSoon.length}</span>
            </div>
            <Link to="/bids" className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="divide-y divide-gray-100">
            {bidsDueSoon.map((item) => {
              const dueLabel = getDueLabel(item.bid_due_date)
              return (
                <Link
                  key={item.id}
                  to={`/projects/${item.project?.id}`}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{item.description}</p>
                    <p className="text-sm text-gray-500">
                      {item.project?.name} • {item.trade?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`badge ${dueLabel.class}`}>
                      {dueLabel.text}
                    </span>
                    <span className="text-sm text-gray-500">
                      {format(new Date(item.bid_due_date), 'MMM d')}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/bids/quick-entry" className="card p-5 hover:shadow-md transition-shadow group">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Zap className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900 group-hover:text-primary-600">Quick Bid Entry</h3>
              <p className="text-sm text-gray-500">Enter bids received by phone or fax</p>
            </div>
          </div>
        </Link>

        <Link to="/email-parser" className="card p-5 hover:shadow-md transition-shadow group">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Mail className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900 group-hover:text-primary-600">Parse Bid Email</h3>
              <p className="text-sm text-gray-500">AI-powered email bid extraction</p>
            </div>
          </div>
        </Link>

        <Link to="/subcontractors/new" className="card p-5 hover:shadow-md transition-shadow group">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Users className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900 group-hover:text-primary-600">Add Subcontractor</h3>
              <p className="text-sm text-gray-500">Add new subs to your database</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Non-Responders - Follow Up Needed */}
        <div className="card" id="non-responders">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-yellow-50">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-yellow-600" />
              <h2 className="font-semibold text-gray-900">Follow-Up Needed</h2>
              {nonResponders.length > 0 && (
                <span className="badge bg-yellow-100 text-yellow-800">{nonResponders.length}</span>
              )}
            </div>
            <button
              onClick={() => setShowReminderSettings(true)}
              className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
          </div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {nonResponders.length > 0 ? (
              nonResponders.map((bid) => (
                <div key={bid.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        {bid.subcontractor?.company_name || 'Unknown'}
                      </p>
                      <p className="text-sm text-gray-500 truncate">
                        {bid.bid_item?.description} • {bid.bid_item?.project?.name}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Invited {formatDistanceToNow(new Date(bid.invitation_sent_at))} ago
                      </p>
                    </div>
                    <button
                      onClick={() => sendFollowUpReminder(bid)}
                      disabled={sendingReminder === bid.id}
                      className="btn btn-secondary btn-sm flex items-center gap-1"
                    >
                      {sendingReminder === bid.id ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      Remind
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-gray-500">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-300" />
                <p>All caught up!</p>
                <p className="text-sm">No follow-ups needed right now</p>
              </div>
            )}
          </div>
        </div>

        {/* Pending Bid Reviews */}
        <div className="card" id="pending-reviews">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-purple-50">
            <div className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-purple-600" />
              <h2 className="font-semibold text-gray-900">Pending Reviews</h2>
              {pendingReviews.length > 0 && (
                <span className="badge bg-purple-100 text-purple-800">{pendingReviews.length}</span>
              )}
            </div>
            <Link to="/bids?status=submitted" className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {pendingReviews.length > 0 ? (
              pendingReviews.map((bid) => (
                <Link
                  key={bid.id}
                  to={`/projects/${bid.bid_item?.project?.id}`}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {bid.subcontractor?.company_name || 'Unknown'}
                    </p>
                    <p className="text-sm text-gray-500 truncate">
                      {bid.bid_item?.trade?.name} • {bid.bid_item?.project?.name}
                    </p>
                  </div>
                  <div className="text-right">
                    {bid.amount && (
                      <p className="font-semibold text-gray-900">
                        ${bid.amount.toLocaleString()}
                      </p>
                    )}
                    <p className="text-xs text-gray-400">
                      {bid.submitted_at ? formatDistanceToNow(new Date(bid.submitted_at)) + ' ago' : ''}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <div className="p-8 text-center text-gray-500">
                <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No bids pending review</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Projects */}
        <div className="card">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Projects</h2>
            <Link to="/projects" className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="divide-y divide-gray-100">
            {recentProjects.length > 0 ? (
              recentProjects.map((project) => (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-gray-900">{project.name}</p>
                    <p className="text-sm text-gray-500">
                      {project.project_number || 'No #'} • {project.location || 'No location'}
                    </p>
                  </div>
                  <span className={`badge ${
                    project.status === 'bidding' ? 'badge-primary' :
                    project.status === 'awarded' ? 'badge-success' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {project.status}
                  </span>
                </Link>
              ))
            ) : (
              <div className="p-8 text-center text-gray-500">
                <FolderKanban className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No projects yet</p>
                <Link to="/projects/new" className="text-primary-600 hover:underline text-sm">
                  Create your first project
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="card">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-gray-500" />
              <h2 className="font-semibold text-gray-900">Recent Activity</h2>
            </div>
          </div>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {recentActivity.length > 0 ? (
              recentActivity.map((activity) => (
                <div key={activity.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-1.5 rounded-full ${
                      activity.type === 'email_sent' ? 'bg-blue-100' :
                      activity.type === 'email_received' ? 'bg-green-100' :
                      'bg-gray-100'
                    }`}>
                      {activity.type === 'email_sent' ? (
                        <Send className="h-3 w-3 text-blue-600" />
                      ) : activity.type === 'email_received' ? (
                        <Mail className="h-3 w-3 text-green-600" />
                      ) : (
                        <FileText className="h-3 w-3 text-gray-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">{activity.description}</p>
                      {activity.project && (
                        <p className="text-xs text-gray-500">{activity.project}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDistanceToNow(new Date(activity.timestamp))} ago
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-gray-500">
                <TrendingUp className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No recent activity</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reminder Settings Modal */}
      {showReminderSettings && (
        <ReminderSettings onClose={() => setShowReminderSettings(false)} />
      )}
    </div>
  )
}

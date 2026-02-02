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
  AlertCircle
} from 'lucide-react'
import { getDashboardStats, fetchProjects, fetchBids } from '../lib/supabase'
import { format, isPast, isToday, addDays } from 'date-fns'

export default function Dashboard() {
  const [stats, setStats] = useState({
    activeProjects: 0,
    totalSubcontractors: 0,
    pendingBids: 0,
    submittedBids: 0
  })
  const [recentProjects, setRecentProjects] = useState([])
  const [pendingResponses, setPendingResponses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboardData()
  }, [])

  async function loadDashboardData() {
    try {
      const [dashStats, projects, bids] = await Promise.all([
        getDashboardStats(),
        fetchProjects(),
        fetchBids({ status: 'invited' })
      ])

      setStats(dashStats)
      setRecentProjects(projects?.slice(0, 5) || [])
      setPendingResponses(bids?.slice(0, 8) || [])
    } catch (error) {
      console.error('Error loading dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const statCards = [
    { label: 'Active Projects', value: stats.activeProjects, icon: FolderKanban, color: 'bg-blue-500' },
    { label: 'Subcontractors', value: stats.totalSubcontractors, icon: Users, color: 'bg-purple-500' },
    { label: 'Pending Invitations', value: stats.pendingBids, icon: Clock, color: 'bg-yellow-500' },
    { label: 'Bids Received', value: stats.submittedBids, icon: CheckCircle2, color: 'bg-green-500' },
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
        <Link to="/projects/new" className="btn btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New Project
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="card p-5">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${stat.color}`}>
                <stat.icon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-sm text-gray-600">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

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

        {/* Awaiting Response */}
        <div className="card">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Awaiting Response</h2>
            <Link to="/bids?status=invited" className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="divide-y divide-gray-100">
            {pendingResponses.length > 0 ? (
              pendingResponses.map((bid) => (
                <div key={bid.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">
                        {bid.subcontractor?.company_name || 'Unknown'}
                      </p>
                      <p className="text-sm text-gray-500 truncate max-w-xs">
                        {bid.bid_item?.description || 'No description'}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">
                      {bid.invitation_sent_at
                        ? format(new Date(bid.invitation_sent_at), 'MMM d')
                        : 'Not sent'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-gray-500">
                <Clock className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No pending invitations</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

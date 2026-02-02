import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, FolderKanban, Calendar, MapPin, DollarSign } from 'lucide-react'
import { fetchProjects } from '../lib/supabase'
import { format } from 'date-fns'

export default function Projects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    loadProjects()
  }, [statusFilter])

  async function loadProjects() {
    setLoading(true)
    try {
      const data = await fetchProjects(statusFilter)
      setProjects(data || [])
    } catch (error) {
      console.error('Error loading projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    project.project_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    project.location?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const statusColors = {
    bidding: 'badge-primary',
    awarded: 'badge-success',
    in_progress: 'bg-purple-100 text-purple-800',
    completed: 'bg-gray-100 text-gray-800',
    lost: 'badge-danger'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-600">Manage your construction projects and bids</p>
        </div>
        <Link to="/projects/new" className="btn btn-primary flex items-center gap-2 self-start">
          <Plus className="h-4 w-4" />
          New Project
        </Link>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search projects..."
              className="input pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            className="input w-full sm:w-48"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="bidding">Bidding</option>
            <option value="awarded">Awarded</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="lost">Lost</option>
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : filteredProjects.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="card p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 bg-primary-100 rounded-lg">
                  <FolderKanban className="h-5 w-5 text-primary-600" />
                </div>
                <span className={`badge ${statusColors[project.status] || 'bg-gray-100 text-gray-800'}`}>
                  {project.status.replace('_', ' ')}
                </span>
              </div>

              <h3 className="font-semibold text-gray-900 mb-1">{project.name}</h3>
              <p className="text-sm text-gray-500 mb-3">{project.project_number || 'No project number'}</p>

              <div className="space-y-2 text-sm">
                {project.location && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <MapPin className="h-4 w-4" />
                    <span className="truncate">{project.location}</span>
                  </div>
                )}
                {project.bid_date && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar className="h-4 w-4" />
                    <span>Bid: {format(new Date(project.bid_date), 'MMM d, yyyy')}</span>
                  </div>
                )}
                {project.estimated_value && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <DollarSign className="h-4 w-4" />
                    <span>${Number(project.estimated_value).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <FolderKanban className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No projects found</h3>
          <p className="text-gray-500 mb-4">
            {searchTerm ? 'Try adjusting your search terms' : 'Get started by creating your first project'}
          </p>
          {!searchTerm && (
            <Link to="/projects/new" className="btn btn-primary">
              Create Project
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

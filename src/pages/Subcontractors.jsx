import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Users, Star, Phone, Mail, MapPin, Upload, Trash2 } from 'lucide-react'
import { fetchSubcontractors, supabase } from '../lib/supabase'
import { BID_PACKAGE_TYPES, getPackageType } from '../lib/packageTypes'
import SubcontractorBulkUpload from '../components/SubcontractorBulkUpload'
import toast from 'react-hot-toast'

export default function Subcontractors() {
  const [subcontractors, setSubcontractors] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [packageTypeFilter, setPackageTypeFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [showBulkUpload, setShowBulkUpload] = useState(false)

  useEffect(() => {
    loadData()
  }, [showInactive])

  async function loadData() {
    setLoading(true)
    try {
      const subsData = await fetchSubcontractors(!showInactive)
      setSubcontractors(subsData || [])
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function deleteSubcontractor(e, subId, companyName) {
    e.preventDefault() // Prevent navigation
    e.stopPropagation()

    if (!window.confirm(`Are you sure you want to delete "${companyName}"? This cannot be undone.`)) {
      return
    }

    try {
      const { error } = await supabase
        .from('subcontractors')
        .delete()
        .eq('id', subId)

      if (error) throw error

      toast.success('Subcontractor deleted')
      loadData()
    } catch (error) {
      console.error('Error deleting subcontractor:', error)
      toast.error('Failed to delete subcontractor')
    }
  }

  const filteredSubs = subcontractors.filter(sub => {
    const matchesSearch =
      sub.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.contact_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.email?.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesPackageType = packageTypeFilter === 'all' ||
      sub.package_types?.includes(packageTypeFilter)

    return matchesSearch && matchesPackageType
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subcontractors</h1>
          <p className="text-gray-600">Manage your subcontractor database</p>
        </div>
        <div className="flex gap-2 self-start">
          <button
            onClick={() => setShowBulkUpload(true)}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Upload className="h-4 w-4" />
            Bulk Import
          </button>
          <Link to="/subcontractors/new" className="btn btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Subcontractor
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search subcontractors..."
              className="input pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            className="input w-full sm:w-56"
            value={packageTypeFilter}
            onChange={(e) => setPackageTypeFilter(e.target.value)}
          >
            <option value="all">All Package Types</option>
            {BID_PACKAGE_TYPES.map(pkgType => (
              <option key={pkgType.id} value={pkgType.id}>
                {pkgType.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show inactive
          </label>
        </div>
      </div>

      {/* Subcontractors List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : filteredSubs.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSubs.map((sub) => (
            <div key={sub.id} className="card p-5 hover:shadow-md transition-shadow relative">
              <Link to={`/subcontractors/${sub.id}`} className="block">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Users className="h-5 w-5 text-purple-600" />
                  </div>
                  <div className="flex items-center gap-2">
                    {sub.is_preferred && (
                      <span className="badge badge-success">Preferred</span>
                    )}
                    {sub.rating && (
                      <div className="flex items-center gap-1 text-yellow-500">
                        <Star className="h-4 w-4 fill-current" />
                        <span className="text-sm font-medium">{sub.rating}</span>
                      </div>
                    )}
                  </div>
                </div>

                <h3 className="font-semibold text-gray-900 mb-1">{sub.company_name}</h3>
                {sub.contact_name && (
                  <p className="text-sm text-gray-600 mb-3">{sub.contact_name}</p>
                )}

                <div className="space-y-1.5 text-sm">
                  {sub.phone && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Phone className="h-4 w-4" />
                      <span>{sub.phone}</span>
                    </div>
                  )}
                  {sub.email && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Mail className="h-4 w-4" />
                      <span className="truncate">{sub.email}</span>
                    </div>
                  )}
                  {sub.city && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <MapPin className="h-4 w-4" />
                      <span>{sub.city}, {sub.state}</span>
                    </div>
                  )}
                </div>

                {sub.package_types?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {sub.package_types.slice(0, 3).map(typeId => {
                      const pkgType = getPackageType(typeId)
                      return pkgType ? (
                        <span key={typeId} className="badge bg-primary-100 text-primary-700 text-xs">
                          {pkgType.name}
                        </span>
                      ) : null
                    })}
                    {sub.package_types.length > 3 && (
                      <span className="badge bg-gray-100 text-gray-700 text-xs">
                        +{sub.package_types.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </Link>
              <button
                onClick={(e) => deleteSubcontractor(e, sub.id, sub.company_name)}
                className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                title="Delete subcontractor"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <Users className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No subcontractors found</h3>
          <p className="text-gray-500 mb-4">
            {searchTerm ? 'Try adjusting your search terms' : 'Start building your subcontractor database'}
          </p>
          {!searchTerm && (
            <Link to="/subcontractors/new" className="btn btn-primary">
              Add Subcontractor
            </Link>
          )}
        </div>
      )}

      {/* Bulk Upload Modal */}
      {showBulkUpload && (
        <SubcontractorBulkUpload
          onClose={() => setShowBulkUpload(false)}
          onSuccess={() => {
            setShowBulkUpload(false)
            loadData()
          }}
        />
      )}
    </div>
  )
}

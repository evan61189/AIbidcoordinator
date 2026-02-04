import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Edit, Phone, Mail, MapPin, Star, Calendar,
  DollarSign, FileText, MessageSquare, X, Save
} from 'lucide-react'
import { fetchSubcontractor, updateSubcontractor } from '../lib/supabase'
import { BID_PACKAGE_TYPES, getPackageType } from '../lib/packageTypes'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export default function SubcontractorDetail() {
  const { id } = useParams()
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedPackageTypes, setSelectedPackageTypes] = useState([])
  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip_code: '',
    license_number: '',
    insurance_expiry: '',
    bonding_capacity: '',
    notes: '',
    rating: '',
    is_preferred: false,
    is_active: true
  })

  useEffect(() => {
    loadSubcontractor()
  }, [id])

  async function loadSubcontractor() {
    try {
      const data = await fetchSubcontractor(id)
      setSub(data)
      // Pre-populate form with existing data
      if (data) {
        setForm({
          company_name: data.company_name || '',
          contact_name: data.contact_name || '',
          email: data.email || '',
          phone: data.phone || '',
          address: data.address || '',
          city: data.city || '',
          state: data.state || '',
          zip_code: data.zip_code || '',
          license_number: data.license_number || '',
          insurance_expiry: data.insurance_expiry ? data.insurance_expiry.split('T')[0] : '',
          bonding_capacity: data.bonding_capacity || '',
          notes: data.notes || '',
          rating: data.rating || '',
          is_preferred: data.is_preferred || false,
          is_active: data.is_active !== false
        })
        setSelectedPackageTypes(data.package_types || [])
      }
    } catch (error) {
      console.error('Error loading subcontractor:', error)
      toast.error('Failed to load subcontractor')
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  function togglePackageType(typeId) {
    setSelectedPackageTypes(prev =>
      prev.includes(typeId)
        ? prev.filter(id => id !== typeId)
        : [...prev, typeId]
    )
  }

  async function handleSave(e) {
    e.preventDefault()

    if (!form.company_name.trim()) {
      toast.error('Company name is required')
      return
    }

    setSaving(true)
    try {
      const subData = {
        ...form,
        bonding_capacity: form.bonding_capacity ? parseFloat(form.bonding_capacity) : null,
        rating: form.rating ? parseInt(form.rating) : null,
        insurance_expiry: form.insurance_expiry || null,
        package_types: selectedPackageTypes
      }

      await updateSubcontractor(id, subData)
      toast.success('Subcontractor updated successfully')
      setShowEditModal(false)
      loadSubcontractor() // Reload to get fresh data
    } catch (error) {
      console.error('Error updating subcontractor:', error)
      toast.error('Failed to update subcontractor')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!sub) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Subcontractor not found</h2>
        <Link to="/subcontractors" className="text-primary-600 hover:underline mt-2 inline-block">
          Back to subcontractors
        </Link>
      </div>
    )
  }

  const stats = {
    total_bids: sub.bids?.length || 0,
    accepted_bids: sub.bids?.filter(b => b.status === 'accepted').length || 0,
    pending: sub.bids?.filter(b => b.status === 'invited').length || 0
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            to="/subcontractors"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Subcontractors
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{sub.company_name}</h1>
            {sub.is_preferred && (
              <span className="badge badge-success">Preferred</span>
            )}
            {!sub.is_active && (
              <span className="badge bg-gray-100 text-gray-600">Inactive</span>
            )}
            {sub.rating && (
              <div className="flex items-center gap-1 text-yellow-500">
                <Star className="h-5 w-5 fill-current" />
                <span className="font-medium">{sub.rating}/5</span>
              </div>
            )}
          </div>
          {sub.contact_name && (
            <p className="text-gray-600">{sub.contact_name}</p>
          )}
        </div>
        <button
          onClick={() => setShowEditModal(true)}
          className="btn btn-outline flex items-center gap-2"
        >
          <Edit className="h-4 w-4" />
          Edit
        </button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{stats.total_bids}</p>
          <p className="text-sm text-gray-600">Total Bids</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{stats.accepted_bids}</p>
          <p className="text-sm text-gray-600">Awarded</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
          <p className="text-sm text-gray-600">Pending</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Contact Info */}
        <div className="card">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Contact Information</h2>
          </div>
          <div className="p-4 space-y-4">
            {sub.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-5 w-5 text-gray-400" />
                <a href={`tel:${sub.phone}`} className="text-primary-600 hover:underline">
                  {sub.phone}
                </a>
              </div>
            )}
            {sub.email && (
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-gray-400" />
                <a href={`mailto:${sub.email}`} className="text-primary-600 hover:underline">
                  {sub.email}
                </a>
              </div>
            )}
            {(sub.address || sub.city) && (
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
                <div>
                  {sub.address && <p>{sub.address}</p>}
                  {sub.city && <p>{sub.city}, {sub.state} {sub.zip_code}</p>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="card">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Details</h2>
          </div>
          <div className="p-4 space-y-3">
            {sub.license_number && (
              <div className="flex justify-between">
                <span className="text-gray-600">License #</span>
                <span className="font-medium">{sub.license_number}</span>
              </div>
            )}
            {sub.insurance_expiry && (
              <div className="flex justify-between">
                <span className="text-gray-600">Insurance Expiry</span>
                <span className="font-medium">
                  {format(new Date(sub.insurance_expiry), 'MMM d, yyyy')}
                </span>
              </div>
            )}
            {sub.bonding_capacity && (
              <div className="flex justify-between">
                <span className="text-gray-600">Bonding Capacity</span>
                <span className="font-medium">
                  ${Number(sub.bonding_capacity).toLocaleString()}
                </span>
              </div>
            )}
            {sub.package_types?.length > 0 && (
              <div>
                <span className="text-gray-600 block mb-2">Bid Package Types</span>
                <div className="flex flex-wrap gap-2">
                  {sub.package_types.map(typeId => {
                    const pkgType = getPackageType(typeId)
                    return pkgType ? (
                      <span key={typeId} className="badge bg-primary-100 text-primary-700">
                        {pkgType.name}
                      </span>
                    ) : null
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bid History */}
      <div className="card">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Bid History</h2>
        </div>
        {sub.bids?.length > 0 ? (
          <div className="table-container">
            <table className="table table-fixed w-full">
              <thead>
                <tr>
                  <th className="w-1/5">Project</th>
                  <th className="w-2/5">Description</th>
                  <th className="w-24">Amount</th>
                  <th className="w-24">Status</th>
                  <th className="w-24">Date</th>
                </tr>
              </thead>
              <tbody>
                {sub.bids.map(bid => (
                  <tr key={bid.id}>
                    <td>
                      <Link
                        to={`/projects/${bid.bid_item?.project?.id}`}
                        className="text-primary-600 hover:underline"
                      >
                        {bid.bid_item?.project?.name || 'Unknown'}
                      </Link>
                    </td>
                    <td className="overflow-hidden">
                      <div className="whitespace-pre-wrap break-words">{bid.bid_item?.description}</div>
                    </td>
                    <td className="font-medium">
                      {bid.amount ? `$${Number(bid.amount).toLocaleString()}` : '-'}
                    </td>
                    <td>
                      <span className={`badge ${
                        bid.status === 'accepted' ? 'badge-success' :
                        bid.status === 'submitted' ? 'badge-primary' :
                        bid.status === 'invited' ? 'badge-warning' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {bid.status}
                      </span>
                    </td>
                    <td className="text-gray-600">
                      {bid.submitted_at
                        ? format(new Date(bid.submitted_at), 'MMM d, yyyy')
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p>No bid history</p>
          </div>
        )}
      </div>

      {/* Notes */}
      {sub.notes && (
        <div className="card p-4">
          <h3 className="font-semibold text-gray-900 mb-2">Notes</h3>
          <p className="text-gray-600 whitespace-pre-wrap">{sub.notes}</p>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Edit Subcontractor</h2>
                <p className="text-gray-600">Update subcontractor information</p>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-6">
              {/* Company Info */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="label">Company Name *</label>
                  <input
                    type="text"
                    name="company_name"
                    className="input"
                    value={form.company_name}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div>
                  <label className="label">Contact Name</label>
                  <input
                    type="text"
                    name="contact_name"
                    className="input"
                    value={form.contact_name}
                    onChange={handleChange}
                  />
                </div>

                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    name="email"
                    className="input"
                    value={form.email}
                    onChange={handleChange}
                  />
                </div>

                <div>
                  <label className="label">Phone</label>
                  <input
                    type="tel"
                    name="phone"
                    className="input"
                    value={form.phone}
                    onChange={handleChange}
                  />
                </div>

                <div>
                  <label className="label">License Number</label>
                  <input
                    type="text"
                    name="license_number"
                    className="input"
                    value={form.license_number}
                    onChange={handleChange}
                  />
                </div>
              </div>

              {/* Address */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Address</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="label">Street Address</label>
                    <input
                      type="text"
                      name="address"
                      className="input"
                      value={form.address}
                      onChange={handleChange}
                    />
                  </div>

                  <div>
                    <label className="label">City</label>
                    <input
                      type="text"
                      name="city"
                      className="input"
                      value={form.city}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">State</label>
                      <input
                        type="text"
                        name="state"
                        className="input"
                        value={form.state}
                        onChange={handleChange}
                        maxLength={2}
                      />
                    </div>

                    <div>
                      <label className="label">ZIP Code</label>
                      <input
                        type="text"
                        name="zip_code"
                        className="input"
                        value={form.zip_code}
                        onChange={handleChange}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Bid Package Types */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Bid Package Types</h3>
                <p className="text-xs text-gray-500 mb-3">Select the types of work this subcontractor bids on</p>
                <div className="grid gap-2 grid-cols-1 md:grid-cols-2 max-h-64 overflow-y-auto border rounded-lg p-3">
                  {BID_PACKAGE_TYPES.map(pkgType => (
                    <label
                      key={pkgType.id}
                      className={`flex items-start gap-2 p-2 rounded cursor-pointer transition ${
                        selectedPackageTypes.includes(pkgType.id)
                          ? 'bg-primary-50 border border-primary-200'
                          : 'hover:bg-gray-50 border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPackageTypes.includes(pkgType.id)}
                        onChange={() => togglePackageType(pkgType.id)}
                        className="rounded border-gray-300 mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium">{pkgType.name}</span>
                        <p className="text-xs text-gray-500">{pkgType.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
                {selectedPackageTypes.length > 0 && (
                  <p className="text-xs text-gray-500 mt-2">
                    {selectedPackageTypes.length} package type(s) selected
                  </p>
                )}
              </div>

              {/* Additional Info */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Additional Information</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="label">Insurance Expiry</label>
                    <input
                      type="date"
                      name="insurance_expiry"
                      className="input"
                      value={form.insurance_expiry}
                      onChange={handleChange}
                    />
                  </div>

                  <div>
                    <label className="label">Bonding Capacity ($)</label>
                    <input
                      type="number"
                      name="bonding_capacity"
                      className="input"
                      value={form.bonding_capacity}
                      onChange={handleChange}
                      min="0"
                    />
                  </div>

                  <div>
                    <label className="label">Rating (1-5)</label>
                    <select
                      name="rating"
                      className="input"
                      value={form.rating}
                      onChange={handleChange}
                    >
                      <option value="">No rating</option>
                      <option value="1">1 - Poor</option>
                      <option value="2">2 - Fair</option>
                      <option value="3">3 - Good</option>
                      <option value="4">4 - Very Good</option>
                      <option value="5">5 - Excellent</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-6">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="is_preferred"
                      checked={form.is_preferred}
                      onChange={handleChange}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm font-medium text-gray-700">Preferred subcontractor</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="is_active"
                      checked={form.is_active}
                      onChange={handleChange}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm font-medium text-gray-700">Active</span>
                  </label>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="label">Notes</label>
                <textarea
                  name="notes"
                  className="input"
                  rows={3}
                  value={form.notes}
                  onChange={handleChange}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary flex items-center gap-2"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Save } from 'lucide-react'
import { createSubcontractor } from '../lib/supabase'
import { BID_PACKAGE_TYPES } from '../lib/packageTypes'
import toast from 'react-hot-toast'

export default function NewSubcontractor() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
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
    is_preferred: false
  })

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

  async function handleSubmit(e) {
    e.preventDefault()

    if (!form.company_name.trim()) {
      toast.error('Company name is required')
      return
    }

    setLoading(true)
    try {
      const subData = {
        ...form,
        bonding_capacity: form.bonding_capacity ? parseFloat(form.bonding_capacity) : null,
        rating: form.rating ? parseInt(form.rating) : null,
        insurance_expiry: form.insurance_expiry || null,
        package_types: selectedPackageTypes
      }

      const sub = await createSubcontractor(subData)
      toast.success('Subcontractor added successfully')
      navigate(`/subcontractors/${sub.id}`)
    } catch (error) {
      console.error('Error creating subcontractor:', error)
      toast.error('Failed to add subcontractor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        to="/subcontractors"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Subcontractors
      </Link>

      <div className="card">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">Add Subcontractor</h1>
          <p className="text-gray-600">Add a new subcontractor to your database</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
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
                placeholder="e.g., ABC Electric Inc."
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
                placeholder="e.g., John Smith"
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
                placeholder="john@abcelectric.com"
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
                placeholder="(555) 123-4567"
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

            <div className="mt-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_preferred"
                  checked={form.is_preferred}
                  onChange={handleChange}
                  className="rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">Mark as preferred subcontractor</span>
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
              placeholder="Any additional notes..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Link to="/subcontractors" className="btn btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              className="btn btn-primary flex items-center gap-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Adding...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Add Subcontractor
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

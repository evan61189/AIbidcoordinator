import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Edit, Phone, Mail, MapPin, Star, Calendar,
  DollarSign, FileText, MessageSquare
} from 'lucide-react'
import { fetchSubcontractor } from '../lib/supabase'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export default function SubcontractorDetail() {
  const { id } = useParams()
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSubcontractor()
  }, [id])

  async function loadSubcontractor() {
    try {
      const data = await fetchSubcontractor(id)
      setSub(data)
    } catch (error) {
      console.error('Error loading subcontractor:', error)
      toast.error('Failed to load subcontractor')
    } finally {
      setLoading(false)
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
        <button className="btn btn-outline flex items-center gap-2">
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
            {sub.trades?.length > 0 && (
              <div>
                <span className="text-gray-600 block mb-2">Trades</span>
                <div className="flex flex-wrap gap-2">
                  {sub.trades.map(({ trade }) => (
                    <span key={trade.id} className="badge bg-gray-100 text-gray-700">
                      {trade.division_code} - {trade.name}
                    </span>
                  ))}
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
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Date</th>
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
                    <td className="max-w-xs truncate">{bid.bid_item?.description}</td>
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
    </div>
  )
}

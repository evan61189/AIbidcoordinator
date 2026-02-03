import { useState, useEffect } from 'react'
import {
  TrendingUp,
  Award,
  Clock,
  CheckCircle2,
  AlertCircle,
  Star,
  Users,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Minus,
  ChevronDown,
  ChevronUp,
  X,
  Edit,
  Plus
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

const TIER_COLORS = {
  preferred: 'bg-green-100 text-green-700 border-green-300',
  standard: 'bg-blue-100 text-blue-700 border-blue-300',
  probation: 'bg-orange-100 text-orange-700 border-orange-300',
  inactive: 'bg-gray-100 text-gray-700 border-gray-300'
}

const RATING_LABELS = {
  1: 'Poor',
  2: 'Below Average',
  3: 'Average',
  4: 'Good',
  5: 'Excellent'
}

export default function SubcontractorPerformance({ subcontractorId, subcontractorName, onClose }) {
  const [performance, setPerformance] = useState(null)
  const [reviews, setReviews] = useState([])
  const [bidHistory, setBidHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [reviewForm, setReviewForm] = useState({
    pricing_competitiveness: 3,
    response_time: 3,
    bid_completeness: 3,
    communication: 3,
    overall_rating: 3,
    met_deadline: true,
    required_followup: false,
    bid_was_competitive: true,
    would_invite_again: true,
    strengths: '',
    areas_for_improvement: '',
    notes: ''
  })

  useEffect(() => {
    if (subcontractorId) {
      loadData()
    }
  }, [subcontractorId])

  async function loadData() {
    setLoading(true)
    try {
      // Load performance metrics
      const { data: perfData } = await supabase
        .from('subcontractor_performance')
        .select('*')
        .eq('subcontractor_id', subcontractorId)
        .single()

      setPerformance(perfData)

      // Load reviews
      const { data: reviewData } = await supabase
        .from('subcontractor_reviews')
        .select(`
          *,
          project:projects (name, project_number)
        `)
        .eq('subcontractor_id', subcontractorId)
        .order('review_date', { ascending: false })

      setReviews(reviewData || [])

      // Load bid history
      const { data: bidData } = await supabase
        .from('bids')
        .select(`
          *,
          bid_item:bid_items (
            description,
            project:projects (name, project_number)
          )
        `)
        .eq('subcontractor_id', subcontractorId)
        .order('created_at', { ascending: false })
        .limit(20)

      setBidHistory(bidData || [])

    } catch (error) {
      console.error('Error loading performance data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function recalculatePerformance() {
    try {
      await supabase.rpc('calculate_subcontractor_performance', {
        p_subcontractor_id: subcontractorId
      })
      loadData()
    } catch (error) {
      console.error('Error recalculating performance:', error)
    }
  }

  async function submitReview(e) {
    e.preventDefault()

    try {
      await supabase.from('subcontractor_reviews').insert({
        subcontractor_id: subcontractorId,
        ...reviewForm
      })

      setShowReviewForm(false)
      setReviewForm({
        pricing_competitiveness: 3,
        response_time: 3,
        bid_completeness: 3,
        communication: 3,
        overall_rating: 3,
        met_deadline: true,
        required_followup: false,
        bid_was_competitive: true,
        would_invite_again: true,
        strengths: '',
        areas_for_improvement: '',
        notes: ''
      })

      // Recalculate performance after new review
      await recalculatePerformance()
    } catch (error) {
      console.error('Error submitting review:', error)
      alert('Failed to submit review')
    }
  }

  function renderRatingStars(rating) {
    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(star => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= rating ? 'text-yellow-400 fill-current' : 'text-gray-300'
            }`}
          />
        ))}
      </div>
    )
  }

  function renderRatingInput(name, label) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setReviewForm({ ...reviewForm, [name]: value })}
              className={`p-2 rounded transition-colors ${
                reviewForm[name] >= value
                  ? 'text-yellow-400'
                  : 'text-gray-300 hover:text-yellow-300'
              }`}
            >
              <Star className={`h-6 w-6 ${reviewForm[name] >= value ? 'fill-current' : ''}`} />
            </button>
          ))}
          <span className="text-sm text-gray-500 ml-2">
            {RATING_LABELS[reviewForm[name]]}
          </span>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
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
            <div className="p-2 bg-purple-100 rounded-lg">
              <BarChart3 className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{subcontractorName}</h2>
              <p className="text-sm text-gray-500">Performance Analytics</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {['overview', 'history', 'reviews'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Key Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-blue-600">Response Rate</span>
                    <TrendingUp className="h-4 w-4 text-blue-500" />
                  </div>
                  <p className="text-2xl font-bold text-blue-700">
                    {performance?.response_rate || 0}%
                  </p>
                  <p className="text-xs text-blue-600">
                    {performance?.total_responses || 0} of {performance?.total_invitations || 0} invites
                  </p>
                </div>

                <div className="bg-green-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-green-600">Award Rate</span>
                    <Award className="h-4 w-4 text-green-500" />
                  </div>
                  <p className="text-2xl font-bold text-green-700">
                    {performance?.award_rate || 0}%
                  </p>
                  <p className="text-xs text-green-600">
                    {performance?.total_awarded || 0} projects awarded
                  </p>
                </div>

                <div className="bg-yellow-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-yellow-600">Overall Score</span>
                    <Star className="h-4 w-4 text-yellow-500" />
                  </div>
                  <p className="text-2xl font-bold text-yellow-700">
                    {performance?.overall_score?.toFixed(1) || '-'}
                  </p>
                  <p className="text-xs text-yellow-600">
                    Based on {reviews.length} reviews
                  </p>
                </div>

                <div className="bg-purple-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-purple-600">Recent Activity</span>
                    <Clock className="h-4 w-4 text-purple-500" />
                  </div>
                  <p className="text-2xl font-bold text-purple-700">
                    {performance?.responses_last_90_days || 0}
                  </p>
                  <p className="text-xs text-purple-600">
                    bids in last 90 days
                  </p>
                </div>
              </div>

              {/* Detailed Metrics */}
              {performance && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h4 className="font-medium text-gray-900 mb-3">Bid Quality</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Bid Completeness</span>
                        {renderRatingStars(Math.round(performance.avg_bid_completeness || 3))}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Communication</span>
                        {renderRatingStars(Math.round(performance.avg_communication_score || 3))}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Follow-up Required</span>
                        <span className={`text-sm font-medium ${
                          (performance.followup_required_rate || 0) > 50
                            ? 'text-orange-600'
                            : 'text-green-600'
                        }`}>
                          {performance.followup_required_rate || 0}% of bids
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-lg p-4">
                    <h4 className="font-medium text-gray-900 mb-3">Timeline</h4>
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Last Invitation</span>
                        <span className="text-gray-900">
                          {performance.last_invitation_date
                            ? format(new Date(performance.last_invitation_date), 'MMM d, yyyy')
                            : 'Never'
                          }
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Last Response</span>
                        <span className="text-gray-900">
                          {performance.last_response_date
                            ? format(new Date(performance.last_response_date), 'MMM d, yyyy')
                            : 'Never'
                          }
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Last Award</span>
                        <span className="text-gray-900">
                          {performance.last_award_date
                            ? format(new Date(performance.last_award_date), 'MMM d, yyyy')
                            : 'Never'
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Add Review Button */}
              <div className="flex justify-end">
                <button
                  onClick={() => setShowReviewForm(true)}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Review
                </button>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3">
              {bidHistory.length > 0 ? (
                bidHistory.map(bid => (
                  <div key={bid.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-900">
                          {bid.bid_item?.project?.name || 'Unknown Project'}
                        </p>
                        <p className="text-sm text-gray-500">
                          {bid.bid_item?.description || 'No description'}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`badge text-xs ${
                          bid.status === 'awarded' ? 'bg-green-100 text-green-700' :
                          bid.status === 'submitted' ? 'bg-blue-100 text-blue-700' :
                          bid.status === 'declined' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {bid.status}
                        </span>
                        {bid.amount && (
                          <p className="font-semibold text-gray-900 mt-1">
                            ${bid.amount.toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      {bid.invitation_sent_at && (
                        <span>Invited: {format(new Date(bid.invitation_sent_at), 'MMM d')}</span>
                      )}
                      {bid.submitted_at && (
                        <span>Submitted: {format(new Date(bid.submitted_at), 'MMM d')}</span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Clock className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>No bid history</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'reviews' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-medium text-gray-900">Performance Reviews</h4>
                <button
                  onClick={() => setShowReviewForm(true)}
                  className="btn btn-secondary btn-sm flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" />
                  Add Review
                </button>
              </div>

              {reviews.length > 0 ? (
                reviews.map(review => (
                  <div key={review.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-medium text-gray-900">
                          {review.project?.name || 'General Review'}
                        </p>
                        <p className="text-sm text-gray-500">
                          {format(new Date(review.review_date || review.created_at), 'MMM d, yyyy')}
                          {review.reviewer_name && ` by ${review.reviewer_name}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {renderRatingStars(review.overall_rating)}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                      <div>
                        <span className="text-gray-500">Pricing</span>
                        <div className="flex mt-1">{renderRatingStars(review.pricing_competitiveness)}</div>
                      </div>
                      <div>
                        <span className="text-gray-500">Response Time</span>
                        <div className="flex mt-1">{renderRatingStars(review.response_time)}</div>
                      </div>
                      <div>
                        <span className="text-gray-500">Completeness</span>
                        <div className="flex mt-1">{renderRatingStars(review.bid_completeness)}</div>
                      </div>
                      <div>
                        <span className="text-gray-500">Communication</span>
                        <div className="flex mt-1">{renderRatingStars(review.communication)}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-3">
                      {review.met_deadline && (
                        <span className="badge bg-green-100 text-green-700 text-xs">Met Deadline</span>
                      )}
                      {review.bid_was_competitive && (
                        <span className="badge bg-blue-100 text-blue-700 text-xs">Competitive Bid</span>
                      )}
                      {review.would_invite_again && (
                        <span className="badge bg-purple-100 text-purple-700 text-xs">Would Invite Again</span>
                      )}
                      {review.required_followup && (
                        <span className="badge bg-orange-100 text-orange-700 text-xs">Required Follow-up</span>
                      )}
                    </div>

                    {(review.strengths || review.areas_for_improvement || review.notes) && (
                      <div className="text-sm space-y-2 border-t border-gray-100 pt-3">
                        {review.strengths && (
                          <p><span className="text-gray-500">Strengths:</span> {review.strengths}</p>
                        )}
                        {review.areas_for_improvement && (
                          <p><span className="text-gray-500">Areas to Improve:</span> {review.areas_for_improvement}</p>
                        )}
                        {review.notes && (
                          <p><span className="text-gray-500">Notes:</span> {review.notes}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Star className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>No reviews yet</p>
                  <button
                    onClick={() => setShowReviewForm(true)}
                    className="mt-2 text-primary-600 hover:text-primary-700 text-sm"
                  >
                    Add the first review
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Review Form Modal */}
        {showReviewForm && (
          <div className="absolute inset-0 bg-white flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Add Performance Review</h3>
              <button onClick={() => setShowReviewForm(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={submitReview} className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Ratings */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {renderRatingInput('pricing_competitiveness', 'Pricing Competitiveness')}
                {renderRatingInput('response_time', 'Response Time')}
                {renderRatingInput('bid_completeness', 'Bid Completeness')}
                {renderRatingInput('communication', 'Communication')}
                {renderRatingInput('overall_rating', 'Overall Rating')}
              </div>

              {/* Checkboxes */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'met_deadline', label: 'Met Deadline' },
                  { key: 'required_followup', label: 'Required Follow-up' },
                  { key: 'bid_was_competitive', label: 'Bid Was Competitive' },
                  { key: 'would_invite_again', label: 'Would Invite Again' }
                ].map(option => (
                  <label key={option.key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={reviewForm[option.key]}
                      onChange={(e) => setReviewForm({ ...reviewForm, [option.key]: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">{option.label}</span>
                  </label>
                ))}
              </div>

              {/* Text fields */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Strengths</label>
                <textarea
                  value={reviewForm.strengths}
                  onChange={(e) => setReviewForm({ ...reviewForm, strengths: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="What did they do well?"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Areas for Improvement</label>
                <textarea
                  value={reviewForm.areas_for_improvement}
                  onChange={(e) => setReviewForm({ ...reviewForm, areas_for_improvement: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="What could be better?"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Additional Notes</label>
                <textarea
                  value={reviewForm.notes}
                  onChange={(e) => setReviewForm({ ...reviewForm, notes: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="Any other observations..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={() => setShowReviewForm(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Submit Review
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

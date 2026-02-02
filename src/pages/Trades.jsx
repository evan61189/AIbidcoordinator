import { useState, useEffect } from 'react'
import { Wrench, Users, FileText, Plus } from 'lucide-react'
import { fetchTrades } from '../lib/supabase'
import { supabase } from '../lib/supabase'

export default function Trades() {
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => {
    loadTrades()
  }, [])

  async function loadTrades() {
    try {
      const data = await fetchTrades()

      // Get subcontractor counts for each trade
      const tradesWithCounts = await Promise.all(
        (data || []).map(async (trade) => {
          const { count: subCount } = await supabase
            .from('subcontractor_trades')
            .select('*', { count: 'exact', head: true })
            .eq('trade_id', trade.id)

          const { count: itemCount } = await supabase
            .from('bid_items')
            .select('*', { count: 'exact', head: true })
            .eq('trade_id', trade.id)
            .eq('status', 'open')

          return {
            ...trade,
            subcontractor_count: subCount || 0,
            active_items: itemCount || 0
          }
        })
      )

      setTrades(tradesWithCounts)
    } catch (error) {
      console.error('Error loading trades:', error)
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trades & Divisions</h1>
          <p className="text-gray-600">CSI MasterFormat divisions for organizing work</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Custom Trade
        </button>
      </div>

      {/* Trades Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {trades.map(trade => (
          <div key={trade.id} className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Wrench className="h-5 w-5 text-gray-600" />
              </div>
              <span className="text-lg font-bold text-gray-400">
                {trade.division_code}
              </span>
            </div>

            <h3 className="font-semibold text-gray-900 mb-1">{trade.name}</h3>
            {trade.description && (
              <p className="text-sm text-gray-500 mb-4 line-clamp-2">{trade.description}</p>
            )}

            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-gray-600">
                <Users className="h-4 w-4" />
                <span>{trade.subcontractor_count} subs</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-600">
                <FileText className="h-4 w-4" />
                <span>{trade.active_items} active items</span>
              </div>
            </div>

            {trade.is_custom && (
              <span className="inline-block mt-3 badge bg-purple-100 text-purple-800">
                Custom
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Info Card */}
      <div className="card p-4 bg-blue-50 border-blue-200">
        <h3 className="font-semibold text-blue-900 mb-2">About CSI MasterFormat</h3>
        <p className="text-sm text-blue-800">
          The Construction Specifications Institute (CSI) MasterFormat is the standard for organizing
          construction specifications and other written information. The divisions shown above follow
          the latest MasterFormat structure to help you organize bids by trade.
        </p>
      </div>

      {/* Add Custom Trade Modal */}
      {showAddModal && (
        <AddTradeModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false)
            loadTrades()
          }}
        />
      )}
    </div>
  )
}

function AddTradeModal({ onClose, onSuccess }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    division_code: '',
    name: '',
    description: ''
  })

  async function handleSubmit(e) {
    e.preventDefault()

    if (!form.division_code || !form.name) {
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.from('trades').insert({
        ...form,
        is_custom: true
      })

      if (error) throw error
      onSuccess()
    } catch (error) {
      console.error('Error creating trade:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Add Custom Trade</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="label">Division Code *</label>
            <input
              type="text"
              className="input"
              value={form.division_code}
              onChange={(e) => setForm(prev => ({ ...prev, division_code: e.target.value }))}
              placeholder="e.g., 99"
              required
            />
          </div>

          <div>
            <label className="label">Trade Name *</label>
            <input
              type="text"
              className="input"
              value={form.name}
              onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Solar Panels"
              required
            />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Brief description..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Trade'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

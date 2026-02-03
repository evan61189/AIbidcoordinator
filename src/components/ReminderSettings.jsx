import { useState, useEffect } from 'react'
import {
  Bell,
  Clock,
  Mail,
  Save,
  RefreshCw,
  Send,
  Settings,
  Calendar,
  AlertCircle,
  CheckCircle2,
  X
} from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ReminderSettings({ onClose }) {
  const [settings, setSettings] = useState({
    first_reminder_days: 3,
    second_reminder_days: 5,
    final_reminder_days: 7,
    max_reminders: 3,
    auto_send_enabled: false,
    send_time: '09:00',
    timezone: 'America/Los_Angeles',
    send_days: [1, 2, 3, 4, 5],
    reminder_subject_template: 'Reminder: Bid Request for {{project_name}}',
    reminder_message_template: 'This is a friendly reminder about our bid request for {{project_name}}. We would appreciate receiving your proposal at your earliest convenience.',
    notify_on_send: true,
    notification_email: ''
  })

  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState(null)

  const weekdays = [
    { value: 0, label: 'Sun' },
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' }
  ]

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)
    try {
      // Load settings
      const { data: settingsData } = await supabase
        .from('reminder_settings')
        .select('*')
        .single()

      if (settingsData) {
        setSettings({
          ...settings,
          ...settingsData,
          send_time: settingsData.send_time?.substring(0, 5) || '09:00'
        })
      }

      // Load stats
      const { data: statsData } = await supabase
        .from('reminder_dashboard')
        .select('*')
        .single()

      setStats(statsData)

    } catch (error) {
      console.error('Error loading settings:', error)
    } finally {
      setLoading(false)
    }
  }

  async function saveSettings() {
    setSaving(true)
    setMessage(null)

    try {
      const { error } = await supabase
        .from('reminder_settings')
        .upsert({
          ...settings,
          send_time: settings.send_time + ':00',
          updated_at: new Date().toISOString()
        })

      if (error) throw error

      setMessage({ type: 'success', text: 'Settings saved successfully' })
    } catch (error) {
      console.error('Error saving settings:', error)
      setMessage({ type: 'error', text: 'Failed to save settings' })
    } finally {
      setSaving(false)
    }
  }

  async function processRemindersNow(dryRun = false) {
    setProcessing(true)
    setMessage(null)

    try {
      const response = await fetch('/.netlify/functions/process-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun })
      })

      const data = await response.json()

      if (response.ok) {
        const action = dryRun ? 'would be sent' : 'sent'
        setMessage({
          type: 'success',
          text: `${data.results?.sent || 0} reminder(s) ${action}, ${data.results?.failed || 0} failed, ${data.results?.skipped || 0} skipped`
        })
        loadSettings() // Refresh stats
      } else {
        throw new Error(data.error || 'Failed to process reminders')
      }
    } catch (error) {
      console.error('Error processing reminders:', error)
      setMessage({ type: 'error', text: error.message })
    } finally {
      setProcessing(false)
    }
  }

  function toggleDay(day) {
    const currentDays = settings.send_days || []
    if (currentDays.includes(day)) {
      setSettings({ ...settings, send_days: currentDays.filter(d => d !== day) })
    } else {
      setSettings({ ...settings, send_days: [...currentDays, day].sort() })
    }
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
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Bell className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Reminder Settings</h2>
              <p className="text-sm text-gray-500">Configure automated follow-up reminders</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Message */}
          {message && (
            <div className={`flex items-center gap-2 p-3 rounded-lg ${
              message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>
              {message.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <AlertCircle className="h-5 w-5" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-yellow-50 rounded-lg p-4">
                <p className="text-2xl font-bold text-yellow-700">{stats.total_pending || 0}</p>
                <p className="text-sm text-yellow-600">Awaiting Response</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-4">
                <p className="text-2xl font-bold text-orange-700">
                  {(stats.needs_first_reminder || 0) + (stats.needs_second_reminder || 0) + (stats.needs_final_reminder || 0)}
                </p>
                <p className="text-sm text-orange-600">Need Reminders</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-2xl font-bold text-blue-700">{stats.sent_today || 0}</p>
                <p className="text-sm text-blue-600">Sent Today</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-2xl font-bold text-green-700">{stats.sent_this_week || 0}</p>
                <p className="text-sm text-green-600">Sent This Week</p>
              </div>
            </div>
          )}

          {/* Reminder Timing */}
          <div className="space-y-4">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Reminder Timing
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  1st Reminder (days after invite)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.first_reminder_days}
                  onChange={(e) => setSettings({ ...settings, first_reminder_days: parseInt(e.target.value) })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  2nd Reminder (days after invite)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.second_reminder_days}
                  onChange={(e) => setSettings({ ...settings, second_reminder_days: parseInt(e.target.value) })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Final Reminder (days after invite)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.final_reminder_days}
                  onChange={(e) => setSettings({ ...settings, final_reminder_days: parseInt(e.target.value) })}
                  className="input"
                />
              </div>
            </div>
            <div className="w-full md:w-1/3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Maximum Reminders
              </label>
              <select
                value={settings.max_reminders}
                onChange={(e) => setSettings({ ...settings, max_reminders: parseInt(e.target.value) })}
                className="input"
              >
                <option value={1}>1 reminder</option>
                <option value={2}>2 reminders</option>
                <option value={3}>3 reminders</option>
                <option value={4}>4 reminders</option>
                <option value={5}>5 reminders</option>
              </select>
            </div>
          </div>

          {/* Auto-Send Settings */}
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-900 flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Automatic Sending
              </h3>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.auto_send_enabled}
                  onChange={(e) => setSettings({ ...settings, auto_send_enabled: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">Enable auto-send</span>
              </label>
            </div>

            {settings.auto_send_enabled && (
              <div className="bg-gray-50 rounded-lg p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Send Time
                    </label>
                    <input
                      type="time"
                      value={settings.send_time}
                      onChange={(e) => setSettings({ ...settings, send_time: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Timezone
                    </label>
                    <select
                      value={settings.timezone}
                      onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                      className="input"
                    >
                      <option value="America/Los_Angeles">Pacific Time</option>
                      <option value="America/Denver">Mountain Time</option>
                      <option value="America/Chicago">Central Time</option>
                      <option value="America/New_York">Eastern Time</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Send Days
                  </label>
                  <div className="flex gap-2">
                    {weekdays.map(day => (
                      <button
                        key={day.value}
                        onClick={() => toggleDay(day.value)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          (settings.send_days || []).includes(day.value)
                            ? 'bg-primary-600 text-white'
                            : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Email Templates */}
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email Template
            </h3>
            <p className="text-sm text-gray-500">
              Use {'{{project_name}}'}, {'{{bid_item}}'}, {'{{due_date}}'} as placeholders
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject Line
              </label>
              <input
                type="text"
                value={settings.reminder_subject_template}
                onChange={(e) => setSettings({ ...settings, reminder_subject_template: e.target.value })}
                className="input"
                placeholder="Reminder: Bid Request for {{project_name}}"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Message Body
              </label>
              <textarea
                value={settings.reminder_message_template}
                onChange={(e) => setSettings({ ...settings, reminder_message_template: e.target.value })}
                className="input min-h-[100px]"
                placeholder="This is a friendly reminder about our bid request..."
              />
            </div>
          </div>

          {/* Notifications */}
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </h3>
            <div className="flex items-start gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.notify_on_send}
                  onChange={(e) => setSettings({ ...settings, notify_on_send: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">Email me when reminders are sent</span>
              </label>
            </div>
            {settings.notify_on_send && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notification Email
                </label>
                <input
                  type="email"
                  value={settings.notification_email}
                  onChange={(e) => setSettings({ ...settings, notification_email: e.target.value })}
                  className="input"
                  placeholder="your@email.com"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex gap-2">
            <button
              onClick={() => processRemindersNow(true)}
              disabled={processing}
              className="btn btn-secondary flex items-center gap-2"
            >
              {processing ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Calendar className="h-4 w-4" />
              )}
              Preview
            </button>
            <button
              onClick={() => processRemindersNow(false)}
              disabled={processing}
              className="btn btn-secondary flex items-center gap-2"
            >
              {processing ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send Now
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button
              onClick={saveSettings}
              disabled={saving}
              className="btn btn-primary flex items-center gap-2"
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

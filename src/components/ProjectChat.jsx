import { useState, useRef, useEffect } from 'react'
import {
  MessageSquare, Send, X, Bot, User, AlertTriangle,
  Check, ChevronDown, ChevronUp, Loader2, ArrowRight,
  Minimize2, Maximize2
} from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * AI Chat Assistant for Project Pages
 * Allows asking questions and proposing changes with diff preview
 */
export default function ProjectChat({ projectId, projectName, onRefresh }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingChanges, setPendingChanges] = useState(null)
  const [showDiffModal, setShowDiffModal] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !isMinimized) {
      inputRef.current?.focus()
    }
  }, [isOpen, isMinimized])

  // Initial greeting
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: `Hi! I'm your AI assistant for **${projectName}**. I can help you:

• Answer questions about bids and pricing (e.g., "Who has the lowest electrical bid?")
• Compare subcontractors across packages
• Make changes to the estimate (with your approval)

What would you like to know?`
      }])
    }
  }, [isOpen, projectName])

  async function handleSend() {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      // Build conversation history for context
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }))

      const response = await fetch('/.netlify/functions/project-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          message: userMessage,
          conversation_history: conversationHistory
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response')
      }

      // Add assistant response
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        proposed_changes: data.proposed_changes
      }])

      // If there are proposed changes, show them for approval
      if (data.has_changes && data.proposed_changes?.length > 0) {
        setPendingChanges(data.proposed_changes)
        setShowDiffModal(true)
      }

    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}. Please try again.`,
        isError: true
      }])
    } finally {
      setLoading(false)
    }
  }

  async function handleApproveChanges() {
    if (!pendingChanges?.length) return

    setLoading(true)
    try {
      const response = await fetch('/.netlify/functions/apply-project-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          changes: pendingChanges
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to apply changes')
      }

      // Add confirmation message
      setMessages(prev => [...prev, {
        role: 'system',
        content: `✅ Changes applied successfully: ${data.message}`,
        isSuccess: true
      }])

      toast.success(data.message)
      setShowDiffModal(false)
      setPendingChanges(null)

      // Refresh the project data
      if (onRefresh) onRefresh()

    } catch (error) {
      console.error('Apply changes error:', error)
      toast.error(`Failed to apply changes: ${error.message}`)
      setMessages(prev => [...prev, {
        role: 'system',
        content: `❌ Failed to apply changes: ${error.message}`,
        isError: true
      }])
    } finally {
      setLoading(false)
    }
  }

  function handleRejectChanges() {
    setShowDiffModal(false)
    setPendingChanges(null)
    setMessages(prev => [...prev, {
      role: 'system',
      content: '↩️ Changes cancelled. No modifications were made.',
      isInfo: true
    }])
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Render chat bubble when closed
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 z-50"
        title="Open AI Assistant"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    )
  }

  return (
    <>
      {/* Chat Window */}
      <div className={`fixed bottom-6 right-6 bg-white rounded-lg shadow-2xl border border-gray-200 z-50 flex flex-col transition-all ${
        isMinimized ? 'w-72 h-14' : 'w-96 h-[500px]'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-indigo-600 text-white rounded-t-lg">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            <span className="font-medium">AI Assistant</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1 hover:bg-indigo-500 rounded"
            >
              {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-indigo-500 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!isMinimized && (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, idx) => (
                <MessageBubble key={idx} message={msg} />
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Thinking...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a question or request a change..."
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={loading}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Try: "Who has the lowest electrical bid?" or "Add 10% markup"
              </p>
            </div>
          </>
        )}
      </div>

      {/* Diff/Approval Modal */}
      {showDiffModal && pendingChanges && (
        <DiffModal
          changes={pendingChanges}
          onApprove={handleApproveChanges}
          onReject={handleRejectChanges}
          loading={loading}
        />
      )}
    </>
  )
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
        isUser
          ? 'bg-indigo-600 text-white'
          : isSystem
            ? message.isSuccess
              ? 'bg-green-100 text-green-800 border border-green-200'
              : message.isError
                ? 'bg-red-100 text-red-800 border border-red-200'
                : 'bg-blue-100 text-blue-800 border border-blue-200'
            : message.isError
              ? 'bg-red-50 text-red-800'
              : 'bg-gray-100 text-gray-800'
      }`}>
        {!isUser && !isSystem && (
          <div className="flex items-center gap-1 mb-1 text-xs text-gray-500">
            <Bot className="w-3 h-3" />
            Assistant
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap">
          <FormattedMessage content={message.content} />
        </div>
        {message.proposed_changes?.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <div className="text-xs text-indigo-600 font-medium">
              {message.proposed_changes.length} change(s) proposed - review above
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FormattedMessage({ content }) {
  // Simple markdown-like formatting
  const formatted = content
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-gray-200 px-1 rounded text-xs">$1</code>')
    .replace(/• /g, '• ')

  return <span dangerouslySetInnerHTML={{ __html: formatted }} />
}

function DiffModal({ changes, onApprove, onReject, loading }) {
  const [expandedIdx, setExpandedIdx] = useState(0)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
          <div>
            <h3 className="font-semibold text-gray-900">Review Proposed Changes</h3>
            <p className="text-sm text-gray-600">
              {changes.length} change(s) will be applied
            </p>
          </div>
        </div>

        {/* Changes List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {changes.map((change, idx) => (
            <div key={idx} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedIdx(expandedIdx === idx ? -1 : idx)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-sm font-medium">
                    {idx + 1}
                  </span>
                  <span className="font-medium text-gray-900">{change.description}</span>
                </div>
                {expandedIdx === idx ? (
                  <ChevronUp className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                )}
              </button>

              {expandedIdx === idx && (
                <div className="p-3 border-t bg-white">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 w-20 shrink-0">Target:</span>
                      <span className="font-medium">{change.target}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 w-20 shrink-0">Type:</span>
                      <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{change.type}</span>
                    </div>

                    {/* Diff View */}
                    <div className="mt-3 border rounded overflow-hidden">
                      <div className="bg-red-50 px-3 py-2 border-b border-red-100">
                        <div className="flex items-center gap-2 text-red-700 text-xs font-medium mb-1">
                          <span className="w-4 h-4 bg-red-200 rounded flex items-center justify-center">−</span>
                          Current
                        </div>
                        <div className="text-red-800 font-mono text-sm">
                          {change.current_value || '(none)'}
                        </div>
                      </div>
                      <div className="bg-green-50 px-3 py-2">
                        <div className="flex items-center gap-2 text-green-700 text-xs font-medium mb-1">
                          <span className="w-4 h-4 bg-green-200 rounded flex items-center justify-center">+</span>
                          New
                        </div>
                        <div className="text-green-800 font-mono text-sm">
                          {change.new_value || '(none)'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t bg-gray-50 flex items-center justify-between">
          <button
            onClick={onReject}
            disabled={loading}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onApprove}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg transition disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Approve & Apply
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { streamChat } from '../api'
import { useAutoScroll } from '../hooks'
import type { ChatMessage } from '../types'

const QUICK_PROMPTS = [
  '解释这份笔记的核心概念',
  '总结为5个要点',
  '找出不清晰的章节',
  '对结构提出改进建议',
  '提取所有定义和公式',
]

interface ChatHistory {
  conversation_id: string
  preview: string
  msg_count: number
  updated_at: number
}

interface Props {
  conversationId: string
  contextNote: string
}

export function ChatPanel({ conversationId, contextNote }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const [histories, setHistories] = useState<ChatHistory[]>([])
  const [historyFilter, setHistoryFilter] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const scrollRef = useAutoScroll(messages)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/chats')
      .then(r => r.json())
      .then(data => setHistories(Array.isArray(data) ? data : []))
      .catch(() => setHistories([]))
  }, [])

  useEffect(() => {
    setLoaded(false)
    setMessages([])
    fetch(`/api/chats/${encodeURIComponent(conversationId)}`)
      .then(r => r.json())
      .then(data => {
        setMessages(data.messages || [])
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [conversationId])

  function scheduleSave(msgs: ChatMessage[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, messages: msgs }),
      }).catch(() => {})
    }, 800)
  }

  async function send(text: string) {
    if (!text.trim() || streaming) return
    const userMsg: ChatMessage = { role: 'user', content: text }
    const newMsgs = [...messages, userMsg]
    setMessages(newMsgs)
    scheduleSave(newMsgs)
    setInput('')
    setStreaming(true)

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setMessages([...newMsgs, assistantMsg])

    try {
      await streamChat(newMsgs, contextNote, (delta) => {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + delta,
          }
          return updated
        })
      })
      setMessages(prev => {
        scheduleSave(prev)
        return prev
      })
    } finally {
      setStreaming(false)
    }
  }

  function clear() {
    setMessages([])
    fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, messages: [] }),
    }).catch(() => {})
  }

  const filteredHistories = histories.filter(h => {
    if (!historyFilter) return true
    const q = historyFilter.toLowerCase()
    return h.conversation_id.toLowerCase().includes(q)
  })

  function formatTime(ts: number) {
    const d = new Date(ts * 1000)
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="flex h-full border-l border-[var(--border)]">
      {/* History sidebar */}
      <div className={`${showHistory ? 'w-56' : 'w-0'} shrink-0 flex flex-col border-r border-[var(--border)] transition-all duration-200 overflow-hidden`}>
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border)] shrink-0">
          <span className="font-mono text-xs text-[var(--muted)]">history</span>
          <button
            onClick={() => setShowHistory(false)}
            className="font-mono text-xs text-[var(--muted)] hover:text-[var(--green)] transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="px-3 py-2 shrink-0">
          <input
            type="text"
            value={historyFilter}
            onChange={e => setHistoryFilter(e.target.value)}
            placeholder="filter…"
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 font-mono text-xs text-[var(--ink)] placeholder:text-[var(--faint)] focus:outline-none focus:border-[var(--green)]/50"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredHistories.length === 0 && (
            <p className="px-3 py-4 font-mono text-xs text-[var(--muted)] text-center">no history</p>
          )}
          {filteredHistories.map(h => {
            const parts = h.conversation_id.split('_')
            const label = parts.slice(parts.length > 2 ? 1 : 0).join('_')
            const isActive = h.conversation_id === conversationId
            return (
              <button
                key={h.conversation_id}
                className={`w-full text-left px-3 py-2.5 border-b border-[var(--border)]/50 transition-colors ${
                  isActive
                    ? 'bg-[var(--green-bg)] border-l-2 border-l-[var(--green)]'
                    : 'hover:bg-[var(--surface2)]'
                }`}
              >
                <p className={`font-mono text-xs truncate ${isActive ? 'text-[var(--green)]' : 'text-[var(--ink)]'}`}>
                  {label || h.conversation_id}
                </p>
                <p className="font-mono text-xs text-[var(--muted)] mt-0.5 truncate">
                  {h.preview || '(empty)'}
                </p>
                <p className="font-mono text-xs text-[var(--faint)] mt-1">
                  {h.msg_count}条 · {formatTime(h.updated_at)}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main chat panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(v => !v)}
              className="font-mono text-xs text-[var(--muted)] hover:text-[var(--green)] transition-colors mr-1"
              title="Toggle history"
            >
              ☰
            </button>
            <span className="text-[var(--moss)] font-mono text-sm">◈</span>
            <span className="font-mono text-xs text-[var(--muted)] tracking-wider">LLM ASSISTANT</span>
          </div>
          <button
            onClick={clear}
            className="font-mono text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            clear
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {!loaded && (
            <div className="py-6 text-center">
              <span className="font-mono text-xs text-[var(--muted)] animate-pulse">loading history<span className="cursor" /></span>
            </div>
          )}

          {loaded && messages.length === 0 && (
            <div className="py-6 text-center">
              <p className="font-mono text-xs text-[var(--muted)] mb-4">ask about the current note</p>
              <div className="space-y-2">
                {QUICK_PROMPTS.map(p => (
                  <button
                    key={p}
                    onClick={() => send(p)}
                    className="block w-full text-left px-3 py-2 font-mono text-xs rounded-lg border border-[var(--border)] text-[var(--muted)] hover:border-[var(--green)]/40 hover:text-[var(--green)] transition-all"
                  >
                    <span className="text-[var(--moss)] mr-2">›</span>{p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2.5 text-sm animate-fade-in ${
                m.role === 'user' ? 'chat-user ml-4' : 'chat-assist mr-4'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`font-mono text-xs ${m.role === 'user' ? 'text-[var(--green)]' : 'text-[var(--moss)]'}`}>
                  {m.role === 'user' ? '▸ you' : '◈ llm'}
                </span>
              </div>
              {m.role === 'user' ? (
                <p className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--ink)]">
                  {m.content}
                </p>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  className="markdown-body font-mono text-xs leading-relaxed"
                >
                  {m.content + (i === messages.length - 1 && streaming ? '█' : '')}
                </ReactMarkdown>
              )}
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="px-4 pb-4 pt-2 shrink-0 border-t border-[var(--border)]">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--moss)]">›</span>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send(input)}
                disabled={streaming}
                placeholder="ask anything…"
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg py-2 pl-7 pr-3 font-mono text-xs text-[var(--ink)] placeholder:text-[var(--faint)] focus:outline-none focus:border-[var(--green)]/50 disabled:opacity-50 transition-all"
              />
            </div>
            <button
              disabled={streaming || !input.trim()}
              onClick={() => send(input)}
              className="px-3 py-2 font-mono text-xs rounded-lg border border-[var(--green)]/30 text-[var(--green)] hover:bg-[var(--green-bg)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {streaming ? '⟳' : '⏎'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
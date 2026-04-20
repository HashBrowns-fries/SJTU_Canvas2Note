import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { streamChat } from '../api'
import { useAutoScroll } from '../hooks'
import type { ChatMessage } from '../types'

const QUICK_PROMPTS = [
  'Explain the key concepts in this note',
  'Summarize into 5 bullet points',
  'Identify any unclear sections',
  'Suggest improvements to the structure',
  'Extract all definitions and formulas',
]

interface Props {
  contextNote: string
}

export function ChatPanel({ contextNote }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useAutoScroll(messages)

  async function send(text: string) {
    if (!text.trim() || streaming) return
    const userMsg: ChatMessage = { role: 'user', content: text }
    const newMsgs = [...messages, userMsg]
    setMessages(newMsgs)
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
    } finally {
      setStreaming(false)
    }
  }

  function clear() {
    setMessages([])
  }

  return (
    <div className="flex flex-col h-full border-l border-[var(--border)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-amber font-mono text-sm">◈</span>
          <span className="font-mono text-xs text-[var(--text-muted)] tracking-wider">LLM ASSISTANT</span>
        </div>
        <button
          onClick={clear}
          className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          clear
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="py-6 text-center">
            <p className="font-mono text-xs text-[var(--text-muted)] mb-4">ask about the current note</p>
            <div className="space-y-2">
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="block w-full text-left px-3 py-2 font-mono text-xs rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-amber/40 hover:text-amber transition-all"
                >
                  <span className="text-amber mr-2">›</span>{p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded px-3 py-2.5 text-sm animate-fade-in ${
              m.role === 'user' ? 'chat-user ml-4' : 'chat-assist mr-4'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`font-mono text-xs ${m.role === 'user' ? 'text-amber' : 'text-sage'}`}>
                {m.role === 'user' ? '▸ you' : '◈ llm'}
              </span>
            </div>
            {m.role === 'user' ? (
              <p className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
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
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-[var(--text-muted)]">›</span>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send(input)}
              disabled={streaming}
              placeholder="ask anything…"
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded py-2 pl-7 pr-3 font-mono text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-amber/50 disabled:opacity-50"
            />
          </div>
          <button
            disabled={streaming || !input.trim()}
            onClick={() => send(input)}
            className="px-3 py-2 font-mono text-xs rounded border border-amber/30 text-amber hover:bg-amber/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {streaming ? '⟳' : '⏎'}
          </button>
        </div>
      </div>
    </div>
  )
}

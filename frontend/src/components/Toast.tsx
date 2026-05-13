import { useEffect, useState } from 'react'
import { Check, X, Info, Sparkles } from 'lucide-react'

export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error'
  action?: { label: string; onClick: () => void }
}

let _push: ((t: Omit<Toast, 'id'>) => void) | null = null

export function pushToast(t: Omit<Toast, 'id'>) {
  _push?.(t)
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    _push = (t) => {
      const id = Math.random().toString(36).slice(2)
      setToasts(prev => [...prev, { ...t, id }])
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 4000)
    }
    return () => { _push = null }
  }, [])

  const styles: Record<Toast['type'], { border: string; icon: React.ReactNode; color: string }> = {
    info:    { border: 'border-brand/30',     icon: <Info size={14} />,      color: 'text-brand' },
    success: { border: 'border-success/30',   icon: <Check size={14} />,     color: 'text-success' },
    error:   { border: 'border-error/30',     icon: <X size={14} />,         color: 'text-error' },
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => {
        const s = styles[t.type]
        return (
          <div
            key={t.id}
            className={`animate-slide-up border rounded-xl px-4 py-3 flex items-center gap-3 font-mono text-xs shadow-lg pointer-events-auto ${s.border}`}
            style={{ background: 'var(--paper)' }}
          >
            <span className={s.color}>{s.icon}</span>
            <span className="text-text flex-1">{t.message}</span>
            {t.action && (
              <button
                onClick={t.action.onClick}
                className="shrink-0 text-brand hover:text-brand-glow font-mono text-xs transition-colors"
              >
                {t.action.label}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

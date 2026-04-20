import { useEffect, useState } from 'react'

export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error'
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

  const colors: Record<Toast['type'], string> = {
    info:    'border-amber/40',
    success: 'border-sage/40',
    error:   'border-rust/40',
  }
  const icons = { info: '◈', success: '◆', error: '◉' }
  const text  = { info: 'text-amber', success: 'text-sage', error: 'text-rust' }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`animate-slide-up border rounded px-4 py-3 flex items-center gap-3 font-mono text-sm min-w-[280px] shadow-lg ${colors[t.type]}`}
          style={{ background: '#fffef8' }}
        >
          <span className={text[t.type]}>{icons[t.type]}</span>
          <span style={{ color: 'var(--text)' }}>{t.message}</span>
        </div>
      ))}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

type Size = 'sm' | 'md' | 'lg' | 'xl'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
  size?: Size
}

const sizeStyles: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('keydown', handle)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handle)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
    >
      <div
        className={`relative w-full ${sizeStyles[size]} mx-4 bg-surface border border-border rounded-xl shadow-modal max-h-[90vh] flex flex-col animate-slide-up`}
      >
        {title && (
          <div className="shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-mono text-sm font-semibold text-brand tracking-widest uppercase">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-muted hover:text-text hover:bg-surface2 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 px-6 py-4 border-t border-border flex items-center gap-3 justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

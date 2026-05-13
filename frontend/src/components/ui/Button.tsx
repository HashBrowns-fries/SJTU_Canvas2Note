import { type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon'
type Size = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variantStyles: Record<Variant, string> = {
  primary:   'border-brand/30 text-brand hover:bg-brand-bg',
  secondary: 'border-border text-muted hover:text-text hover:border-border2',
  ghost:     'border-transparent text-muted hover:text-text hover:bg-surface2',
  danger:    'border-error/30 text-error hover:bg-error-bg',
  icon:      'border-transparent text-muted hover:text-brand hover:bg-brand-bg rounded-lg',
}

const sizeStyles: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-1.5 text-xs',
  lg: 'px-5 py-2.5 text-sm',
}

export function Button({ variant = 'secondary', size = 'md', loading, children, className = '', disabled, ...rest }: Props) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 font-mono border rounded-lg transition-all
        ${variantStyles[variant]} ${sizeStyles[size]}
        ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={12} className="animate-spin" />}
      {children}
    </button>
  )
}

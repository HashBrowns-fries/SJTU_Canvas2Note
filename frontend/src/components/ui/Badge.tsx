type Variant = 'default' | 'success' | 'warning' | 'error' | 'muted'

interface Props {
  children: React.ReactNode
  variant?: Variant
  className?: string
}

const variantStyles: Record<Variant, string> = {
  default: 'bg-brand-bg text-brand border-brand/20',
  success: 'bg-success-bg text-success border-success/20',
  warning: 'bg-warning-bg text-warning border-warning/20',
  error:   'bg-error-bg text-error border-error/20',
  muted:   'bg-surface2 text-muted border-border',
}

export function Badge({ children, variant = 'default', className = '' }: Props) {
  return (
    <span className={`inline-flex items-center font-mono text-xs px-2 py-0.5 rounded border ${variantStyles[variant]} ${className}`}>
      {children}
    </span>
  )
}

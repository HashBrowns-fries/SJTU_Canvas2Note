import { type ButtonHTMLAttributes } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip?: string
  size?: 'sm' | 'md'
}

export function IconButton({ tooltip, size = 'sm', children, className = '', ...rest }: Props) {
  const sizeStyles = { sm: 'p-1.5', md: 'p-2' }

  return (
    <button
      title={tooltip}
      className={`rounded-lg text-muted hover:text-brand hover:bg-brand-bg transition-colors inline-flex items-center justify-center ${sizeStyles[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

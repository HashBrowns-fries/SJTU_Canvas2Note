interface Props {
  value: number
  size?: 'sm' | 'md'
  color?: string
  className?: string
}

export function Progress({ value, size = 'sm', color = 'var(--brand)', className = '' }: Props) {
  const pct = Math.min(100, Math.max(0, value))
  const heights = { sm: 'h-1', md: 'h-2' }

  return (
    <div className={`w-full bg-border rounded-full overflow-hidden ${heights[size]} ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ease-out ${heights[size]}`}
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  )
}

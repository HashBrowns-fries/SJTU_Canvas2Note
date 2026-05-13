interface Props {
  className?: string
  lines?: number
}

export function Skeleton({ className = '', lines = 1 }: Props) {
  if (lines > 1) {
    return (
      <div className={`space-y-3 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-4 bg-surface3 rounded animate-pulse"
            style={{ width: `${100 - i * 8}%`, opacity: 1 - i * 0.1 }}
          />
        ))}
      </div>
    )
  }

  return <div className={`bg-surface3 rounded animate-pulse ${className || 'h-4 w-full'}`} />
}

import { type LucideIcon, Search } from 'lucide-react'

interface Props {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon = Search, title, description, action, className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center h-full gap-3 text-center px-8 py-12 ${className}`}>
      <Icon size={40} className="text-faint/40" strokeWidth={1.5} />
      <p className="font-mono text-sm text-muted">{title}</p>
      {description && (
        <p className="font-mono text-xs text-faint max-w-xs">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

import { InboxIcon, AlertTriangleIcon, SearchXIcon } from 'lucide-react'
import { Button } from './ui/button'

export function EmptyState({ 
  icon: Icon = InboxIcon, 
  title = 'No data', 
  message, 
  action 
}: { 
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title?: string
  message?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="w-16 h-16 text-muted-foreground/50 mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      {message && <p className="text-sm text-muted-foreground mb-4 max-w-sm">{message}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ 
  error, 
  onRetry 
}: { 
  error?: Error | string
  onRetry?: () => void 
}) {
  const errorMessage = error instanceof Error ? error.message : error

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertTriangleIcon className="w-16 h-16 text-destructive/50 mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h3>
      {errorMessage && (
        <p className="text-sm text-muted-foreground mb-4 max-w-sm">{errorMessage}</p>
      )}
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm">
          Try again
        </Button>
      )}
    </div>
  )
}

export function NoResults({ 
  onClear 
}: { 
  onClear?: () => void 
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <SearchXIcon className="w-16 h-16 text-muted-foreground/50 mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">No results found</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm">
        Try adjusting your filters or search terms
      </p>
      {onClear && (
        <Button onClick={onClear} variant="outline" size="sm">
          Clear filters
        </Button>
      )}
    </div>
  )
}

export default { EmptyState, ErrorState, NoResults }

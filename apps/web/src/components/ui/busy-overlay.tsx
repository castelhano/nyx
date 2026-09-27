import { Icons } from '@/lib/icons'

// Blocks the page while a slow operation runs.
export function BusyOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="status" aria-live="polite">
      <div className="flex items-center gap-3 bg-card border border-border rounded-lg shadow-xl px-6 py-4">
        <Icons.Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  )
}

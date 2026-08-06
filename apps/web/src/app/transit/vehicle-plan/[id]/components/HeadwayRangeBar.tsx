import { Icons } from '@/lib/icons'

interface Props {
  count:      number
  singleLine: boolean
  onDistribute: () => void
}

export function HeadwayRangeBar({ count, singleLine, onDistribute }: Props) {
  return (
    <div
      style={{ animation: 'var(--animate-action-bar-in)' }}
      className="absolute bottom-6 inset-x-0 mx-auto w-fit z-20 flex items-center gap-3 px-4 py-2.5 bg-background border border-border rounded-xl shadow-lg"
    >
      <span className="text-sm font-medium text-foreground whitespace-nowrap select-none">
        [ {count} ] intervalo — mesmo sentido
      </span>

      <div className="w-px h-4 bg-border shrink-0" />

      <button
        onClick={onDistribute}
        disabled={!singleLine}
        title={singleLine ? undefined : 'Intervalo mistura mais de uma linha — distribua o headway com uma única linha'}
        className={[
          'flex items-center gap-1.5 h-8 rounded px-2.5 text-xs font-medium transition-colors',
          'bg-muted hover:bg-muted/70 text-foreground',
          !singleLine ? 'opacity-50 pointer-events-none' : '',
        ].join(' ')}
      >
        <Icons.AlignHorizontalDistributeCenter className="w-4 h-4 shrink-0" />
        <span>Distribuir</span>
      </button>
    </div>
  )
}

import type { RowHintEntry } from '../engine/gantt.types'

interface Rect {
  x:      number
  y:      number
  width:  number
  height: number
}

interface Props {
  rect:  Rect
  hints: RowHintEntry[]
}

export function BlockSelectionHint({ rect, hints }: Props) {
  if (hints.length === 0) return null

  return (
    <div
      className="absolute z-30 pointer-events-none flex flex-col items-end gap-1"
      style={{ top: rect.y + 4, left: rect.x + rect.width - 8, transform: 'translateX(-100%)' }}
    >
      {hints.map((hint, i) => (
        <span
          key={i}
          className="bg-blue-600 text-white text-[10px] font-medium px-1.5 py-0.5 rounded shadow-sm leading-none whitespace-nowrap"
        >
          <span className="font-mono">[ {hint.keys.join(' + ')} ]</span>: {hint.label}
        </span>
      ))}
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import type { LayoutRow } from '../engine/layout/layout.types'

interface Props {
  rows:    LayoutRow[]
  scrollY: number
  height:  number  // visible area height (matches canvas height)
}

export function RowList({ rows, scrollY, height }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = scrollY
  }, [scrollY])

  return (
    <div
      ref={ref}
      className="overflow-hidden select-none shrink-0"
      style={{ height, width: 112 }}
    >
      <div style={{ position: 'relative', height: rows.length > 0 ? rows[rows.length - 1].y + rows[rows.length - 1].height : 0 }}>
        {rows.map((row) => (
          <div
            key={row.id}
            className="absolute left-0 right-0 flex items-center px-3 text-sm text-muted-foreground border-b border-border/40 truncate"
            style={{ top: row.y, height: row.height }}
          >
            {row.label}
          </div>
        ))}
      </div>
    </div>
  )
}

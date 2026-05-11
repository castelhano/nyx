'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface BreadcrumbSegment {
  label: string
  href?:  string
  items?: { label: string; href: string }[]
}

function DropdownSegment({ label, href, items }: BreadcrumbSegment) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-0.5 hover:text-foreground transition-colors"
      >
        {href
          ? <Link href={href} onClick={(e) => e.stopPropagation()}>{label}</Link>
          : label
        }
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[160px] rounded border bg-popover shadow-md z-50 py-1">
          {items?.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block px-3 py-1.5 text-sm hover:bg-accent transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function Breadcrumb({ segments }: { segments: BreadcrumbSegment[] }) {
  return (
    <nav aria-label="breadcrumb" className='mb-6'>
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <ChevronRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
              )}
              {isLast ? (
                <span className="text-foreground font-medium">{seg.label}</span>
              ) : seg.items?.length ? (
                <DropdownSegment {...seg} />
              ) : seg.href ? (
                <Link href={seg.href} className="hover:text-foreground transition-colors">
                  {seg.label}
                </Link>
              ) : (
                <span>{seg.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

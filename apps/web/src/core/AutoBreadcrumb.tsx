'use client'

import { useMetadata } from './useMetadata'
import { Breadcrumb, type BreadcrumbSegment } from '@/components/ui/breadcrumb'
import { domains } from './domains'

interface DropdownItem {
  label: string
  href:  string
}

interface SegmentOverride {
  label?: string
  items?: DropdownItem[]
}

interface Props {
  domain:      string
  resource:    string
  id?:         string
  recordName?: string
  overrides?:  Record<string, SegmentOverride>
}

function toTitleCase(str: string) {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}

export function AutoBreadcrumb({ domain, resource, id, recordName, overrides = {} }: Props) {
  const { data: meta } = useMetadata(domain, resource)

  const domainLabel   = overrides[domain]?.label   ?? domains[domain]?.label ?? toTitleCase(domain)
  const resourceLabel = overrides[resource]?.label ?? meta?.labelPlural      ?? toTitleCase(resource)

  const segments: BreadcrumbSegment[] = [
    { label: 'Início', href: '/' },
    {
      label: domainLabel,
      href:  `/${domain}`,
      items: overrides[domain]?.items,
    },
    {
      label: resourceLabel,
      href:  `/${domain}/${resource}`,
      items: overrides[resource]?.items,
    },
  ]

  if (id) {
    const label = id === 'new' ? 'Novo' : (recordName ?? meta?.label ?? '…')
    segments.push({ label })
  }

  return <Breadcrumb segments={segments} />
}

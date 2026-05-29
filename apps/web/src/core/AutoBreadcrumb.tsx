'use client'

import { useQueries } from '@tanstack/react-query'
import { useMetadata } from './useMetadata'
import { useDiscovery } from './useDiscovery'
import { Breadcrumb, type BreadcrumbSegment } from '@/components/ui/breadcrumb'
import { apiFetch } from '@/lib/auth'

interface Props {
  domain:         string
  resource:       string
  id?:            string
  recordName?:    string
  contextParams?: Record<string, string>
}

function toTitleCase(str: string) {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}

export function AutoBreadcrumb({ domain, resource, id, recordName, contextParams = {} }: Props) {
  const { data: meta }    = useMetadata(domain, resource)
  const { data: domains } = useDiscovery()

  const breadcrumbDefs = meta?.breadcrumb ?? []

  // Busca o registro de cada pai declarado no breadcrumb
  const parentQueries = useQueries({
    queries: breadcrumbDefs.map((bc) => {
      const parentId    = contextParams[bc.contextField]
      const parentDomain = bc.domain ?? domain
      return {
        queryKey:  [parentDomain, bc.resource, parentId],
        queryFn:   async (): Promise<Record<string, unknown> | null> => {
          if (!parentId) return null
          const res = await apiFetch(`/${parentDomain}/${bc.resource}/${parentId}`)
          if (!res.ok) return null
          return res.json()
        },
        enabled:   !!parentId,
        staleTime: 60_000,
      }
    }),
  })

  const domainLabel   = domains.find((d) => d.key === domain)?.label ?? toTitleCase(domain)
  const resourceLabel = meta?.labelPlural       ?? toTitleCase(resource)

  const segments: BreadcrumbSegment[] = [
    { label: 'Início', href: '/' },
    { label: domainLabel, href: `/${domain}` },
  ]

  // Segmentos dos recursos pai (lista + registro)
  breadcrumbDefs.forEach((bc, i) => {
    const parentId     = contextParams[bc.contextField]
    const parentDomain = bc.domain ?? domain
    const parentRecord = parentQueries[i]?.data
    const nameField    = bc.nameField ?? 'name'
    const listLabel    = bc.listLabel ?? toTitleCase(bc.resource)

    segments.push({ label: listLabel, href: `/${parentDomain}/${bc.resource}` })

    if (parentId) {
      const rawName  = parentRecord ? String(parentRecord[nameField] ?? '…') : '…'
      const showFirst = bc.nameFirstWord !== false
      segments.push({
        label: showFirst ? rawName.split(' ')[0] : rawName,
        href:  `/${parentDomain}/${bc.resource}/${parentId}`,
      })
    }
  })

  segments.push({ label: resourceLabel, href: `/${domain}/${resource}` })

  if (id) {
    const rawLabel = id === 'new' ? 'Novo' : (recordName ?? meta?.label ?? '…')
    const label    = id === 'new' ? rawLabel : rawLabel.split(' ')[0]
    segments.push({ label })
  }

  return <Breadcrumb segments={segments} />
}

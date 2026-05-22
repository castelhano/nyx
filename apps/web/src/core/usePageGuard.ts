import type { ReactNode } from 'react'
import { createElement } from 'react'
import { useMetadata } from '@/core/useMetadata'
import { Forbidden } from '@/components/ui/forbidden'
import { NotFound } from '@/components/ui/not-found'
import type { ResourceMetadata } from '@nyx/types'

interface PageGuard {
  guardNode: ReactNode
  meta:      ResourceMetadata | undefined
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

export function usePageGuard(
  domain:       string,
  resource:     string,
  isNew         = false,
  recordError?: unknown,
): PageGuard {
  const { data: meta, error } = useMetadata(domain, resource)

  const isForbidden = (error as any)?.status === 403
    || (!!meta && !meta.permissions?.read)
    || (!!meta && isNew && !meta.permissions?.create)

  const guardNode = isForbidden
    ? createElement(Forbidden)
    : (!isForbidden && (error || recordError))
      ? createElement(NotFound)
      : null

  return {
    guardNode,
    meta,
    canCreate: meta?.permissions?.create !== false,
    canUpdate: meta?.permissions?.update !== false,
    canDelete: meta?.permissions?.delete === true,
  }
}

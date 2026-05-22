import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import { httpError, httpRetry } from '@/lib/query'

interface Options {
  enabled?:   boolean
  staleTime?: number
}

export function useRecordQuery<T = Record<string, unknown>>(
  queryKey: unknown[],
  url: string,
  options: Options = {},
) {
  return useQuery<T>({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch(url)
      if (!res.ok) throw httpError(res.status)
      return res.json() as T
    },
    retry: httpRetry,
    ...options,
  })
}

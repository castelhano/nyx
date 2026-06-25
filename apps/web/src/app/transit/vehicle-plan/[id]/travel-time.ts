import { apiFetch } from '@/lib/auth'

const cache = new Map<string, number | null>()

export async function getTravelTime(originId: string, destinationId: string): Promise<number | null> {
  const key = `${originId}:${destinationId}`
  if (cache.has(key)) return cache.get(key)!
  try {
    const r = await apiFetch(
      `/transit/travel-time-matrix?f_originId=${originId}&f_destinationId=${destinationId}&pageSize=1`,
    )
    if (!r.ok) { cache.set(key, null); return null }
    const j    = await r.json()
    const item = (j.data ?? [])[0]
    const min  = item != null ? Math.round(item.baseMinutes * item.speedRatio) : null
    cache.set(key, min)
    return min
  } catch {
    cache.set(key, null)
    return null
  }
}

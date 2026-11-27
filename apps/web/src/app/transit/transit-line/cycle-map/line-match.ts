// Matches the CSV's line codes to the system's lines. The GPS zero-pads codes ("031",
// "007") while the system may store them either way ("031" or "7"), so a code is first
// looked up as-is and then with leading zeros stripped on both sides.

const stripZeros = (code: string) => /^\d+$/.test(code) ? String(Number(code)) : code

export interface LineMatch<T> {
  matched:   Map<string, T>
  // CSV line code → best guess (null when nothing looks close)
  unmatched: Map<string, T | null>
}

export function matchLines<T extends { code: string }>(
  csvLines: string[],
  rawCodes: Map<string, string>,
  systemLines: T[],
): LineMatch<T> {
  const byCode       = new Map(systemLines.map(l => [l.code, l]))
  const byNormalized = new Map<string, T[]>()
  for (const l of systemLines) {
    const k = stripZeros(l.code)
    byNormalized.set(k, [...(byNormalized.get(k) ?? []), l])
  }

  const matched   = new Map<string, T>()
  const unmatched = new Map<string, T | null>()

  for (const csvCode of csvLines) {
    const raw   = rawCodes.get(csvCode) ?? csvCode
    const exact = byCode.get(raw) ?? byCode.get(csvCode)
    if (exact) { matched.set(csvCode, exact); continue }

    const same = byNormalized.get(stripZeros(raw)) ?? []
    if (same.length === 1) { matched.set(csvCode, same[0]); continue }

    unmatched.set(csvCode, same[0] ?? suggest(stripZeros(raw), systemLines))
  }

  return { matched, unmatched }
}

// a system line whose code starts with the CSV's (or the other way around), the closest
// in length — e.g. "31" → "31A"
function suggest<T extends { code: string }>(code: string, systemLines: T[]): T | null {
  const c = code.toUpperCase()
  let best: T | null = null
  for (const l of systemLines) {
    const s = stripZeros(l.code).toUpperCase()
    if (!s.startsWith(c) && !c.startsWith(s)) continue
    if (!best || Math.abs(s.length - c.length) < Math.abs(stripZeros(best.code).length - c.length)) best = l
  }
  return best
}

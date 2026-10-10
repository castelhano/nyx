// Minimum-cost assignment (Hungarian, potentials version) of n rows to m >= n columns.
// cost[i][j] may be any finite number; returns, per row, its column. O(n²·m).
export function hungarian(cost: number[][], m: number): number[] {
  const n = cost.length
  if (!n) return []
  if (m < n) throw new Error('hungarian: more rows than columns')
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1)
  const p = new Int32Array(m + 1), way = new Int32Array(m + 1)
  const minv = new Float64Array(m + 1)
  const used = new Uint8Array(m + 1)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    minv.fill(Infinity)
    used.fill(0)
    do {
      used[j0] = 1
      const i0 = p[j0], row = cost[i0 - 1]
      let delta = Infinity, j1 = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const cur = row[j - 1] - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }
  const out = new Array<number>(n).fill(-1)
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1
  return out
}

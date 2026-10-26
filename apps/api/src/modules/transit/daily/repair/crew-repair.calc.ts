import type { RepairItem, RepairOption, RepairStep } from '@nyx/schemas'
import { SCORE_SCALE } from '../../timetabling/vehicle-plan/scoring/plan-scoring.calc'
import { RosterModel, WARN, type MemberEval, type RgInput } from '../roster/roster-generator.calc'
import { hungarian } from '../roster/hungarian'

// "Cobrir tabelas" — pure. Day by day, in order (a day's moves count for the next one's rest), each
// target duty is solved changing as few crew members as it can, with the roster generator's rules
// and score (RosterModel over the period, everything else as it is):
//   1. FREE   — someone free on the day (nothing held, no day off); a minimum-cost matching of the
//               day's targets with the free crew
//   2. SWAP   — a free one can't take it but can take someone else's duty, who takes the target;
//      SWAP2  — only when no SWAP does: two holders move
//   3. options for the user (quadro insuficiente): cancel a folga compensada the generator gave
//      (the lowest hour bank first), or take someone off a plantão of the duty's shift, from the
//      time with the most plantões
// A target only with WARN-rule pendências (allowed with a pendência) is solved only by moves that
// add no pendência at all. Locked duties aren't in the input — they never move.

export interface CrewRepairTarget { di: number; reason: string; warnOnly: boolean }

export interface CrewRepairInput {
  rg: RgInput
  // per duty index: its holder now — member index, -1 nobody, -2 someone outside the input
  holder:   number[]
  holderId: (string | null)[]
  // "30010 Alexandre"
  holderLabel: (string | null)[]
  // "M12 · 05:10–13:40"
  dutyLabel: string[]
  targets:  CrewRepairTarget[]
  // per member, per day: holds a folga compensada given by a generation
  compOff:  boolean[][]
  // per member: hour bank balance in minutes (null: outside the bank)
  balance:  (number | null)[]
  published: boolean[]
}

const BLOCKED = 1e15
const NONE    = 1e12
const MAX_OPTIONS = 5

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const hm = (m: number) => `${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`

export function repairCrew(input: CrewRepairInput): RepairItem[] {
  const { rg } = input
  const model = new RosterModel(rg)
  const M = rg.members.length
  const rows = rg.members.map(m => Int32Array.from(m.current))
  const base: MemberEval[] = rg.members.map((_, mi) => model.evaluate(mi, rows[mi]))
  const holder = [...input.holder], holderId = [...input.holderId], holderLabel = [...input.holderLabel]
  const label = (mi: number) => `${rg.members[mi].code} ${rg.members[mi].name}`
  // members already moved on a day (or released from a target) — never moved again that day
  const moved = new Set<string>()
  const key = (mi: number, t: number) => `${mi}:${t}`

  // cost of `mi` holding `di` on its day instead of what he holds — null when he can't; strict:
  // no new pendência at all
  const costOf = (mi: number, di: number, strict: boolean): number | null => {
    const r = model.ruleOf(mi, di)
    if (r < 0 || (strict && r > 0)) return null
    const t = rg.duties[di].day
    const row = rows[mi].slice()
    row[t] = di
    const e = model.evaluate(mi, row), b = base[mi]
    if (e.hard || (strict && e.warns > b.warns)) return null
    return (b.score - e.score) * SCORE_SCALE / M + (e.warns - b.warns) * WARN + (e.pin - b.pin)
  }
  const warnNote = (mi: number, di: number) => (model.ruleOf(mi, di) > 0 ? ['fere uma regra (permitida com pendência)'] : [])
  const set = (mi: number, t: number, di: number) => {
    rows[mi][t] = di
    base[mi] = model.evaluate(mi, rows[mi])
    moved.add(key(mi, t))
  }
  const hold = (di: number, mi: number) => {
    holder[di] = mi
    holderId[di] = rg.members[mi].id
    holderLabel[di] = label(mi)
  }
  // the target loses its holder (he leaves the day's moves)
  const release = (di: number) => {
    const h = holder[di], t = rg.duties[di].day
    if (h >= 0) { rows[h][t] = -1; base[h] = model.evaluate(h, rows[h]); moved.add(key(h, t)) }
  }
  const freeOn = (t: number) => rg.members.flatMap((m, mi) =>
    m.status[t] === 'free' && rows[mi][t] < 0 && !input.compOff[mi][t] && !moved.has(key(mi, t)) ? [mi] : [])
  // holders on the day who may move: members, not moved yet, on a duty that isn't a target
  const targetSet = new Set(input.targets.map(x => x.di))
  const holdersOn = (t: number) => rg.duties.flatMap((d, di) =>
    d.day === t && !targetSet.has(di) && holder[di] >= 0 && !moved.has(key(holder[di], t)) ? [di] : [])

  const items: RepairItem[] = []
  const item = (x: CrewRepairTarget, current: string | null): RepairItem => {
    const t = rg.duties[x.di].day
    return {
      id: rg.duties[x.di].id, date: rg.days[t], label: input.dutyLabel[x.di], reason: x.reason, current,
      published: input.published[t], options: [], proposed: null, unsolved: null,
    }
  }
  const crew = (di: number, to: number | null): RepairStep =>
    ({ type: 'crew', dutyId: rg.duties[di].id, from: holderId[di], to: to == null ? null : rg.members[to].id })

  for (let t = 0; t < rg.days.length; t++) {
    const targets = input.targets.filter(x => rg.duties[x.di].day === t)
    if (!targets.length) continue
    const solved = new Map<number, RepairItem>()
    const current = new Map(targets.map(x => [x.di, holderLabel[x.di]]))

    // ── 1. free crew: a minimum-cost matching ──
    const free = freeOn(t)
    if (free.length) {
      const cols = free.length + targets.length
      const costs = targets.map(x => free.map(mi => costOf(mi, x.di, x.warnOnly)))
      const matrix = costs.map((line, r) => {
        const out = new Array<number>(cols).fill(BLOCKED)
        line.forEach((c, k) => { if (c != null) out[k] = c })
        out[free.length + r] = NONE
        return out
      })
      const chosen = hungarian(matrix, cols)
      const taken = new Set(chosen.filter(c => c >= 0 && c < free.length))
      targets.forEach((x, r) => {
        const c = chosen[r]
        if (c < 0 || c >= free.length || costs[r][c] == null) return
        const it = item(x, current.get(x.di) ?? null)
        // the proposed one, then the other free ones nobody else takes
        const alternatives = free.flatMap((mi, k) => (k === c || taken.has(k) || costs[r][k] == null ? [] : [{ mi, cost: costs[r][k] }]))
          .sort((a, b) => a.cost - b.cost).slice(0, MAX_OPTIONS - 1)
        for (const { mi } of [{ mi: free[c] }, ...alternatives]) {
          it.options.push({
            kind: 'FREE', text: label(mi), notes: warnNote(mi, x.di), steps: [crew(x.di, mi)],
            affected: [rg.members[mi].id, ...(holderId[x.di] ? [holderId[x.di]!] : [])],
          })
        }
        it.proposed = 0
        solved.set(x.di, it)
      })
      for (const [di, it] of solved) {
        const mi = rg.members.findIndex(m => m.id === (it.options[0].steps[0] as { to: string }).to)
        release(di)
        set(mi, t, di)
        hold(di, mi)
      }
    }

    // ── 2. swaps, then 3. the user's options ──
    for (const x of targets) {
      if (solved.has(x.di)) continue
      const it = item(x, current.get(x.di) ?? null)
      const T = x.di
      const strict = x.warnOnly
      const freeNow = freeOn(t)
      const others = holdersOn(t)
      const memo = new Map<string, number | null>()
      const cost = (mi: number, di: number) => {
        const k = `${mi}>${di}`
        if (!memo.has(k)) memo.set(k, costOf(mi, di, strict))
        return memo.get(k)!
      }

      // one move: h leaves D for the target, a free one takes D
      let best: { cost: number; steps: RepairStep[]; text: string; affected: string[]; set: [number, number][] } | null = null
      for (const D of others) {
        const h = holder[D]
        const ch = cost(h, T)
        if (ch == null) continue
        for (const f of freeNow) {
          const cf = cost(f, D)
          if (cf == null || (best && ch + cf >= best.cost)) continue
          best = {
            cost: ch + cf, steps: [crew(D, f), crew(T, h)],
            text: `${label(h)} (${input.dutyLabel[D]} → ${input.dutyLabel[T]}) · ${label(f)} na ${input.dutyLabel[D]}`,
            affected: [rg.members[h].id, rg.members[f].id, ...(holderId[T] ? [holderId[T]] : [])], set: [[h, T], [f, D]],
          }
        }
      }
      let kind: RepairOption['kind'] = 'SWAP'
      // two levels: f takes D1, its holder h1 takes D2, its holder h2 takes the target
      if (!best && freeNow.length) {
        kind = 'SWAP2'
        for (const D2 of others) {
          const h2 = holder[D2]
          const c2 = cost(h2, T)
          if (c2 == null) continue
          for (const D1 of others) {
            if (D1 === D2) continue
            const h1 = holder[D1]
            const c1 = cost(h1, D2)
            if (c1 == null || (best && c1 + c2 >= best.cost)) continue
            for (const f of freeNow) {
              const cf = cost(f, D1)
              if (cf == null || (best && c1 + c2 + cf >= best.cost)) continue
              best = {
                cost: c1 + c2 + cf, steps: [crew(D1, f), crew(D2, h1), crew(T, h2)],
                text: `${label(h2)} (${input.dutyLabel[D2]} → ${input.dutyLabel[T]}) · ${label(h1)} (${input.dutyLabel[D1]} → ${input.dutyLabel[D2]}) · ${label(f)} na ${input.dutyLabel[D1]}`,
                affected: [h2, h1, f].map(mi => rg.members[mi].id).concat(holderId[T] ? [holderId[T]] : []),
                set: [[h2, T], [h1, D2], [f, D1]],
              }
            }
          }
        }
      }
      if (best) {
        it.options.push({ kind, text: best.text, notes: [], steps: best.steps, affected: best.affected })
        it.proposed = 0
        release(T)
        for (const [mi, di] of best.set) { set(mi, t, di); hold(di, mi) }
        items.push(it)
        continue
      }

      // 3a. a folga compensada the generator gave — the lowest hour bank first
      const compOff = rg.members.flatMap((m, mi) => {
        if (!input.compOff[mi][t] || m.status[t] !== 'free' || rows[mi][t] >= 0 || moved.has(key(mi, t))) return []
        const c = cost(mi, T)
        return c == null ? [] : [{ mi, balance: input.balance[mi] }]
      }).sort((a, b) => (a.balance ?? Infinity) - (b.balance ?? Infinity)).slice(0, MAX_OPTIONS)
      for (const { mi, balance } of compOff) {
        it.options.push({
          kind: 'COMP_OFF', text: label(mi),
          notes: ['folga compensada cancelada — o dia volta a ser de trabalho', ...(balance != null ? [`saldo no banco ${balance < 0 ? '−' : ''}${hm(balance)}`] : []), ...warnNote(mi, T)],
          steps: [{ type: 'compOff', date: rg.days[t], crewMemberId: rg.members[mi].id }, crew(T, mi)],
          affected: [rg.members[mi].id, ...(holderId[T] ? [holderId[T]] : [])],
        })
      }

      // 3b. a plantão of the duty's shift, from the time with the most plantões
      const shift = rg.duties[T].shift
      const plantoes = rg.duties.flatMap((d, di) =>
        d.day === t && d.standby && (shift == null || d.shift === shift) && holder[di] >= 0 && !moved.has(key(holder[di], t)) ? [di] : [])
      const perTime = new Map<number, number>()
      for (const S of plantoes) perTime.set(rg.duties[S].start, (perTime.get(rg.duties[S].start) ?? 0) + 1)
      const standby = plantoes.flatMap(S => {
        const c = cost(holder[S], T)
        return c == null ? [] : [{ S, c, n: perTime.get(rg.duties[S].start)! }]
      }).sort((a, b) => b.n - a.n || a.c - b.c).slice(0, MAX_OPTIONS)
      for (const { S, n } of standby) {
        const h = holder[S]
        it.options.push({
          kind: 'STANDBY', text: `${label(h)} — plantão das ${clock(rg.duties[S].start)}`,
          notes: [`o plantão das ${clock(rg.duties[S].start)} fica sem operador (${n} no horário)`, ...warnNote(h, T)],
          steps: [crew(S, null), crew(T, h)],
          affected: [rg.members[h].id, ...(holderId[T] ? [holderId[T]] : [])],
        })
      }

      if (!it.options.length) {
        it.unsolved = !freeNow.length && !others.length ? 'nenhum operador disponível no dia'
          : !freeNow.length ? 'nenhum operador livre no dia, nem plantão ou folga compensada que possa cobrir'
          : 'os livres do dia não podem cobrir, nem por troca (horário, linha, veículo ou interjornada)'
      }
      items.push(it)
    }
    items.push(...solved.values())
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, 'pt-BR', { numeric: true }))
}

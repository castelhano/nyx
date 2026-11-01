'use client'

import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Controller, useWatch, type Control } from 'react-hook-form'
import { restGroupLabel, restGroupOffsets, restPatternWorks } from '@nyx/schemas'
import type { MetadataField } from '@nyx/types'
import { apiFetch } from '@/lib/auth'
import { useConfirm } from '@/lib/confirm-context'
import { useToast } from '@/lib/toast-context'
import { cn, extractError } from '@/lib/utils'
import { resolveIcon } from '@/lib/icons'
import { inputBaseCls } from '@/components/ui/input'
import { localToday } from '@/lib/plan-vigence'

// widget 'rest-cycle' — RestPattern.pattern as a calendar of Monday-to-Sunday weeks, day 0 on
// the anchor date's weekday (click a day: works ↔ day off), then a preview of the next weeks per group with the
// share of the crew working each day, and the crew per shift and group with "Equilibrar"
// (GET/POST /transit/rest-pattern/:id/groups|balance). Above it, the shifts with the pattern as their default.

const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
// grid columns, Monday first
const COLUMNS = [1, 2, 3, 4, 5, 6, 0]
const PREVIEW_DAYS = 28

const ShiftIcon = resolveIcon('Sunrise')

interface Groups {
  offsets: number[]
  total:   number
  shifts:  { shiftId: string | null; code: string; counts: number[]; outside: number }[]
  defaultOf: { id: string; code: string; name: string }[]
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay()

const OkIcon   = resolveIcon('CheckCircle')
const WarnIcon = resolveIcon('AlertTriangle')

const fmtNum = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace('.', ','))
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

interface Balance {
  // groups off per weekday (index = getUTCDay), averaged per week over the whole rotation
  groupsOff: number[]
  // share of the crew off per weekday — groups of equal size, and weighted by the saved counts
  shareOff:  number[]
  realOff:   number[] | null
  checks:    { ok: boolean; text: string }[]
}

// The structural balance of a cycle: depends only on the pattern, its groups and the anchor's
// weekday — counts (crew per group) add the weighted row. Holidays ignored.
function cycleBalance(pattern: string, offsets: number[], anchorWd: number, counts: number[] | null): Balance {
  const n = pattern.length
  // whole weeks of the rotation, so each weekday is seen equally often
  const period = (n * 7) / gcd(n, 7)
  const weeks = period / 7
  const total = counts?.reduce((a, b) => a + b, 0) ?? 0
  const groupsOff = Array(7).fill(0), realOff = Array(7).fill(0)
  for (let d = 0; d < period; d++) {
    const wd = (anchorWd + d) % 7
    offsets.forEach((o, g) => {
      if (pattern[(d + o) % n] !== 'F') return
      groupsOff[wd]++
      if (counts) realOff[wd] += counts[g]
    })
  }
  const avg = groupsOff.map(x => x / weeks)

  // the longest run of working days, wrapping into the next cycle
  let maxRun = 0, run = 0
  for (let i = 0; i < 2 * n; i++) {
    run = pattern[i % n] === 'T' ? run + 1 : 0
    maxRun = Math.max(maxRun, run)
  }

  const checks: Balance['checks'] = []
  const [sat, sun] = [avg[6], avg[0]]
  if (sat !== sun) {
    const odd = n % 7 === 0 && offsets.length > 1 && offsets[1] === 7 && (n / 7) % 2 === 1
    checks.push({ ok: false, text: `Sábado tem ${fmtNum(sat)} grupo(s) de folga e domingo ${fmtNum(sun)}${odd ? ` — um ciclo de ${n / 7} semanas (ímpar) não alterna sábado e domingo por igual` : ''}` })
  } else if (sat > 0) {
    checks.push({ ok: true, text: `Sábado e domingo com ${fmtNum(sat)} grupo(s) de folga cada` })
  }
  checks.push(maxRun > 6
    ? { ok: false, text: `Até ${maxRun} dias seguidos trabalhando` }
    : { ok: true,  text: `Máximo de ${maxRun} dia(s) seguido(s) trabalhando` })
  if (n % 7 === 0) {
    // per Monday-to-Sunday week, as the grid shows it
    const lead = (anchorWd + 6) % 7
    const perWeek = Array.from({ length: n / 7 }, (_, r) =>
      Array.from({ length: 7 }, (_, c) => pattern[(r * 7 + c - lead + n) % n]).filter(ch => ch === 'F').length)
    const [lo, hi] = [Math.min(...perWeek), Math.max(...perWeek)]
    checks.push(lo === hi
      ? { ok: true,  text: `${lo} folga(s) em toda semana` }
      : { ok: false, text: `Folgas por semana variam de ${lo} a ${hi}` })
  } else {
    const f = [...pattern].filter(ch => ch === 'F').length
    checks.push({ ok: true, text: `Em média ${fmtNum(Math.round((f * 7 / n) * 10) / 10)} folga(s) por semana` })
  }

  return {
    groupsOff: avg,
    shareOff:  groupsOff.map(x => Math.round(x / (weeks * offsets.length) * 100)),
    realOff:   counts && total > 0 ? realOff.map(x => Math.round(x / (weeks * total) * 100)) : null,
    checks,
  }
}

export function RestCycleWidget({ field, control, readonly }: { field: MetadataField; control: Control<any>; readonly?: boolean }) {
  const { id } = useParams<{ id?: string }>()
  const router = useRouter()
  const saved = !!id && id !== 'new'
  const confirm   = useConfirm()
  const { toast } = useToast()
  const anchorRaw = useWatch({ control, name: 'anchorDate' }) as string | Date | undefined
  const staggered = !!useWatch({ control, name: 'staggered' })
  const anchor = anchorRaw ? (typeof anchorRaw === 'string' ? anchorRaw.slice(0, 10) : anchorRaw.toISOString().slice(0, 10)) : null

  const { data: groups, refetch } = useQuery<Groups>({
    queryKey: ['transit', 'rest-pattern', id, 'groups'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/rest-pattern/${id}/groups`)
      if (!res.ok) throw new Error()
      return res.json()
    },
    enabled: saved,
  })

  async function balance() {
    const ok = await confirm({
      title:        'Equilibrar grupos',
      description:  'Operadores mudam de grupo (e de dias de folga) para que, em cada turno, os grupos fiquem com quantidades iguais. Quem já está num grupo dentro da cota não muda.',
      confirmLabel: 'Equilibrar',
    })
    if (!ok) return
    const res  = await apiFetch(`/transit/rest-pattern/${id}/balance`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(extractError(json)); return }
    toast.success(json.moved ? `${json.moved} operador(es) mudaram de grupo` : 'Os grupos já estavam equilibrados')
    void refetch()
  }

  return (
    <>
      <label className="text-sm font-medium pt-2" htmlFor={field.name}>{field.label}</label>
      <Controller
        name={field.name}
        control={control}
        render={({ field: ctrl, fieldState }) => {
          const pattern = String(ctrl.value ?? '')
          const set = (next: string) => ctrl.onChange(next)
          const offsets = restGroupOffsets({ pattern: pattern || 'T', staggered })
          const weekly = !staggered && pattern.length % 7 === 0
          // day 0 sits on the anchor's weekday. A cycle of whole weeks wraps around (it repeats
          // anyway): the days before day 0 in its week are the cycle's last ones — always whole
          // Monday-to-Sunday weeks. Any other cycle starts after empty cells.
          const lead = anchor ? (weekday(anchor) + 6) % 7 : 0
          const wraps = pattern.length > 0 && pattern.length % 7 === 0
          const rows = wraps ? pattern.length / 7 : Math.ceil((pattern.length + lead) / 7)
          const offCount = [...pattern].filter(c => c === 'F').length
          // saved counts only make sense for the saved grouping
          const counts = groups && groups.offsets.length === offsets.length
            ? offsets.map((_, g) => groups.shifts.reduce((n, s) => n + s.counts[g], 0))
            : null
          const today = localToday()
          const days = Array.from({ length: PREVIEW_DAYS }, (_, i) => addDays(today, i))
          const p = anchor && pattern.includes('F') ? { pattern, anchorDate: anchor, offOnHolidays: false } : null
          const grouped = counts?.reduce((a, b) => a + b, 0) ?? 0
          const bal = p && anchor ? cycleBalance(pattern, offsets, weekday(anchor), counts) : null
          const meanOff = bal ? bal.groupsOff.reduce((a, b) => a + b, 0) / 7 : 0

          return (
            <div className="space-y-4">
              {groups && groups.defaultOf.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Padrão dos turnos</span>
                  {groups.defaultOf.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      title={s.name}
                      onClick={() => router.push(`/transit/crew-shift/${s.id}`)}
                      className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <ShiftIcon className="w-3 h-3" />
                      {s.code}
                    </button>
                  ))}
                </div>
              )}

              {/* ── cycle grid ── */}
              <div className="space-y-2">
                <div className="inline-grid gap-1" style={{ gridTemplateColumns: `4.5rem repeat(7, 2.5rem)` }}>
                  <span />
                  {COLUMNS.map(wd => (
                    <span key={wd} className="text-xs text-muted-foreground text-center">{WEEKDAY[wd]}</span>
                  ))}
                  {Array.from({ length: rows }, (_, r) => (
                    <div key={r} className="contents">
                      <span className="text-xs text-muted-foreground self-center">Semana {r + 1}</span>
                      {Array.from({ length: 7 }, (_, c) => {
                        const raw = r * 7 + c - lead
                        const i = wraps ? (raw + pattern.length) % pattern.length : raw
                        if (i < 0 || i >= pattern.length) return <span key={c} />
                        const off = pattern[i] === 'F'
                        return (
                          <button
                            key={c} type="button" disabled={readonly}
                            id={i === 0 ? field.name : undefined}
                            title={`Dia ${i + 1} do ciclo${i === 0 ? ' (data base)' : ''}: ${off ? 'folga' : 'trabalha'}`}
                            onClick={() => set(pattern.slice(0, i) + (off ? 'T' : 'F') + pattern.slice(i + 1))}
                            className={cn(
                              'h-9 rounded-sm border text-xs font-medium transition-colors disabled:cursor-not-allowed',
                              i === 0 && 'ring-1 ring-primary',
                              off
                                ? 'bg-amber-500/20 border-amber-500/60 text-amber-700 dark:text-amber-300'
                                : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted',
                            )}
                          >
                            {off ? 'F' : 'T'}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
                {!readonly && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <CycleButton onClick={() => set(pattern + 'TTTTTTT')}>+ semana</CycleButton>
                    <CycleButton onClick={() => set(pattern.slice(0, -7))} disabled={pattern.length <= 7}>− semana</CycleButton>
                    <CycleButton onClick={() => set(pattern + 'T')}>+ dia</CycleButton>
                    <CycleButton onClick={() => set(pattern.slice(0, -1))} disabled={pattern.length <= 1}>− dia</CycleButton>
                  </div>
                )}
                {/* the cycle as text — paste a sequence to load it into the grid */}
                <input
                  type="text"
                  readOnly={readonly}
                  value={pattern}
                  onChange={e => set(e.target.value.toUpperCase().replace(/[^TF]/g, ''))}
                  placeholder="Cole a sequência (ex.: TTTTTFF)"
                  spellCheck={false}
                  aria-label="Ciclo como texto"
                  className={cn(inputBaseCls, 'w-full max-w-xl font-mono text-xs', readonly && 'opacity-60 cursor-not-allowed bg-muted')}
                />
                <p className="text-xs text-muted-foreground">
                  {pattern.length} dia(s) · {pattern.length - offCount} trabalhado(s) · {offCount} folga(s) ·{' '}
                  {offsets.length} grupo(s) {weekly ? 'a cada semana (mesmos dias da semana)' : 'a cada dia'}
                  {!anchor && ' — informe a data base'}
                  {' — o dia com contorno é a data base'}
                </p>
                {fieldState.error && <p className="text-xs text-destructive">{fieldState.error.message}</p>}
              </div>

              {/* ── balance per weekday ── */}
              {bal && (
                <div className="space-y-2">
                  <p className="text-xs font-medium">Folgas por dia da semana</p>
                  <div className="inline-grid gap-1 text-xs" style={{ gridTemplateColumns: `4.5rem repeat(7, 2.5rem)` }}>
                    <span />
                    {COLUMNS.map(wd => <span key={wd} className="text-muted-foreground text-center">{WEEKDAY[wd]}</span>)}
                    <span className="text-muted-foreground" title="Média por semana, com grupos do mesmo tamanho">Grupos</span>
                    {COLUMNS.map(wd => (
                      <span key={wd} className={cn('text-center tabular-nums', bal.groupsOff[wd] > meanOff + 1e-9 && 'font-medium text-amber-600 dark:text-amber-400')}>
                        {fmtNum(bal.groupsOff[wd])}
                      </span>
                    ))}
                    <span className="text-muted-foreground" title="% do quadro de folga, com grupos do mesmo tamanho">Quadro</span>
                    {COLUMNS.map(wd => <span key={wd} className="text-center tabular-nums text-muted-foreground">{bal.shareOff[wd]}%</span>)}
                    {bal.realOff && (
                      <>
                        <span className="text-muted-foreground" title="% do quadro de folga, com os operadores gravados em cada grupo">Real</span>
                        {COLUMNS.map(wd => <span key={wd} className="text-center tabular-nums text-muted-foreground">{bal.realOff![wd]}%</span>)}
                      </>
                    )}
                  </div>
                  <ul className="space-y-1 text-xs">
                    {bal.checks.map(c => (
                      <li key={c.text} className={cn('flex items-start gap-1.5', c.ok ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300')}>
                        {c.ok ? <OkIcon className="w-3.5 h-3.5 mt-px shrink-0 text-emerald-600 dark:text-emerald-400" /> : <WarnIcon className="w-3.5 h-3.5 mt-px shrink-0" />}
                        {c.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ── preview per group ── */}
              {p && (
                <div className="overflow-x-auto">
                  <table className="text-xs border-separate border-spacing-0.5">
                    <thead>
                      <tr>
                        <th />
                        {days.map(d => (
                          <th key={d} className={cn('w-7 font-normal text-muted-foreground', weekday(d) % 6 === 0 && 'text-foreground font-medium')}>
                            <div>{WEEKDAY[weekday(d)].slice(0, 1)}</div>
                            <div className="tabular-nums">{d.slice(8, 10)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {offsets.map((o, g) => (
                        <tr key={o}>
                          <td className="pr-2 whitespace-nowrap">
                            Grupo {restGroupLabel(g)}{counts && <span className="text-muted-foreground"> ({counts[g]})</span>}
                          </td>
                          {days.map(d => (
                            <td key={d} className={cn('h-5 rounded-sm', restPatternWorks(p, o, d) ? 'bg-muted/40' : 'bg-amber-500/50')} />
                          ))}
                        </tr>
                      ))}
                      {counts && grouped > 0 && (
                        <tr>
                          <td className="pr-2 text-muted-foreground whitespace-nowrap">Trabalhando</td>
                          {days.map(d => {
                            const share = Math.round(offsets.reduce((n, o, g) => n + (restPatternWorks(p, o, d) ? counts[g] : 0), 0) / grouped * 100)
                            return <td key={d} className="text-center tabular-nums text-[10px] text-muted-foreground">{share}</td>
                          })}
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {counts && grouped > 0 && <p className="text-xs text-muted-foreground mt-1">"Trabalhando": % do quadro do regime em serviço no dia (sem feriados).</p>}
                </div>
              )}

              {/* ── crew per shift and group ── */}
              {saved && groups && groups.total > 0 && (
                <div className="space-y-2">
                  {counts ? (
                    <table className="text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          <th className="pr-4 text-left font-medium">Turno</th>
                          {offsets.map((o, g) => <th key={o} className="px-2 font-medium">{restGroupLabel(g)}</th>)}
                          <th className="px-2 font-medium">Fora de grupo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.shifts.map(s => {
                          const uneven = Math.max(...s.counts) - Math.min(...s.counts) > 1 || s.outside > 0
                          return (
                            <tr key={s.shiftId ?? '-'}>
                              <td className="pr-4">{s.code}</td>
                              {s.counts.map((c, g) => <td key={g} className={cn('px-2 text-center tabular-nums', uneven && 'text-amber-600 dark:text-amber-400')}>{c}</td>)}
                              <td className="px-2 text-center tabular-nums">{s.outside || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-muted-foreground">Grave o regime para ver o quadro por grupo.</p>
                  )}
                  {!readonly && counts && (
                    <CycleButton onClick={() => void balance()}>Equilibrar grupos</CycleButton>
                  )}
                </div>
              )}
            </div>
          )
        }}
      />
    </>
  )
}

function CycleButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="h-7 px-2.5 rounded-sm border border-border text-xs hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  )
}

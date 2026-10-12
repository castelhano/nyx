'use client'

import type { RosterQuality } from '@nyx/schemas'
import { cn } from '@/lib/utils'

// What measures a roster (RosterQuality) — one column, or two side by side (the current allocation
// and a proposal) with the better one of each row in green.

const pct = (n: number, d: number) => (d ? `${Math.round(n / d * 100)}%` : '—')

type Row = { label: string; title: string; value: (q: RosterQuality) => string; rank: (q: RosterQuality) => number | null }
const ROWS: Row[] = [
  { label: 'Mantêm a tabela', title: 'Dias em que o operador fica na mesma tabela do último dia trabalhado (mesma escala)',
    value: q => `${pct(q.keptTable.kept, q.keptTable.days)} (${q.keptTable.kept}/${q.keptTable.days})`, rank: q => (q.keptTable.days ? q.keptTable.kept / q.keptTable.days : null) },
  { label: 'Trocas de tabela', title: 'Trocas no período e operadores que trocam',
    value: q => `${q.changes} · ${q.changedMembers} op.`, rank: q => -q.changes },
  { label: 'Linha preferida principal', title: 'Tabelas na linha preferida nº 1 do operador (de quem tem preferência)',
    value: q => (q.prefMain == null ? '—' : `${q.prefMain}%`), rank: q => q.prefMain },
  { label: 'Alguma preferida', title: 'Tabelas em qualquer linha preferida do operador',
    value: q => (q.prefAny == null ? '—' : `${q.prefAny}%`), rank: q => q.prefAny },
  { label: 'Abaixo da carga', title: 'Operadores abaixo de 97% da carga (do início do período da carga — ou do primeiro dia no sistema — até o fim do período)',
    value: q => `${q.belowLoad}/${q.withLoad}`, rank: q => -q.belowLoad },
  { label: 'Fora do ideal do turno', title: 'Média de minutos fora do início/fim ideal do turno',
    value: q => (q.shiftDev == null ? '—' : `⌀ ${q.shiftDev} min`), rank: q => (q.shiftDev == null ? null : -q.shiftDev) },
  { label: 'Regras feridas', title: 'Alocações que ferem uma regra (modo alerta, ou feitas à mão)',
    value: q => String(q.warnings), rank: q => -q.warnings },
]

export function QualityTable({ columns }: { columns: { label: string; q: RosterQuality }[] }) {
  // two columns: the index of the better one per row (null: tie / not comparable)
  const better = (r: Row) => {
    if (columns.length !== 2) return null
    const [a, b] = columns.map(c => r.rank(c.q))
    return a == null || b == null || a === b ? null : b > a ? 1 : 0
  }
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-muted-foreground">
          <th className="text-left font-medium pb-1">Qualidade</th>
          {columns.map(c => <th key={c.label} className="text-right font-medium pb-1">{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {ROWS.map(r => {
          const b = better(r)
          return (
            <tr key={r.label} title={r.title} className="border-t border-border/50">
              <td className="py-0.5 text-muted-foreground">{r.label}</td>
              {columns.map((c, i) => (
                <td key={c.label} className={cn('py-0.5 text-right tabular-nums', b === i && 'text-emerald-600 dark:text-emerald-400')}>{r.value(c.q)}</td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

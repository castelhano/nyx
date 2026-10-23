import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { z, ZodObject, ZodType } from 'zod'
import type { AuthUser, ImportColumn, ImportIssue, ImportResult, ImportRow } from '@nyx/types'
import type { PrismaService } from '../../prisma/prisma.service'
import { buildImportColumns, importDefault, unwrap } from '../metadata.builder'
import { resourceRegistry } from '../resource-registry'
import { stringEquals } from '../db.utils'
import { decodeCsv, parseCsv, type ParsedCsv } from './csv.parser'
import { parseCell, type CellResult } from './import.values'

// Standard CSV import (docs/FLOW.md): every row is converted, resolved and validated first;
// then the valid rows' writes run in one transaction, each under a savepoint so a database error
// marks its row and the rest still run. Any invalid row — or a dry run — rolls the whole thing back.

export const IMPORT_MAX_ROWS = 5000

export interface ImportOp {
  line:   number
  action: 'create' | 'update'
  id?:    string                     // the existing record, on update
  data:   Record<string, unknown>    // only the columns the row filled (plus defaults, on create)
  nested: Record<string, Record<string, unknown>>  // importNested groups the row filled, validated, with defaults
  extra:  Record<string, unknown>    // importFields the row filled (import-only columns, not record fields)
}

export interface ImportOptions {
  prisma:      PrismaService
  modelName:   string
  schema:      ZodObject<any>
  scopeField?: string
  user?:       AuthUser
  dryRun:      boolean
  write:       (tx: Prisma.TransactionClient, op: ImportOp) => Promise<void>
}

class Rollback extends Error {}

function checkHeaders(headers: string[], columns: ImportColumn[]): ImportIssue[] {
  const issues: ImportIssue[] = []
  const known = new Set(columns.map(c => c.name))
  headers.forEach((h, i) => {
    if (!h) issues.push({ message: `Coluna sem nome na posição ${i + 1}` })
    else if (!known.has(h)) issues.push({ column: h, message: `Coluna desconhecida: ${h}` })
    else if (headers.indexOf(h) !== i) issues.push({ column: h, message: `Coluna repetida: ${h}` })
  })
  // a key column that allows no value may be left out (e.g. a holiday's branch: global holiday)
  for (const c of columns) {
    if (c.key && c.required && !headers.includes(c.name)) issues.push({ column: c.name, message: `Coluna da chave ausente: ${c.name}` })
  }
  return issues
}

function issueMessage(issue: z.core.$ZodIssue, value: unknown, missing = 'Obrigatório na criação'): string {
  // an absent value fails as invalid_type, or invalid_value on enums
  if (value === undefined) return missing
  switch (issue.code) {
    case 'too_small':
      return issue.origin === 'string' ? `Mínimo de ${issue.minimum} caracteres` : `Mínimo ${issue.minimum}`
    case 'too_big':
      return issue.origin === 'string' ? `Máximo de ${issue.maximum} caracteres` : `Máximo ${issue.maximum}`
    case 'invalid_format':
      return issue.format === 'email' ? 'E-mail inválido' : 'Formato inválido'
    case 'custom':
      return issue.message
    default:
      return 'Valor inválido'
  }
}

// a failed write → the row's issue; anything that isn't a known database or business error is a bug
function writeIssue(err: unknown, columnOf: (field: string) => string): ImportIssue {
  if (err instanceof HttpException) {
    const res = err.getResponse()
    const message = typeof res === 'string' ? res : (res as { message?: string | string[] }).message
    return { message: Array.isArray(message) ? message.join('; ') : message ?? err.message }
  }
  const e = err as { code?: string; meta?: Record<string, any> }
  if (e?.code === 'P2002') {
    const fields: string[] = e.meta?.target ?? e.meta?.driverAdapterError?.cause?.constraint?.fields ?? []
    const columns = fields.map(f => columnOf(f.replace(/"/g, '')))
    return { column: columns[0], message: `Já existe registro com este valor${columns.length ? ` (${columns.join(', ')})` : ''}` }
  }
  if (e?.code === 'P2003') return { message: 'Referência a registro inexistente' }
  throw err
}

export async function runImport(buffer: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  const { prisma, schema, user } = opts
  const columns = buildImportColumns(schema)!
  const result: ImportResult = {
    dryRun: opts.dryRun, columns: [], errors: [], rows: [], total: 0, invalid: 0, created: 0, updated: 0,
  }

  let parsed: ParsedCsv
  try {
    parsed = parseCsv(decodeCsv(buffer))
  } catch (err) {
    result.errors.push({ message: (err as Error).message })
    return result
  }

  result.columns = parsed.headers
  result.errors.push(...checkHeaders(parsed.headers, columns))
  if (!parsed.records.length) result.errors.push({ message: 'Arquivo sem registros' })
  if (parsed.records.length > IMPORT_MAX_ROWS) {
    result.errors.push({ message: `Limite de ${IMPORT_MAX_ROWS} linhas por arquivo (o arquivo tem ${parsed.records.length})` })
  }
  if (result.errors.length) return result

  const nestedDefs = ((schema as any)._schemaMeta?.importNested ?? {}) as Record<string, { schema: ZodObject<any> }>
  const extraShape = ((schema as any)._schemaMeta?.importFields ?? {}) as Record<string, ZodType>
  const fieldOf  = (c: ImportColumn): ZodType => (c.group ? nestedDefs[c.group].schema.shape[c.field] : extraShape[c.field] ?? schema.shape[c.field])
  const metaOf   = (c: ImportColumn) => (fieldOf(c) as any).meta?.() ?? {}
  const columnOf = (field: string, group?: string) => columns.find(c => c.field === field && c.group === group)?.name ?? field
  const byName   = new Map(columns.map(c => [c.name, c]))
  // relations narrowed by a sibling (dependsOn) resolve after it
  const present  = parsed.headers.map(h => byName.get(h)!)
    .sort((a, b) => Number(!!metaOf(a).dependsOn) - Number(!!metaOf(b).dependsOn))
  const keyColumns = columns.filter(c => c.key)
  const isInt = (c: ImportColumn) => !!(unwrap(fieldOf(c)) as any).isInt

  // the importable fields only — no object-level refinements, which the writes still meet;
  // like the form, a field with a meta defaultValue takes it when a new record leaves it out
  const validatorOf = (group?: string) => {
    const own = columns.filter(c => c.group === group)
    return {
      create:   z.object(Object.fromEntries(own.map(c => [c.field, fieldOf(c)]))),
      defaults: Object.fromEntries(own.map(c => [c.field, importDefault(metaOf(c))] as const).filter(([, v]) => v !== undefined)),
    }
  }
  const main         = validatorOf()
  const updateSchema = main.create.partial()
  const nestedValidators = Object.fromEntries(Object.keys(nestedDefs).map(g => [g, validatorOf(g)]))

  const scoped = !!opts.scopeField && !!user && user.role !== 'admin'
  const outOfScope = (branchId: unknown) => typeof branchId === 'string' && !user!.branchIds.includes(branchId)

  const refCache = new Map<string, CellResult>()
  async function resolveRef(col: ImportColumn, raw: string, data: Record<string, unknown>, row: ImportRow): Promise<CellResult | null> {
    const meta   = metaOf(col)
    // narrowed only by a sibling that is itself a column (not e.g. the form's virtual company)
    const parent = columns.some(c => c.field === meta.dependsOn && c.group === col.group) ? meta.dependsOn as string : undefined
    if (parent && data[parent] == null) {
      // the parent's own error already explains the row
      if (row.errors.some(e => e.column === columnOf(parent, col.group))) return null
      return { ok: false, message: `Informe também ${columnOf(parent, col.group)}` }
    }
    const cacheKey = `${col.field}|${parent ? String(data[parent]) : ''}|${raw.toLowerCase()}`
    const cached = refCache.get(cacheKey)
    if (cached) return cached

    const target = resourceRegistry.find(e => e.resource === meta.resource && (!meta.domain || e.domain === meta.domain) && e.modelName)
    if (!target) throw new Error(`import: no model registered for ${meta.domain}/${meta.resource}`)
    const hits: { id: string }[] = await (prisma as any)[target.modelName!].findMany({
      where:  { [col.ref!]: stringEquals(raw), ...(parent ? { [parent]: data[parent] } : {}) },
      select: { id: true },
      take:   2,
    })
    const res: CellResult = hits.length === 1
      ? { ok: true, value: hits[0].id }
      : { ok: false, message: hits.length ? `"${raw}" corresponde a mais de um registro` : `Não encontrado: ${raw}` }
    refCache.set(cacheKey, res)
    return res
  }

  // a list cell: `|`-separated values, each an enum value, a relation (by its ref) or a string
  async function parseList(col: ImportColumn, raw: string, data: Record<string, unknown>, row: ImportRow): Promise<CellResult> {
    const values: unknown[] = []
    const errors: string[]  = []
    for (const item of raw.split('|').map(v => v.trim()).filter(Boolean)) {
      const res = col.item === 'relation' ? await resolveRef(col, item, data, row)
        : col.item === 'enum' ? parseCell(item, { ...col, type: 'enum' })
        : { ok: true as const, value: item }
      if (res?.ok) values.push(res.value)
      else if (res) errors.push(col.item === 'enum' ? `"${item}": ${res.message}` : res.message)
    }
    return errors.length ? { ok: false, message: errors.join('; ') } : { ok: true, value: [...new Set(values)] }
  }

  const ops: ImportOp[] = []
  const rowByLine = new Map<number, ImportRow>()
  const seenKeys  = new Map<string, number>()

  for (const rec of parsed.records) {
    const row: ImportRow = { line: rec.line, action: null, values: {}, errors: [] }
    result.rows.push(row)
    rowByLine.set(rec.line, row)
    parsed.headers.forEach((h, i) => { row.values[h] = (rec.cells[i] ?? '').trim() })
    if (rec.cells.length > parsed.headers.length) row.errors.push({ message: 'Linha com mais colunas que o cabeçalho' })

    // empty cell = leave as is; on a key column it means "no value" (null), when the key allows it
    const data: Record<string, unknown> = Object.fromEntries(keyColumns
      .filter(c => !parsed.headers.includes(c.name))
      .map(c => [c.field, null]))
    const nestedData: Record<string, Record<string, unknown>> = {}
    for (const col of present) {
      const raw = row.values[col.name]
      if (raw === '') {
        if (col.key && col.required) row.errors.push({ column: col.name, message: 'Obrigatório (chave)' })
        else if (col.key) data[col.field] = null
        continue
      }
      const target = col.group ? (nestedData[col.group] ??= {}) : data
      const res = col.type === 'relation' ? await resolveRef(col, raw, target, row)
        : col.type === 'list' ? await parseList(col, raw, target, row)
        : parseCell(raw, col, isInt(col))
      if (!res) continue
      if (res.ok) target[col.field] = res.value
      else row.errors.push({ column: col.name, message: res.message })
    }
    if (keyColumns.some(c => !(c.field in data))) continue

    const keyWhere = Object.fromEntries(keyColumns.map(c => [c.field, data[c.field]]))
    const keyStr   = JSON.stringify(keyColumns.map(c => data[c.field]))
    const dupLine  = seenKeys.get(keyStr)
    if (dupLine) {
      row.errors.push({ column: keyColumns[0].name, message: `Chave repetida no arquivo (linha ${dupLine})` })
      continue
    }
    seenKeys.set(keyStr, rec.line)

    const existing = await (prisma as any)[opts.modelName].findFirst({
      where:  keyWhere,
      select: { id: true, ...(opts.scopeField ? { [opts.scopeField]: true } : {}) },
    })
    if (scoped && (outOfScope(data[opts.scopeField!]) || outOfScope(existing?.[opts.scopeField!]))) {
      row.errors.push({ column: columnOf(opts.scopeField!), message: 'Filial fora do seu acesso' })
    }

    // a column whose cell already failed to convert isn't reported again as missing
    const failed = new Set(row.errors.map(e => e.column))
    const validation = existing ? updateSchema.safeParse(data) : main.create.safeParse({ ...main.defaults, ...data })
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        const field = String(issue.path[0] ?? '')
        if (!failed.has(columnOf(field))) row.errors.push({ column: columnOf(field), message: issueMessage(issue, data[field]) })
      }
    }

    // a nested group counts only when the row filled one of its columns — then it's complete
    const nested: Record<string, Record<string, unknown>> = {}
    for (const [group, values] of Object.entries(nestedData)) {
      const v = nestedValidators[group]
      const res = v.create.safeParse({ ...v.defaults, ...values })
      if (res.success) nested[group] = res.data
      else for (const issue of res.error.issues) {
        const field   = String(issue.path[0] ?? '')
        const missing = `Obrigatório para incluir ${(nestedDefs[group].schema as any)._schemaMeta?.label ?? group}`
        if (!failed.has(columnOf(field, group))) row.errors.push({ column: columnOf(field, group), message: issueMessage(issue, values[field], missing) })
      }
    }
    if (row.errors.length) continue

    // import-only columns go apart from the record's own fields
    const values = existing ? data : validation.data as Record<string, unknown>
    const extra: Record<string, unknown> = {}
    for (const k of Object.keys(extraShape)) {
      if (k in values) extra[k] = values[k]
      delete values[k]
    }

    row.action = existing ? 'update' : 'create'
    ops.push(existing
      ? { line: rec.line, action: 'update', id: existing.id, data: values, nested, extra }
      : { line: rec.line, action: 'create', data: values, nested, extra })
  }

  const countInvalid = () => result.rows.filter(r => r.errors.length).length
  const tally = () => {
    result.total   = result.rows.length
    result.invalid = countInvalid()
    result.created = result.rows.filter(r => r.action === 'create' && !r.errors.length).length
    result.updated = result.rows.filter(r => r.action === 'update' && !r.errors.length).length
  }
  // the valid rows still run their writes (rolled back below) so the preview shows every
  // database and business error at once, not only after the other rows are fixed
  try {
    await prisma.$transaction(async (tx) => {
      for (const op of ops) {
        await tx.$executeRawUnsafe('SAVEPOINT import_row')
        try {
          await opts.write(tx, op)
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT import_row')
        } catch (err) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT import_row')
          rowByLine.get(op.line)!.errors.push(writeIssue(err, columnOf))
        }
      }
      if (opts.dryRun || countInvalid()) throw new Rollback()
    }, { maxWait: 10_000, timeout: 300_000 })
  } catch (err) {
    if (!(err instanceof Rollback)) throw err
  }
  tally()
  return result
}

// The CSV "Modelo": every import column, with the schema's fictitious example rows
export function buildImportTemplate(schema: ZodObject<any>): { headers: string[]; rows: string[][] } {
  const headers  = buildImportColumns(schema)!.map(c => c.name)
  const examples = ((schema as any)._schemaMeta?.importExamples ?? []) as Record<string, string>[]
  const unknown  = examples.flatMap(e => Object.keys(e)).filter(k => !headers.includes(k))
  if (unknown.length) throw new Error(`importExamples columns not importable: ${[...new Set(unknown)].join(', ')}`)
  return { headers, rows: examples.map(e => headers.map(h => e[h] ?? '')) }
}

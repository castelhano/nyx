import { HttpException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { z, ZodObject, ZodType } from 'zod'
import type { AuthUser, ImportColumn, ImportIssue, ImportResult, ImportRow } from '@nyx/types'
import type { PrismaService } from '../../prisma/prisma.service'
import { buildImportColumns, unwrap } from '../metadata.builder'
import { resourceRegistry } from '../resource-registry'
import { stringEquals } from '../db.utils'
import { decodeCsv, parseCsv, type ParsedCsv } from './csv.parser'
import { parseCell, type CellResult } from './import.values'

// Standard CSV import (docs/FLOW.md): every row is converted, resolved and validated first;
// then all writes run in one transaction, each under a savepoint so a database error marks its
// row and the rest still run. Any invalid row — or a dry run — rolls the whole thing back.

export const IMPORT_MAX_ROWS = 5000

export interface ImportOp {
  line:   number
  action: 'create' | 'update'
  id?:    string                     // the existing record, on update
  data:   Record<string, unknown>    // only the columns the row filled (plus defaults, on create)
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

const fieldMeta = (schema: ZodObject<any>, field: string) => schema.shape[field]?.meta?.() ?? {}

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

function issueMessage(issue: z.core.$ZodIssue, value: unknown): string {
  switch (issue.code) {
    case 'invalid_type':
      return value === undefined ? 'Obrigatório na criação' : 'Valor inválido'
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

  const columnOf = (field: string) => columns.find(c => c.field === field)?.name ?? field
  const byName   = new Map(columns.map(c => [c.name, c]))
  // relations narrowed by a sibling (dependsOn) resolve after it
  const present  = parsed.headers.map(h => byName.get(h)!)
    .sort((a, b) => Number(!!fieldMeta(schema, a.field).dependsOn) - Number(!!fieldMeta(schema, b.field).dependsOn))
  const keyColumns = columns.filter(c => c.key)
  const isInt = (c: ImportColumn) => !!(unwrap(schema.shape[c.field] as ZodType) as any).isInt

  // the importable fields only — no object-level refinements, which the writes still meet
  const createSchema = z.object(Object.fromEntries(columns.map(c => [c.field, schema.shape[c.field]])))
  const updateSchema = createSchema.partial()
  // like the form: a field with a meta defaultValue takes it when a new record leaves it out
  const createDefaults = Object.fromEntries(columns
    .map(c => [c.field, fieldMeta(schema, c.field).defaultValue] as const)
    .filter(([, v]) => v !== undefined))

  const scoped = !!opts.scopeField && !!user && user.role !== 'admin'
  const outOfScope = (branchId: unknown) => typeof branchId === 'string' && !user!.branchIds.includes(branchId)

  const refCache = new Map<string, CellResult>()
  async function resolveRef(col: ImportColumn, raw: string, data: Record<string, unknown>, row: ImportRow): Promise<CellResult | null> {
    const meta   = fieldMeta(schema, col.field)
    // narrowed only by a sibling that is itself a column (not e.g. the form's virtual company)
    const parent = columns.some(c => c.field === meta.dependsOn) ? meta.dependsOn as string : undefined
    if (parent && data[parent] == null) {
      // the parent's own error already explains the row
      if (row.errors.some(e => e.column === columnOf(parent))) return null
      return { ok: false, message: `Informe também ${columnOf(parent)}` }
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
    for (const col of present) {
      const raw = row.values[col.name]
      if (raw === '') {
        if (col.key && col.required) row.errors.push({ column: col.name, message: 'Obrigatório (chave)' })
        else if (col.key) data[col.field] = null
        continue
      }
      const res = col.type === 'relation' ? await resolveRef(col, raw, data, row) : parseCell(raw, col, isInt(col))
      if (!res) continue
      if (res.ok) data[col.field] = res.value
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

    const validation = existing ? updateSchema.safeParse(data) : createSchema.safeParse({ ...createDefaults, ...data })
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        const field = String(issue.path[0] ?? '')
        row.errors.push({ column: columnOf(field), message: issueMessage(issue, data[field]) })
      }
    }
    if (row.errors.length) continue

    row.action = existing ? 'update' : 'create'
    ops.push(existing
      ? { line: rec.line, action: 'update', id: existing.id, data }
      : { line: rec.line, action: 'create', data: validation.data as Record<string, unknown> })
  }

  const countInvalid = () => result.rows.filter(r => r.errors.length).length
  const tally = () => {
    result.total   = result.rows.length
    result.invalid = countInvalid()
    result.created = result.rows.filter(r => r.action === 'create' && !r.errors.length).length
    result.updated = result.rows.filter(r => r.action === 'update' && !r.errors.length).length
  }
  tally()
  if (result.invalid) return result

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

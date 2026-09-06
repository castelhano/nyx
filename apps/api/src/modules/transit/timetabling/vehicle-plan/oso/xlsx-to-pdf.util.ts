import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { InternalServerErrorException, Logger } from '@nestjs/common'

const execFileAsync = promisify(execFile)
const logger = new Logger('XlsxToPdf')

const CONVERT_TIMEOUT_MS = 30_000

// soffice headless doesn't scale well under concurrent invocations (profile/CPU contention) —
// serialize conversions in-process rather than introducing a queue/broker for v1
// (docs/proposal/plan_oso_export_v1.md, "PDF — via LibreOffice headless").
let queue: Promise<void> = Promise.resolve()

export async function convertXlsxToPdf(xlsxBuffer: Buffer): Promise<Buffer> {
  const run = queue.then(() => convertOnce(xlsxBuffer))
  queue = run.then(() => undefined, () => undefined)
  return run
}

async function convertOnce(xlsxBuffer: Buffer): Promise<Buffer> {
  const dir      = await mkdtemp(join(tmpdir(), 'oso-pdf-'))
  const xlsxPath = join(dir, `${randomUUID()}.xlsx`)
  const pdfPath  = xlsxPath.replace(/\.xlsx$/, '.pdf')

  try {
    await writeFile(xlsxPath, xlsxBuffer)
    await execFileAsync(
      'soffice',
      ['--headless', '--convert-to', 'pdf', '--outdir', dir, xlsxPath],
      { timeout: CONVERT_TIMEOUT_MS },
    )
    return await readFile(pdfPath)
  } catch (err) {
    logger.error('soffice conversion failed', err instanceof Error ? err.stack : err)
    throw new InternalServerErrorException('Falha ao gerar PDF do OSO')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

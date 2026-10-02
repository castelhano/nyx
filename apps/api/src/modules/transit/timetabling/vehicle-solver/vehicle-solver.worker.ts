import { workerData, parentPort, isMainThread } from 'worker_threads'
import { VehicleModel, constructBlocks, summarizeProposal, toProposalBlocks, SolverError, type VehicleSolverInput, type WorkBlock } from './vehicle-solver.calc'
import { VehicleImprover } from './vehicle-solver.improve'
import type { VehicleSolverCommand, VehicleSolverMessage } from './vehicle-solver.types'

// Runs the vehicle solver off the main thread: the construction (first proposal in seconds),
// then the continuous improvement in short slices — between them the event loop turns, so a
// 'stop' from the host gets through. A better proposal goes out at most once a second; the run
// ends on 'stop', the time limit or no improvement (settings.stopMaxTotalMinutes /
// stopNoImprovementMinutes), always posting the best one found first.

if (isMainThread) process.exit(1)

const SLICE_MS    = 50
const EMIT_MS     = 1000
const PROGRESS_MS = 500

const post  = (msg: VehicleSolverMessage) => parentPort!.postMessage(msg)
const input = workerData as VehicleSolverInput
const started = Date.now()
let stopped = false
parentPort!.on('message', (cmd: VehicleSolverCommand) => { if (cmd?.type === 'stop') stopped = true })

const fail = (err: unknown) => post({ type: 'error', message: err instanceof SolverError || err instanceof Error ? err.message : String(err) })

try {
  // the input arrives as plain data (structured clone) — the model is rebuilt here
  const model = new VehicleModel(input)
  let index = 0
  const propose = (blocks: WorkBlock[]) =>
    post({ type: 'proposal', proposal: { index: ++index, summary: summarizeProposal(model, blocks), blocks: toProposalBlocks(blocks) } })

  const construction = constructBlocks(model)
  propose(construction)

  const maxMs  = input.settings.stopMaxTotalMinutes * 60_000
  const idleMs = input.settings.stopNoImprovementMinutes * 60_000
  // one cooling cycle per half of the no-improvement window (see VehicleImprover)
  const improver = new VehicleImprover(model, construction, Math.min(maxMs, idleMs / 2))
  let emitted = 0, lastEmit = 0, lastProgress = 0

  const emitBest = () => {
    propose(improver.bestBlocks())
    emitted = improver.improvements
    lastEmit = Date.now()
  }
  const progress = (now: number) => {
    post({
      type: 'progress', elapsed: now - started, attempts: improver.attempts, improvements: improver.improvements,
      bestScore: improver.bestScore, sinceImprovement: now - improver.lastImprovementAt,
    })
    lastProgress = now
  }
  const finish = (stopReason: 'finished' | 'user_stopped' | 'max_time' | 'no_improvement') => {
    if (improver.improvements !== emitted) emitBest()
    const now = Date.now()
    progress(now)
    post({ type: 'done', stopReason, elapsed: now - started, attempts: improver.attempts })
  }

  const tick = () => {
    try {
      if (stopped) return finish('user_stopped')
      if (!construction.length) return finish('finished')
      improver.run(SLICE_MS)
      const now = Date.now()
      if (improver.improvements !== emitted && now - lastEmit >= EMIT_MS) emitBest()
      if (now - lastProgress >= PROGRESS_MS) progress(now)
      if (now - started >= maxMs) return finish('max_time')
      if (now - improver.lastImprovementAt >= idleMs) return finish('no_improvement')
      setImmediate(tick)
    } catch (err) {
      fail(err)
    }
  }
  setImmediate(tick)
} catch (err) {
  fail(err)
}

import { workerData, parentPort, isMainThread } from 'worker_threads'
import { solveCrewPlan, evaluateSolverDuties, type SolverDuty } from './crew-solver.calc'
import { CrewImprover } from './crew-solver.improve'
import type { CrewSolverCommand, CrewSolverMessage, CrewSolverWorkerData } from './crew-solver.types'

// Runs the crew solver off the main thread: the construction (first proposal in milliseconds),
// then the continuous improvement in short slices — between them the event loop turns, so a
// 'stop' from the host gets through. A better proposal goes out at most once a second; the run
// ends on 'stop', the time limit or no improvement (settings.stopMaxTotalMinutes /
// stopNoImprovementMinutes), always posting the best one found first. Without `optimize` the
// run ends right after the construction.

if (isMainThread) process.exit(1)

const SLICE_MS    = 50
const EMIT_MS     = 1000
const PROGRESS_MS = 500

const post  = (msg: CrewSolverMessage) => parentPort!.postMessage(msg)
const { input, seed, optimize } = workerData as CrewSolverWorkerData
const started = Date.now()
let stopped = false
parentPort!.on('message', (cmd: CrewSolverCommand) => { if (cmd?.type === 'stop') stopped = true })

try {
  const construction = solveCrewPlan(input)
  post({ type: 'proposal', proposal: { index: 1, summary: construction.evaluation.summary, duties: construction.duties } })
  if (optimize) improve(construction.duties)
  else post({ type: 'done', stopReason: 'finished', elapsed: Date.now() - started, attempts: 0 })
} catch (err) {
  post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
}

function improve(initial: SolverDuty[]) {
  let index = 1
  const maxMs  = input.settings.stopMaxTotalMinutes * 60_000
  const idleMs = input.settings.stopNoImprovementMinutes * 60_000
  // one cooling cycle per half of the no-improvement window (see CrewImprover)
  const improver = new CrewImprover(input, initial, Math.min(maxMs, idleMs / 2), seed)
  let emitted = 0, lastEmit = 0, lastProgress = 0

  const emitBest = () => {
    const best = evaluateSolverDuties(input, improver.bestDuties())
    post({ type: 'proposal', proposal: { index: ++index, summary: best.evaluation.summary, duties: best.duties } })
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
      if (!initial.length) return finish('finished')
      improver.run(SLICE_MS)
      const now = Date.now()
      if (improver.improvements !== emitted && now - lastEmit >= EMIT_MS) emitBest()
      if (now - lastProgress >= PROGRESS_MS) progress(now)
      if (now - started >= maxMs) return finish('max_time')
      if (now - improver.lastImprovementAt >= idleMs) return finish('no_improvement')
      setImmediate(tick)
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }
  setImmediate(tick)
}

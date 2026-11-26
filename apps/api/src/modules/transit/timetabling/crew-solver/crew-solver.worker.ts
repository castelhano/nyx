import { workerData, parentPort, isMainThread } from 'worker_threads'
import { solveCrewPlan, seedCrewPlan, evaluateSolverDuties, crewUsage, type SolverDuty } from './crew-solver.calc'
import { CrewImprover } from './crew-solver.improve'
import type { CrewSolverCommand, CrewSolverMessage, CrewSolverWorkerData } from './crew-solver.types'

// Runs one search of the crew solver off the main thread: the starting point (the plan's duties
// with their gaps covered, or the construction — first proposal in milliseconds, announced as
// 'start'), then the continuous improvement in short slices — between them the event loop turns, so a
// 'stop' from the host gets through. A better proposal goes out at most once a second; the run
// ends on 'stop', the time limit or no improvement (settings.stopMaxTotalMinutes /
// stopNoImprovementMinutes), always posting the best one found first. Without `optimize` the
// run ends right after the starting point.

if (isMainThread) process.exit(1)

const SLICE_MS    = 50
const EMIT_MS     = 1000
const PROGRESS_MS = 500
// a cooling cycle never lasts longer than this — with a long no-improvement window (a run left
// overnight) the search would otherwise stay hot for hours before going back to its best
const MAX_CYCLE_MS = 30 * 60_000

const post  = (msg: CrewSolverMessage) => parentPort!.postMessage(msg)
const { input, seed, optimize, start } = workerData as CrewSolverWorkerData
const started = Date.now()
let stopped = false
parentPort!.on('message', (cmd: CrewSolverCommand) => { if (cmd?.type === 'stop') stopped = true })

try {
  // the starting point: the plan's duties (start: current), else the construction
  const seeded = start === 'current' ? seedCrewPlan(input) : null
  const first = seeded ? evaluateSolverDuties(input, seeded.duties) : solveCrewPlan(input)
  post({
    type: 'start',
    start: {
      from: seeded ? 'current' : 'construction', filled: seeded?.filled ?? 0, droppedPieces: input.droppedPieces,
      fallback: start === 'current' && !seeded ? 'a escala não tem jornadas de motorista a refazer' : null,
      summary: first.evaluation.summary,
    },
  })
  post({ type: 'proposal', proposal: { index: 1, summary: first.evaluation.summary, duties: first.duties, crew: crewUsage(input, first) } })
  if (optimize) improve(first.duties)
  else post({ type: 'done', stopReason: 'finished', elapsed: Date.now() - started, attempts: 0 })
} catch (err) {
  post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
}

function improve(initial: SolverDuty[]) {
  let index = 1
  const maxMs  = input.settings.stopMaxTotalMinutes * 60_000
  const idleMs = input.settings.stopNoImprovementMinutes * 60_000
  // one cooling cycle per half of the no-improvement window, at most MAX_CYCLE_MS (see CrewImprover)
  const improver = new CrewImprover(input, initial, Math.min(maxMs, idleMs / 2, MAX_CYCLE_MS), seed)
  let emitted = 0, lastEmit = 0, lastProgress = 0

  const emitBest = () => {
    const best = evaluateSolverDuties(input, improver.bestDuties())
    post({ type: 'proposal', proposal: { index: ++index, summary: best.evaluation.summary, duties: best.duties, crew: crewUsage(input, best) } })
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

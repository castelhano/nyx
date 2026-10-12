import { workerData, parentPort, isMainThread } from 'worker_threads'
import { buildProposal, construct, coverageBound, currentAssign, RosterImprover, RosterModel } from './roster-generator.calc'
import type { RosterCommand, RosterMessage, RosterStopReason, RosterWorkerData } from './roster-generator.types'

// Runs the roster generator off the main thread: the construction (first proposal), then the
// improvement in short slices so a 'stop' from the host gets through. A better proposal goes out
// at most once a second; the run ends on 'stop', the time limit or no improvement, always
// posting the best one found first.

if (isMainThread) process.exit(1)

const SLICE_MS    = 50
const EMIT_MS     = 1000
const PROGRESS_MS = 500

const post = (msg: RosterMessage) => parentPort!.postMessage(msg)
const { input, seed, maxMs, idleMs, boundIdleMs } = workerData as RosterWorkerData
const started = Date.now()
let stopped = false
parentPort!.on('message', (cmd: RosterCommand) => { if (cmd?.type === 'stop') stopped = true })

try {
  const model = new RosterModel(input)
  // the most duties the crew can cover — past it only the quality improves
  const bound = coverageBound(model)
  const current = currentAssign(model)
  const initial = construct(model)
  post({ type: 'proposal', proposal: buildProposal(model, initial.assign, 1, bound, current) })

  const improver = new RosterImprover(model, initial, Math.min(maxMs, idleMs / 2), seed)
  let index = 1, emitted = 0, lastEmit = 0, lastProgress = 0

  const emitBest = () => {
    post({ type: 'proposal', proposal: buildProposal(model, improver.bestAssign(), ++index, bound, current) })
    emitted = improver.improvements
    lastEmit = Date.now()
  }
  const progress = (now: number) => {
    post({
      type: 'progress', elapsed: now - started, attempts: improver.attempts, improvements: improver.improvements,
      bestScore: improver.bestObjective, sinceImprovement: now - improver.lastImprovementAt,
    })
    lastProgress = now
  }
  const finish = (stopReason: RosterStopReason) => {
    if (improver.improvements !== emitted) emitBest()
    const now = Date.now()
    progress(now)
    post({ type: 'done', stopReason, elapsed: now - started, attempts: improver.attempts })
  }
  const tick = () => {
    try {
      if (stopped) return finish('user_stopped')
      if (!input.duties.length || !input.members.length) return finish('finished')
      improver.run(SLICE_MS)
      const now = Date.now()
      if (improver.improvements !== emitted && now - lastEmit >= EMIT_MS) emitBest()
      if (now - lastProgress >= PROGRESS_MS) progress(now)
      if (now - started >= maxMs) return finish('max_time')
      const atBound = input.duties.length - improver.bestUnassigned >= bound
      if (now - improver.lastImprovementAt >= (atBound ? boundIdleMs : idleMs)) return finish('no_improvement')
      setImmediate(tick)
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }
  setImmediate(tick)
} catch (err) {
  post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
}

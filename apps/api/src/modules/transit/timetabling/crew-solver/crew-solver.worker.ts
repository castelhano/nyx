import { workerData, parentPort, isMainThread } from 'worker_threads'
import { solveCrewPlan } from './crew-solver.calc'
import type { CrewSolverMessage, CrewSolverWorkerData } from './crew-solver.types'

// Runs the crew solver off the main thread. For now a single construction pass — the
// continuous improvement (docs/proposal/plan_crew_solver_v1.md, phase 4) will loop here,
// posting each better proposal and honoring 'stop'.

if (isMainThread) process.exit(1)

const post = (msg: CrewSolverMessage) => parentPort!.postMessage(msg)
const started = Date.now()

try {
  const result = solveCrewPlan(workerData as CrewSolverWorkerData)
  post({ type: 'progress', elapsed: Date.now() - started, attempts: 1, bestScore: result.evaluation.summary.score })
  post({ type: 'proposal', proposal: { index: 1, summary: result.evaluation.summary, duties: result.duties } })
  post({ type: 'done', stopReason: 'finished', elapsed: Date.now() - started })
} catch (err) {
  post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
}

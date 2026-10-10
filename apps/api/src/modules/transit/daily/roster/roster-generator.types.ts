import type { RgInput, RosterProposal } from './roster-generator.calc'

// Shared by RosterGeneratorService and the worker.

export type RosterStopReason = 'finished' | 'user_stopped' | 'max_time' | 'no_improvement'

// worker → host (and host → client: the proposal goes out without its assignments). `stage`
// comes from the host while it prepares the run (materializing days, reading the data).
export type RosterMessage =
  | { type: 'stage'; message: string }
  | { type: 'progress'; elapsed: number; attempts: number; improvements: number; bestScore: number; sinceImprovement: number }
  | { type: 'proposal'; proposal: RosterProposal }
  | { type: 'done'; stopReason: RosterStopReason; elapsed: number; attempts: number }
  | { type: 'error'; message: string }

export type RosterCommand = { type: 'stop' }

export interface RosterWorkerData { input: RgInput; seed: number; maxMs: number; idleMs: number }

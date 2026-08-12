import { useState, useEffect, useRef } from 'react'
import { getToken } from '@/lib/auth'
import type { SolverScenario } from '../components/SolverProposalDialog'

interface SolverMessage {
  type:           string
  stage?:         number
  stageLabel?:    string
  attempt?:       number
  bestScore?:     number
  bestFleet?:     number
  elapsed?:       number
  stopReason?:    string
  totalAttempts?: number
  proposalIndex?: number
  scenario?:      SolverScenario
}

export interface SolverDisplayState {
  proposalCount:     number
  fleetCount:        number | null
  score:             number | null
  totalIterations:   number
  currentLevel:      number
  currentLevelLabel: string
  bestScenario:      SolverScenario | null
}

const SOLVER_DISPLAY_RESET: SolverDisplayState = {
  proposalCount: 0, fleetCount: null, score: null, totalIterations: 0,
  currentLevel: 1, currentLevelLabel: 'FLEET', bestScenario: null,
}

export function useSolverStream(planId: string, jobId: string | null, onDone: () => void) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const hadProgressRef = useRef(false)
  const [state, setState] = useState<SolverDisplayState>(SOLVER_DISPLAY_RESET)

  useEffect(() => {
    if (!jobId) {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      hadProgressRef.current = false
      setState(SOLVER_DISPLAY_RESET)
      return
    }

    hadProgressRef.current = false
    const token = getToken()
    const url   = `/api/transit/vehicle-plan/${planId}/stream?jobId=${jobId}&token=${encodeURIComponent(token)}`
    const es    = new EventSource(url)

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as SolverMessage

        if (msg.type === 'progress') {
          hadProgressRef.current = true
          setState(s => ({
            ...s,
            totalIterations: msg.attempt ?? s.totalIterations,
            fleetCount:      msg.bestFleet ?? s.fleetCount,
            score:           msg.bestScore ?? s.score,
          }))
        }

        if (msg.type === 'proposal') {
          const isStochastic = hadProgressRef.current
          setState(s => ({
            ...s,
            proposalCount:   msg.proposalIndex ?? s.proposalCount,
            fleetCount:      msg.scenario?.fleetCount ?? s.fleetCount,
            score:           msg.scenario?.score      ?? s.score,
            bestScenario:    msg.scenario ? { ...msg.scenario } : s.bestScenario,
            // deterministic: no progress msgs — count proposals as iterations
            totalIterations: isStochastic ? s.totalIterations : (msg.proposalIndex ?? s.proposalCount + 1),
          }))
        }

        if (msg.type === 'improvement') {
          setState(s => ({
            ...s,
            proposalCount: msg.proposalIndex ?? s.proposalCount,
            fleetCount:    msg.scenario?.fleetCount ?? s.fleetCount,
            score:         msg.scenario?.score      ?? s.score,
            bestScenario:  msg.scenario ? { ...msg.scenario } : s.bestScenario,
          }))
        }

        if (msg.type === 'done') {
          es.close()
          onDone()
        }
      } catch { /* ignore */ }
    }

    es.onerror = () => {
      es.close()
      onDone()
    }

    eventSourceRef.current = es
    return () => es.close()
  }, [planId, jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}

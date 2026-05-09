# Dispatch Timetabling — Incremental Scenario Evaluation

> Reference document for future implementation of scenario optimisation with incremental streaming and best-result assumption.

---

## Context

The timetabling module needs to evaluate a large number of possible scenarios (e.g. 120+) in a process that may take considerable time. The goal is not to wait for all scenarios to finish — it is to allow the user to **assume the best scenario found so far** at any moment, without waiting for the end of processing.

---

## Approach: SSE + "Best So Far" on the Server

### Core principle

The server maintains the best scenario found internally (`bestScenario`) and updates that state after each evaluation. The client receives only **progress signals** (count evaluated, best score so far). When the user clicks "Assume", the server returns the `bestScenario` at that exact instant — regardless of how many scenarios have been evaluated.

This resolves the race condition intentionally: it does not matter whether the client requested at position 120 and the server is already at 121 — the server always delivers the best available.

```
[NestJS SSE]  ──── HTTP persistent connection ────  [EventSource in browser]
      │                                                        │
  evaluates scenarios                              setProgress({ count, bestScore })
  maintains bestScenario                           re-renders on each event
  emits progress (count, score)
      │
  POST /assume ◄──────────────────────── user click (at any moment)
      │
  returns current bestScenario
```

### Why SSE and not WebSocket or polling?

| Approach | Problem |
|----------|---------|
| Polling | Artificial delay, resource waste, does not scale |
| WebSocket | Bidirectional — unnecessary here, more complex to operate |
| **SSE** | Unidirectional server→client, native HTTP, automatic reconnection, native NestJS support via `@Sse` + `Observable` |

---

## Backend — NestJS

### Service

Does not extend `BaseService` — this is not a standard CRUD resource. The service holds custom in-memory state and emits an Observable stream.

```typescript
// modules/timetabling/scenario/scenario.service.ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { Observable } from 'rxjs'

@Injectable()
export class ScenarioService {
  private bestScenario: Scenario | null = null
  private count = 0
  private running = false

  streamScenarios(jobId: string): Observable<any> {
    this.bestScenario = null
    this.count = 0
    this.running = true

    return new Observable((observer) => {
      const interval = setInterval(async () => {
        if (!this.running) {
          clearInterval(interval)
          observer.complete()
          return
        }

        const candidate = await this.evaluateNextScenario(this.count)
        this.count++

        if (!this.bestScenario || candidate.score > this.bestScenario.score) {
          this.bestScenario = candidate
        }

        observer.next({
          data: JSON.stringify({
            count:     this.count,
            bestScore: this.bestScenario.score,
            done:      this.count >= MAX_SCENARIOS,
          }),
        })

        if (this.count >= MAX_SCENARIOS) {
          this.running = false
          clearInterval(interval)
          observer.complete()
        }
      }, /* real processing interval */)

      // Cleanup when client disconnects before completion
      return () => {
        this.running = false
        clearInterval(interval)
      }
    })
  }

  // Called by the button — intentional race condition
  assumeBest(): Scenario {
    if (!this.bestScenario) throw new NotFoundException('No scenario evaluated yet')
    return this.bestScenario
  }
}
```

### Controller

Does **not** extend `BaseController` — `BaseController` is reserved for standard CRUD resources backed by a Zod schema. This controller exposes custom endpoints only.

```typescript
// modules/timetabling/scenario/scenario.controller.ts
import { Controller, Sse, Post, UseGuards } from '@nestjs/common'
import { Observable } from 'rxjs'
import { ScenarioService } from './scenario.service'
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard'

@UseGuards(JwtAuthGuard)
@Controller('timetabling/scenarios')
export class ScenarioController {
  constructor(private readonly scenarioService: ScenarioService) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return this.scenarioService.streamScenarios()
  }

  @Post('assume')
  assume() {
    return this.scenarioService.assumeBest()
  }
}
```

---

## Frontend — Next.js

### SSE Authentication

`EventSource` is a native browser API and **does not support custom headers** — there is no way to send the JWT `Authorization` header on the SSE connection. Two viable options:

| Option | Description |
|--------|-------------|
| **Cookie-based auth** | Preferred for SSE: if the project adopts `httpOnly` cookies alongside JWT, the browser sends them automatically. |
| **Token as query param** | Pass JWT as `?token=<jwt>` in the EventSource URL. Works but exposes the token in server logs. Acceptable for internal tooling. |

Until the auth strategy for SSE is decided, the prototype can use the query param approach. The `POST /assume` endpoint uses `apiFetch` normally (header-based JWT).

### Hook

```typescript
// lib/timetabling/use-scenario-stream.ts
'use client'
import { useState, useRef } from 'react'
import { apiFetch } from '@/lib/auth'

interface Progress {
  count:     number
  bestScore: number | null
  done:      boolean
}

export function useScenarioStream() {
  const [progress, setProgress]   = useState<Progress>({ count: 0, bestScore: null, done: false })
  const [streaming, setStreaming] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const start = (token: string) => {
    esRef.current?.close()
    setStreaming(true)
    setProgress({ count: 0, bestScore: null, done: false })

    // Token as query param — see SSE Authentication note above
    const es = new EventSource(`/api/timetabling/scenarios/stream?token=${token}`)
    esRef.current = es

    es.onmessage = (event) => {
      const data: Progress = JSON.parse(event.data)
      setProgress(data)
      if (data.done) {
        setStreaming(false)
        es.close()
      }
    }

    es.onerror = () => {
      setStreaming(false)
      es.close()
    }
  }

  const stop = () => {
    esRef.current?.close()
    setStreaming(false)
  }

  const assume = async (): Promise<Scenario> => {
    const res = await apiFetch('/timetabling/scenarios/assume', { method: 'POST' })
    if (!res.ok) throw new Error('No scenario available')
    return res.json()
  }

  return { progress, streaming, start, stop, assume }
}
```

The hook lives in `apps/web/src/lib/timetabling/` — domain-specific utilities follow the same `lib/` convention as `lib/keywatch/`.

### Integration with TopbarActionsContext

Following the architecture pattern (section 9 of ARCHITECTURE.md), controls live in the topbar. `alt+g` is the project-wide shortcut for the primary commit action — "assume best" fits this role on this page.

```tsx
// app/timetabling/scenarios/page.tsx
'use client'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { useScenarioStream } from '@/lib/timetabling/use-scenario-stream'
import { Button } from '@/components/ui/button'
import { Play, Square, CheckCircle } from 'lucide-react'

export default function ScenariosPage() {
  const { progress, streaming, start, stop, assume } = useScenarioStream()

  const handleAssume = async () => {
    const best = await assume()
    applyScenario(best)
  }

  useShortcut('alt+g', handleAssume, {
    desc:    'Assume best scenario',
    icon:    CheckCircle,
    origin:  'apps/web/src/app/timetabling/scenarios/page',
    enabled: progress.count > 0,
  })

  useTopbarActions(
    <div className="flex items-center gap-3">
      {(streaming || progress.done) && (
        <span className="text-sm text-muted-foreground">
          {progress.count} evaluated
          {progress.bestScore !== null && ` · best: ${progress.bestScore}`}
          {progress.done && ' · done'}
        </span>
      )}

      {!streaming ? (
        <Button size="sm" onClick={() => start(token)} variant="outline">
          <Play className="w-3.5 h-3.5" />
          Start analysis
        </Button>
      ) : (
        <Button size="sm" onClick={stop} variant="outline">
          <Square className="w-3.5 h-3.5" />
          Stop
        </Button>
      )}

      <Button size="sm" onClick={handleAssume} disabled={progress.count === 0}>
        <CheckCircle className="w-3.5 h-3.5" />
        Assume best
      </Button>
    </div>,
    [streaming, progress],
  )

  return (
    <div>
      {/* Progress visualisation / result */}
    </div>
  )
}
```

---

## Implementation Considerations

### Server state — concurrency caution

`ScenarioService` uses in-memory state (`bestScenario`, `count`). This works as long as there is **one active analysis session at a time**. If multiple users can start analyses simultaneously, state must be isolated per job/session:

```typescript
// Alternative: isolated job map
private jobs = new Map<string, { best: Scenario | null; count: number }>()

streamScenarios(jobId: string): Observable<any> {
  this.jobs.set(jobId, { best: null, count: 0 })
  // use this.jobs.get(jobId) throughout processing
}
```

The `jobId` can be generated on the frontend and sent as a query param: `GET /stream?jobId=uuid`.

### Cleanup on disconnect

The `return () => clearInterval(interval)` inside the Observable is the cleanup point when the client closes the tab or navigates away. Without it, processing continues on the server consuming resources unnecessarily. Verify that NestJS cancels the Observable correctly when it detects SSE disconnection — in some scenarios it may be necessary to check `observer.closed` inside the loop.

### Stop criterion: scenario count vs. time limit

The stop criterion can be scenario count (`count >= MAX`) or elapsed time (`Date.now() - startTime >= MAX_MS`). For timetabling, time is usually more predictable from a UX perspective — the user knows that within X seconds they will have a result, regardless of how many scenarios were evaluated.

```typescript
const startTime = Date.now()
const MAX_MS    = 30_000 // 30 seconds

// Inside the interval:
const done = this.count >= MAX_SCENARIOS || (Date.now() - startTime) >= MAX_MS
```

### Persistence of the assumed result

`POST /assume` returns the in-memory `Scenario`. If the process crashes or the server restarts before persistence, the result is lost. Consider persisting `bestScenario` to the database on each update, or at minimum before returning from `/assume`.

### Score visual feedback

Displaying only the raw score number may not be intuitive. Consider normalising to a percentage scale or showing a semantic label (e.g. "Good", "Excellent") based on domain thresholds.

---

## Implementation Checklist

- [ ] Create module `timetabling` in `apps/api/src/modules/`
- [ ] Register `TimetablingModule` in `AppModule`
- [ ] Create `ScenarioService` with `streamScenarios()` and `assumeBest()`
- [ ] Create `ScenarioController` (`@Controller`, not `BaseController`) with `@Sse('stream')` and `@Post('assume')`
- [ ] Decide auth strategy for SSE connection (cookie vs. query param token)
- [ ] Create hook `useScenarioStream` in `apps/web/src/lib/timetabling/`
- [ ] Create page `apps/web/src/app/timetabling/scenarios/page.tsx` with `useTopbarActions`
- [ ] Register shortcut `alt+g` for "Assume best"
- [ ] Decide stop criterion: scenario count vs. maximum time
- [ ] Decide state isolation: singleton or per jobId
- [ ] Ensure Observable cleanup on SSE disconnect
- [ ] Persist `bestScenario` before returning from `/assume`

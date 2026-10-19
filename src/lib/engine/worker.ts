import type { Plan, SimResult } from './types'
import { computeStats, type SimStats } from './stats'
import { runMonteCarlo } from './montecarlo'
import { solveGoalSeek, type GoalSeekRequest, type GoalSeekResult } from './goalSeek'

export type WorkerRequest =
  | { type: 'SIMULATE'; requestId: number; plan: Plan; includeAllRuns?: boolean }
  | { type: 'GOAL_SEEK'; requestId: number; payload: GoalSeekRequest }

export type WorkerResponse =
  | {
      type: 'SIMULATE_DONE'
      requestId: number
      stats: SimStats
      results: SimResult[]
      durationMs: number
    }
  | {
      type: 'GOAL_SEEK_DONE'
      requestId: number
      result: GoalSeekResult
      durationMs: number
    }
  | { type: 'ERROR'; requestId: number; message: string }

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  if (!req || !req.type) return

  const startTime = performance.now()
  try {
    if (req.type === 'SIMULATE') {
      const results = runMonteCarlo(req.plan)
      const stats = computeStats(results)
      const durationMs = performance.now() - startTime

      const response: WorkerResponse = {
        type: 'SIMULATE_DONE',
        requestId: req.requestId,
        stats,
        results: req.includeAllRuns === false ? [] : results,
        durationMs
      }
      self.postMessage(response)
    } else if (req.type === 'GOAL_SEEK') {
      const result = solveGoalSeek(req.payload)
      const durationMs = performance.now() - startTime
      const response: WorkerResponse = {
        type: 'GOAL_SEEK_DONE',
        requestId: req.requestId,
        result,
        durationMs
      }
      self.postMessage(response)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const response: WorkerResponse = {
      type: 'ERROR',
      requestId: req.requestId,
      message
    }
    self.postMessage(response)
  }
}

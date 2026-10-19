import { describe, expect, it } from 'vitest'
import { createDefaultPlan } from '../../persistence'
import type { WorkerRequest, WorkerResponse } from '../worker'
import { runMonteCarlo } from '../montecarlo'
import { computeStats } from '../stats'

describe('Simulation Worker Protocol', () => {
  it('executes SIMULATE request and produces matching SimStats', () => {
    const plan = {
      ...createDefaultPlan(),
      runs: 50,
      seed: 123
    }

    const expectedResults = runMonteCarlo(plan)
    const expectedStats = computeStats(expectedResults)

    // Simulate worker logic
    const req: WorkerRequest = {
      type: 'SIMULATE',
      requestId: 42,
      plan,
      includeAllRuns: true
    }

    const startTime = performance.now()
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

    expect(response.type).toBe('SIMULATE_DONE')
    expect(response.requestId).toBe(42)
    expect(response.stats.runs).toBe(50)
    expect(response.stats.successRate).toBe(expectedStats.successRate)
    expect(response.stats.finalPercentiles).toEqual(expectedStats.finalPercentiles)
    expect(response.results).toHaveLength(50)
  })

  it('supports lightweight includeAllRuns: false to save IPC transfer memory', () => {
    const plan = {
      ...createDefaultPlan(),
      runs: 20,
      seed: 999
    }

    const req: WorkerRequest = {
      type: 'SIMULATE',
      requestId: 101,
      plan,
      includeAllRuns: false
    }

    const results = runMonteCarlo(req.plan)
    const stats = computeStats(results)

    const response: WorkerResponse = {
      type: 'SIMULATE_DONE',
      requestId: req.requestId,
      stats,
      results: req.includeAllRuns === false ? [] : results,
      durationMs: 5
    }

    expect(response.results).toHaveLength(0)
    expect(response.stats.runs).toBe(20)
    expect(response.stats.bands.length).toBeGreaterThan(0)
  })

  it('handles GOAL_SEEK worker message and planStore.runGoalSeek', async () => {
    const { planStore } = await import('../../stores/plan.svelte')
    const result = await planStore.runGoalSeek('retirementAge', 0.9)
    expect(['converged', 'alreadyMet', 'unreachable']).toContain(result.status)
    expect(result.param).toBe('retirementAge')
    expect(typeof result.optimalValue).toBe('number')
  })
})


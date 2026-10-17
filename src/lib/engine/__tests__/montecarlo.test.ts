import { describe, expect, it } from 'vitest'
import type { Plan } from '../types'
import { runMonteCarlo } from '../montecarlo'
import { computeStats } from '../stats'

function basePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    startYear: 2026,
    birthYear: 1977,
    retirementAge: 59,
    lifeExpectancyAge: 79,
    initialPortfolio: 100_000,
    initialCostBasis: 80_000,
    annualIncome: 40_000,
    incomeGrowthRate: 0.02,
    annualExpenses: 25_000,
    inflationRate: 0.02,
    meanReturn: 0.05,
    returnStdDev: 0.15,
    runs: 50,
    seed: 42,
    taxRate: 0.26,
    withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
    events: [],
    ...overrides
  }
}

describe('runMonteCarlo', () => {
  it('stesso seed → risultati identici', () => {
    const plan = basePlan()
    const a = runMonteCarlo(plan)
    const b = runMonteCarlo(plan)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('seed diversi → risultati diversi', () => {
    const a = runMonteCarlo(basePlan({ seed: 42 }))
    const b = runMonteCarlo(basePlan({ seed: 43 }))
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('piano iper-prudente → success rate 100%', () => {
    const plan = basePlan({
      initialPortfolio: 2_000_000,
      initialCostBasis: 2_000_000,
      annualIncome: 0,
      annualExpenses: 30_000,
      retirementAge: 49,
      lifeExpectancyAge: 79,
      meanReturn: 0.05,
      returnStdDev: 0.01,
      runs: 200,
      seed: 7
    })
    const stats = computeStats(runMonteCarlo(plan))
    expect(stats.successRate).toBe(1)
    expect(stats.meanDepletionAge).toBeNull()
  })
})

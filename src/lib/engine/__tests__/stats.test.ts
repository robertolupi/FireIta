import { describe, expect, it } from 'vitest'
import type { Plan } from '../types'
import { runMonteCarlo } from '../montecarlo'
import { computeStats } from '../stats'

function basePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    startYear: 2026,
    birthYear: 1976,
    retirementAge: 50,
    lifeExpectancyAge: 80,
    initialPortfolio: 500_000,
    initialCostBasis: 500_000,
    annualIncome: 0,
    incomeGrowthRate: 0,
    annualExpenses: 30_000,
    inflationRate: 0.02,
    meanReturn: 0.05,
    returnStdDev: 0,
    runs: 10,
    seed: 42,
    taxRate: 0,
    withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
    events: [],
    ...overrides
  }
}

describe('computeStats — KPI sopravvivenza patrimonio vs copertura spese', () => {
  it('array vuoto restituisce valori azzerati e null', () => {
    const stats = computeStats([])
    expect(stats.runs).toBe(0)
    expect(stats.successRate).toBe(0)
    expect(stats.fullCoverageRate).toBe(0)
    expect(stats.cutSpendingRate).toBe(0)
    expect(stats.depletionRate).toBe(0)
    expect(stats.meanDepletionAge).toBeNull()
    expect(stats.meanFirstShortfallAge).toBeNull()
    expect(stats.meanShortfallYears).toBe(0)
  })

  it('invariante di partizione: fullCoverageRate + cutSpendingRate = successRate e successRate + depletionRate = 1', () => {
    const plan = basePlan({
      returnStdDev: 0.16,
      runs: 100,
      seed: 123
    })
    const stats = computeStats(runMonteCarlo(plan))
    expect(stats.fullCoverageRate + stats.cutSpendingRate).toBeCloseTo(stats.successRate, 10)
    expect(stats.successRate + stats.depletionRate).toBeCloseTo(1, 10)
  })

  it('scenario percentCap con cap inferiore alle spese fisse: 100% sopravvivenza ma 0% piena copertura (100% cutSpendingRate)', () => {
    const plan = basePlan({
      returnStdDev: 0,
      meanReturn: 0.05,
      initialPortfolio: 500_000,
      annualExpenses: 30_000,
      withdrawalStrategy: { type: 'percentCap', rate: 0.03 },
      runs: 5
    })
    const stats = computeStats(runMonteCarlo(plan))
    expect(stats.successRate).toBe(1)
    expect(stats.fullCoverageRate).toBe(0)
    expect(stats.cutSpendingRate).toBe(1)
    expect(stats.depletionRate).toBe(0)
    expect(stats.meanFirstShortfallAge).toBe(50)
    expect(stats.meanShortfallYears).toBe(30)
  })

  it('scenario guardrails sotto stress: successRate > fullCoverageRate e meanFirstShortfallAge valido', () => {
    const plan = basePlan({
      initialPortfolio: 500_000,
      annualExpenses: 24_000,
      meanReturn: 0.04,
      returnStdDev: 0.18,
      runs: 200,
      seed: 99,
      withdrawalStrategy: {
        type: 'guardrails',
        initialRate: 0.05,
        lowerGuardrail: 0.04,
        upperGuardrail: 0.06,
        increasePct: 0.1,
        decreasePct: 0.1
      }
    })
    const stats = computeStats(runMonteCarlo(plan))
    expect(stats.successRate).toBeGreaterThan(stats.fullCoverageRate)
    expect(stats.cutSpendingRate).toBeGreaterThan(0)
    expect(stats.meanFirstShortfallAge).not.toBeNull()
    expect(stats.meanFirstShortfallAge as number).toBeGreaterThanOrEqual(50)
    expect(stats.meanFirstShortfallAge as number).toBeLessThanOrEqual(80)
    expect(stats.meanShortfallYears).toBeGreaterThan(0)
  })
})

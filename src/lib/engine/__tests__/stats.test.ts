import { describe, expect, it } from 'vitest'
import type { Plan, SimResult } from '../types'
import { runMonteCarlo } from '../montecarlo'
import { compareSimRuns, computeStats } from '../stats'

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
    expect(stats.percentileRuns.p50).toBeNull()
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

  it('scenario guardrails sotto stress: le spese configurate fanno da pavimento minimo e i run insufficienti vanno in deplezione', () => {
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
    // Con le spese come minimo vitale in guardrails, ogni run che sopravvive copre sempre le spese
    expect(stats.fullCoverageRate).toBeCloseTo(stats.successRate, 10)
    expect(stats.cutSpendingRate).toBe(0)
    expect(stats.depletionRate).toBeGreaterThan(0)
    expect(stats.meanDepletionAge).not.toBeNull()
  })

  it('compareSimRuns ordina le run fallite per anno di sopravvivenza e le sopravvissute per finalPortfolio', () => {
    const makeFakeRun = (run: number, surviveCount: number, total: number, finalPortfolio: number): SimResult => ({
      run,
      years: Array.from({ length: total }, (_, i) => ({
        year: i,
        age: 50 + i,
        calendarYear: 2026 + i,
        phase: 'retirement',
        income: 0,
        expenses: 10_000,
        contribution: 0,
        withdrawal: 10_000,
        grossSale: 10_000,
        taxPaid: 0,
        returnRate: 0,
        investmentReturn: 0,
        startPortfolio: i < surviveCount ? 50_000 : 0,
        endPortfolio: i < surviveCount ? (i === total - 1 ? finalPortfolio : 40_000) : 0,
        endCostBasis: 0,
        expensesNotCovered: i >= surviveCount,
        depleted: i >= surviveCount
      })),
      finalPortfolio,
      depletionYear: surviveCount < total ? surviveCount : null,
      success: surviveCount === total,
      firstShortfallYear: surviveCount < total ? surviveCount : null,
      shortfallYearsCount: total - surviveCount,
      fullCoverage: surviveCount === total
    })

    const runA = makeFakeRun(0, 10, 30, 0)
    const runB = makeFakeRun(1, 20, 30, 0)
    const runC = makeFakeRun(2, 30, 30, 150_000)

    expect(compareSimRuns(runA, runB)).toBeLessThan(0)
    expect(compareSimRuns(runB, runC)).toBeLessThan(0)
    expect(compareSimRuns(runA, runC)).toBeLessThan(0)
  })

  it('percentileRuns popola p10..p90 in ordine monotono e mantiene coerenza contabile intra-traiettoria', () => {
    const plan = basePlan({
      initialPortfolio: 450_000,
      initialCostBasis: 350_000,
      annualExpenses: 22_000,
      taxRate: 0.26,
      stampDutyRate: 0,
      returnStdDev: 0.16,
      runs: 100,
      seed: 77
    })
    const stats = computeStats(runMonteCarlo(plan))
    const keys = ['p10', 'p25', 'p50', 'p75', 'p90'] as const

    expect(stats.percentileRuns.p50).toBe(stats.medianRun)

    for (let i = 0; i < keys.length; i++) {
      const r = stats.percentileRuns[keys[i]]!
      expect(r).not.toBeNull()
      if (i > 0) {
        const prev = stats.percentileRuns[keys[i - 1]]!
        expect(compareSimRuns(prev, r)).toBeLessThanOrEqual(0)
      }
      for (let t = 0; t < r.years.length; t++) {
        const y = r.years[t]
        expect(y.grossSale).toBeCloseTo(y.withdrawal + y.taxPaid, 6)
        if (t > 0) {
          expect(y.startPortfolio).toBeCloseTo(r.years[t - 1].endPortfolio, 6)
        }
      }
    }
  })
})

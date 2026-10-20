import { describe, expect, it } from 'vitest'
import type { Plan } from '../types'
import { runProjection } from '../projection'
import { runMonteCarlo } from '../montecarlo'
import { computeStats } from '../stats'
import {
  deflateYearBand,
  deflateYearState,
  inflationDivisor,
  transformSimStats
} from '../deflate'

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    startYear: 2026,
    birthYear: 1976,
    retirementAge: 50,
    lifeExpectancyAge: 65,
    initialPortfolio: 500_000,
    initialCostBasis: 400_000,
    annualIncome: 0,
    incomeGrowthRate: 0,
    annualExpenses: 24_000,
    inflationRate: 0.02,
    meanReturn: 0.05,
    returnStdDev: 0.12,
    runs: 50,
    seed: 42,
    taxRate: 0.26,
    stampDutyRate: 0.002,
    withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
    events: [],
    ...overrides
  }
}

describe('deflate — Valori Reali vs Nominali', () => {
  it('1. Anno base (t = 0): inflationDivisor = 1 e deflateYearState lascia invariati tutti i campi', () => {
    expect(inflationDivisor(2026, 2026, 0.02)).toBe(1)
    expect(inflationDivisor(0, 2026, 0.02)).toBe(1)

    const plan = makePlan({ lifeExpectancyAge: 52 })
    const [year0] = runProjection(plan, [0.05, 0.05])
    const deflated0 = deflateYearState(year0, 2026, 0.02)
    expect(deflated0).toEqual(year0)
  })

  it('2. Deflazione multi-annuale esatta a t = 10 anni con inflazione 2% (inclusi stampDutyPaid e pensionFundBalance)', () => {
    const d10 = inflationDivisor(2036, 2026, 0.02)
    expect(d10).toBeCloseTo(Math.pow(1.02, 10), 10)
    expect(100_000 / d10).toBeCloseTo(82_034.83, 2)

    const plan = makePlan({
      lifeExpectancyAge: 61,
      pensionFund: {
        initialBalance: 50_000,
        initialSeniorityYears: 15,
        annualContribution: 0,
        irpefMarginalRate: 0.35,
        ritaStartAge: 60,
        ritaEndAge: 65
      }
    })
    const years = runProjection(plan, Array(15).fill(0.04))
    const state10 = years[10]
    expect(state10.calendarYear).toBe(2036)

    const real10 = deflateYearState(state10, 2026, 0.02)
    expect(real10.endPortfolio).toBeCloseTo(state10.endPortfolio / d10, 6)
    expect(real10.expenses).toBeCloseTo(24_000, 6) // spese reali costanti
    expect(real10.stampDutyPaid).toBeCloseTo((state10.stampDutyPaid ?? 0) / d10, 6)
    expect(real10.pensionFundBalance).toBeCloseTo((state10.pensionFundBalance ?? 0) / d10, 6)

    const band10 = deflateYearBand(
      { year: 10, age: 60, p10: 50_000, p25: 75_000, p50: 100_000, p75: 125_000, p90: 150_000 },
      2026,
      0.02
    )
    expect(band10.p50).toBeCloseTo(82_034.83, 2)
  })

  it('3. Preservazione dell’equazione contabile annuale in termini reali', () => {
    const plan = makePlan({ stampDutyRate: 0, lifeExpectancyAge: 55 })
    const years = runProjection(plan, [0.04, 0.05, 0.03, 0.06, 0.02])
    for (const y of years) {
      const s = deflateYearState(y, plan.startYear, plan.inflationRate)
      expect(
        Math.abs(s.startPortfolio + s.investmentReturn + s.contribution - s.grossSale - s.endPortfolio)
      ).toBeLessThan(1e-6)
    }
  })

  it('4. Invarianza con inflazione zero: real e nominal coincidono', () => {
    const plan = makePlan({ inflationRate: 0 })
    const raw = computeStats(runMonteCarlo(plan))
    const real = transformSimStats(raw, plan.startYear, 0, 'real')
    const nominal = transformSimStats(raw, plan.startYear, 0, 'nominal')
    expect(JSON.stringify(real)).toBe(JSON.stringify(nominal))
  })

  it('5. Invarianza di successRate, fullCoverageRate, cutSpendingRate e depletionRate', () => {
    const plan = makePlan({
      initialPortfolio: 300_000,
      annualExpenses: 20_000,
      returnStdDev: 0.18,
      runs: 80
    })
    const raw = computeStats(runMonteCarlo(plan))
    const real = transformSimStats(raw, plan.startYear, plan.inflationRate, 'real')

    expect(real.successRate).toBe(raw.successRate)
    expect(real.fullCoverageRate).toBe(raw.fullCoverageRate)
    expect(real.cutSpendingRate).toBe(raw.cutSpendingRate)
    expect(real.depletionRate).toBe(raw.depletionRate)
    expect(real.meanDepletionAge).toBe(raw.meanDepletionAge)
    expect(real.meanFirstShortfallAge).toBe(raw.meanFirstShortfallAge)
    expect(real.meanShortfallYears).toBe(raw.meanShortfallYears)
    expect(real.finalPercentiles.p50).toBeLessThan(raw.finalPercentiles.p50)
  })

  it('6. Deflazione dei bucket multi-asset e rebalanceTaxPaid', () => {
    const d5 = inflationDivisor(5, 2026, 0.02)
    const state: any = {
      year: 5,
      calendarYear: 2031,
      income: 10_000,
      expenses: 8_000,
      contribution: 2_000,
      withdrawal: 0,
      grossSale: 0,
      taxPaid: 100,
      investmentReturn: 5_000,
      startPortfolio: 100_000,
      endPortfolio: 107_000,
      endCostBasis: 80_000,
      rebalanceTaxPaid: 500,
      buckets: {
        equity: { value: 60_000, costBasis: 40_000 },
        bonds: { value: 30_000, costBasis: 25_000 },
        cash: { value: 17_000, costBasis: 15_000 }
      }
    }

    const deflated = deflateYearState(state, 2026, 0.02)
    expect(deflated.rebalanceTaxPaid).toBeCloseTo(500 / d5, 9)
    expect(deflated.buckets!.equity.value).toBeCloseTo(60_000 / d5, 9)
    expect(deflated.buckets!.equity.costBasis).toBeCloseTo(40_000 / d5, 9)
    expect(deflated.buckets!.bonds.value).toBeCloseTo(30_000 / d5, 9)
    expect(deflated.buckets!.cash.value).toBeCloseTo(17_000 / d5, 9)

    const sumRealBuckets =
      deflated.buckets!.equity.value +
      deflated.buckets!.bonds.value +
      deflated.buckets!.cash.value
    expect(sumRealBuckets).toBeCloseTo(deflated.endPortfolio, 9)
  })
})

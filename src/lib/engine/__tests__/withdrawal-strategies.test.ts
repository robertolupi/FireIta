import { describe, expect, it } from 'vitest'
import type { Plan } from '../types'
import { computeVpwRate, runProjection } from '../projection'

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    startYear: 2026,
    birthYear: 1976,
    retirementAge: 50,
    lifeExpectancyAge: 53,
    initialPortfolio: 100_000,
    initialCostBasis: 100_000,
    annualIncome: 0,
    incomeGrowthRate: 0,
    annualExpenses: 3_000,
    inflationRate: 0.02,
    meanReturn: 0,
    returnStdDev: 0,
    runs: 1,
    seed: 1,
    taxRate: 0,
    withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
    events: [],
    ...overrides
  }
}

describe('strategie di prelievo avanzate (constantDollar, spendExpenses, vpw)', () => {
  it('constantDollar vs percentCap: constantDollar preleva sempre la rata base rivalutata all’inflazione', () => {
    const capPlan = makePlan({
      lifeExpectancyAge: 52,
      annualExpenses: 3_000,
      inflationRate: 0.02,
      withdrawalStrategy: { type: 'percentCap', rate: 0.04 }
    })
    const capYears = runProjection(capPlan, [0, 0])
    expect(capYears[0].withdrawal).toBeCloseTo(3_000)
    expect(capYears[1].withdrawal).toBeCloseTo(3_060)

    const swrPlan = makePlan({
      lifeExpectancyAge: 52,
      annualExpenses: 3_000,
      inflationRate: 0.02,
      withdrawalStrategy: { type: 'constantDollar', rate: 0.04 }
    })
    const swrYears = runProjection(swrPlan, [0, 0])
    expect(swrYears[0].withdrawal).toBeCloseTo(4_000)
    expect(swrYears[1].withdrawal).toBeCloseTo(4_080)
    expect(swrYears.every((y) => !y.expensesNotCovered)).toBe(true)
  })

  it('constantDollar usa le spese come minimo vitale se superano la rata SWR e aggiunge le spese una tantum', () => {
    const plan = makePlan({
      lifeExpectancyAge: 52,
      annualExpenses: 5_000,
      inflationRate: 0,
      withdrawalStrategy: { type: 'constantDollar', rate: 0.04 },
      events: [{ kind: 'oneTimeExpense', atYear: 2026, amount: 1_000 }]
    })
    const years = runProjection(plan, [0, 0])
    expect(years[0].withdrawal).toBeCloseTo(6_000) // max(4000 SWR, 5000 spese) + 1000 oneTime
    expect(years[0].expensesNotCovered).toBe(false)
    expect(years[1].withdrawal).toBeCloseTo(5_000)
  })

  it('spendExpenses preleva esattamente il fabbisogno effettivo senza tetto artificiale', () => {
    const plan = makePlan({
      lifeExpectancyAge: 52,
      annualExpenses: 6_000,
      inflationRate: 0,
      withdrawalStrategy: { type: 'spendExpenses' },
      events: [{ kind: 'oneTimeExpense', atYear: 2026, amount: 2_000 }]
    })
    const years = runProjection(plan, [0, 0])
    expect(years[0].withdrawal).toBeCloseTo(8_000)
    expect(years[0].expensesNotCovered).toBe(false)
    expect(years[1].withdrawal).toBeCloseTo(6_000)
    expect(years[1].expensesNotCovered).toBe(false)
  })

  it('vpw ammortizza esattamente il portafoglio lungo l’orizzonte residuo con realReturnRate = 0', () => {
    const plan = makePlan({
      retirementAge: 50,
      lifeExpectancyAge: 53,
      annualExpenses: 20_000,
      inflationRate: 0,
      withdrawalStrategy: {
        type: 'vpw',
        realReturnRate: 0,
        legacyFraction: 0
      }
    })
    const years = runProjection(plan, [0, 0, 0])
    expect(years).toHaveLength(3)
    expect(years[0].withdrawal).toBeCloseTo(100_000 / 3, 2)
    expect(years[0].endPortfolio).toBeCloseTo(66_666.67, 2)
    expect(years[1].withdrawal).toBeCloseTo(100_000 / 3, 2)
    expect(years[1].endPortfolio).toBeCloseTo(33_333.33, 2)
    expect(years[2].withdrawal).toBeCloseTo(100_000 / 3, 2)
    expect(years[2].endPortfolio).toBeCloseTo(0, 2)
    expect(years.every((y) => !y.expensesNotCovered)).toBe(true)
  })

  it('vpw rispetta legacyFraction lasciando la frazione di eredità desiderata a fine orizzonte', () => {
    const plan = makePlan({
      retirementAge: 50,
      lifeExpectancyAge: 51,
      annualExpenses: 50_000,
      inflationRate: 0,
      withdrawalStrategy: {
        type: 'vpw',
        realReturnRate: 0,
        legacyFraction: 0.25
      }
    })
    const years = runProjection(plan, [0])
    expect(years[0].withdrawal).toBeCloseTo(75_000)
    expect(years[0].endPortfolio).toBeCloseTo(25_000)
  })

  it('computeVpwRate applica la formula PMT attuariale e rispetta minRate/maxRate', () => {
    // r = 3.5%, N = 30 -> ~5.249%
    const r30 = computeVpwRate(30, 0.035)
    expect(r30).toBeCloseTo(0.035 / (1.035 * (1 - Math.pow(1.035, -30))), 6)
    expect(r30).toBeCloseTo(0.05249, 4)

    // r = 3.5%, N = 10 -> ~11.618%
    const r10 = computeVpwRate(10, 0.035)
    expect(r10).toBeCloseTo(0.11618, 4)

    // Clamping tra minRate e maxRate
    expect(computeVpwRate(30, 0.035, 0, 0.06, 0.1)).toBeCloseTo(0.06)
    expect(computeVpwRate(10, 0.035, 0, 0.04, 0.08)).toBeCloseTo(0.08)
  })
})

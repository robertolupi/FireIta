import { describe, expect, it } from 'vitest'
import type { Plan } from '../types'
import { runProjection } from '../projection'

function guardrailsPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    startYear: 2026,
    birthYear: 1977,
    retirementAge: 49,
    lifeExpectancyAge: 54,
    initialPortfolio: 10_000,
    initialCostBasis: 10_000,
    annualIncome: 0,
    incomeGrowthRate: 0,
    annualExpenses: 0,
    inflationRate: 0,
    meanReturn: 0,
    returnStdDev: 0,
    runs: 1,
    seed: 1,
    taxRate: 0,
    withdrawalStrategy: {
      type: 'guardrails',
      initialRate: 0.05,
      lowerGuardrail: 0.04,
      upperGuardrail: 0.06,
      increasePct: 0.1,
      decreasePct: 0.1
    },
    events: [],
    ...overrides
  }
}

describe('strategia guardrails', () => {
  it('prelievo iniziale = initialRate × capitale a inizio fase', () => {
    const years = runProjection(guardrailsPlan(), [0, 0, 0, 0, 0])
    expect(years[0].withdrawal).toBeCloseTo(500)
    expect(years[0].endPortfolio).toBeCloseTo(9_500)
  })

  it('tra i guardrail il prelievo resta invariato', () => {
    const years = runProjection(guardrailsPlan({ lifeExpectancyAge: 52 }), [0, 0, 0])
    expect(years[1].withdrawal).toBeCloseTo(500)
    expect(years[2].withdrawal).toBeCloseTo(500)
    expect(years[2].endPortfolio).toBeCloseTo(8_500)
    expect(years.every((y) => !y.depleted)).toBe(true)
  })

  it('portafoglio in forte crescita → tasso < guardrail inferiore → aumento +10% esatto', () => {
    const years = runProjection(guardrailsPlan(), [0, 1, 0, 0, 0])
    expect(years[1].withdrawal).toBeCloseTo(550)
    expect(years[1].endPortfolio).toBeCloseTo(18_450)
  })

  it('portafoglio in calo → tasso > guardrail superiore → riduzione −10% esatta', () => {
    const years = runProjection(guardrailsPlan(), [0, -0.5, 0, 0, 0])
    expect(years[1].withdrawal).toBeCloseTo(450)
    expect(years[1].endPortfolio).toBeCloseTo(4_300)
  })

  it('expensesNotCovered quando il prelievo guardrails scende sotto le spese', () => {
    const covered = runProjection(guardrailsPlan({ annualExpenses: 400 }), [0, 0])
    expect(covered[0].expensesNotCovered).toBe(false)

    const uncovered = runProjection(guardrailsPlan({ annualExpenses: 600 }), [0, 0])
    expect(uncovered[0].withdrawal).toBeCloseTo(500)
    expect(uncovered[0].expensesNotCovered).toBe(true)
    expect(uncovered[1].expensesNotCovered).toBe(true)
  })

  it('spese una tantum: vendita extra che non modifica il prelievo guardrails', () => {
    const plan = guardrailsPlan({
      events: [{ kind: 'oneTimeExpense', atYear: 2026, amount: 1_000 }]
    })
    const years = runProjection(plan, [0, 0, 0, 0, 0])
    expect(years[0].withdrawal).toBeCloseTo(1_500)
    expect(years[0].endPortfolio).toBeCloseTo(8_500)
    expect(years[0].expensesNotCovered).toBe(false)
    expect(years[1].withdrawal).toBeCloseTo(500)
  })

  it('con inflazione positiva entro il corridoio rivaluta il prelievo e mantiene il potere d’acquisto', () => {
    const plan = guardrailsPlan({
      lifeExpectancyAge: 52,
      initialPortfolio: 100_000,
      initialCostBasis: 100_000,
      annualExpenses: 4_800,
      inflationRate: 0.02
    })
    const years = runProjection(plan, [0.07, 0.07, 0.07])
    expect(years[0].withdrawal).toBeCloseTo(5_000)
    expect(years[1].withdrawal).toBeCloseTo(5_100)
    expect(years[2].withdrawal).toBeCloseTo(5_202)
    expect(years.every((y) => !y.expensesNotCovered)).toBe(true)
  })

  it('skipInflationAfterNegativeReturn salta l’adeguamento inflattivo dopo un anno con rendimento negativo', () => {
    const plan = guardrailsPlan({
      lifeExpectancyAge: 52,
      initialPortfolio: 100_000,
      initialCostBasis: 100_000,
      annualExpenses: 4_800,
      inflationRate: 0.03,
      withdrawalStrategy: {
        type: 'guardrails',
        initialRate: 0.05,
        lowerGuardrail: 0.04,
        upperGuardrail: 0.06,
        increasePct: 0.1,
        decreasePct: 0.1,
        skipInflationAfterNegativeReturn: true
      }
    })
    const years = runProjection(plan, [-0.05, 0.06, 0.06])
    expect(years[0].withdrawal).toBeCloseTo(5_000)
    // Anno 1: returns[0] = -0.05 < 0 -> salta inflazione (+3%), 5000 / 95400 = 5.24% (entro [4%, 6%])
    expect(years[1].withdrawal).toBeCloseTo(5_000)
    // Anno 2: returns[1] = +0.06 >= 0 -> applica inflazione (+3%) -> 5150
    expect(years[2].withdrawal).toBeCloseTo(5_150)
  })
})

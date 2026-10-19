import { describe, expect, it } from 'vitest'
import { createDefaultPlan } from '../../persistence'
import type { Plan } from '../types'
import { evaluateSuccessRate, solveGoalSeek } from '../goalSeek'

function basePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    ...createDefaultPlan(),
    runs: 500,
    seed: 42,
    ...overrides
  }
}

describe('Goal Seek (Risolutore Inverso)', () => {
  it('converge esattamente su annualExpenses rispettando la tolleranza e lottimalita', () => {
    const plan = basePlan({
      startYear: 2026,
      birthYear: 1986, // 40 anni
      retirementAge: 40, // Già in pensione
      lifeExpectancyAge: 85,
      initialPortfolio: 1_000_000,
      initialCostBasis: 800_000,
      annualIncome: 0,
      taxRate: 0.26,
      runs: 500,
      seed: 42
    })

    const tolerance = 50
    const targetSuccessRate = 0.9

    const result = solveGoalSeek({
      plan,
      param: 'annualExpenses',
      targetSuccessRate,
      tolerance,
      maxIterations: 25
    })

    expect(result.status).toBe('converged')
    expect(result.param).toBe('annualExpenses')
    expect(result.optimalValue).toBeGreaterThan(10_000)
    expect(result.optimalValue).toBeLessThan(100_000)

    // Verifica diretta: con il valore ottimo il tasso è >= 0.90
    const optimalPlan = { ...plan, annualExpenses: result.optimalValue }
    const rateAtOptimal = evaluateSuccessRate(optimalPlan)
    expect(rateAtOptimal).toBeGreaterThanOrEqual(targetSuccessRate)

    // Verifica di ottimalità: spendendo di più (oltre la tolleranza), il tasso scende sotto il target
    const excessivePlan = { ...plan, annualExpenses: result.optimalValue + tolerance }
    const rateAtExcessive = evaluateSuccessRate(excessivePlan)
    expect(rateAtExcessive).toBeLessThan(targetSuccessRate)
  })

  it('converge in modo discreto alleta minima di pensionamento retirementAge', () => {
    // Utente di 35 anni (2026 - 1991 = 35)
    const plan = basePlan({
      startYear: 2026,
      birthYear: 1991,
      retirementAge: 65,
      lifeExpectancyAge: 90,
      initialPortfolio: 150_000,
      initialCostBasis: 120_000,
      annualIncome: 45_000,
      incomeGrowthRate: 0.01,
      annualExpenses: 25_000,
      meanReturn: 0.05,
      returnStdDev: 0.12,
      runs: 400,
      seed: 42
    })

    const targetSuccessRate = 0.95

    const result = solveGoalSeek({
      plan,
      param: 'retirementAge',
      targetSuccessRate,
      maxIterations: 20
    })

    expect(result.status).toBe('converged')
    expect(result.param).toBe('retirementAge')
    expect(Number.isInteger(result.optimalValue)).toBe(true)
    expect(result.optimalValue).toBeGreaterThan(35)
    expect(result.optimalValue).toBeLessThan(90)
    expect(result.iterations).toBeLessThanOrEqual(8) // Ricerca binaria in <= 8 iterazioni

    // A età A*, il tasso è >= 0.95
    const atOptimal = { ...plan, retirementAge: result.optimalValue }
    expect(evaluateSuccessRate(atOptimal)).toBeGreaterThanOrEqual(targetSuccessRate)

    // A età A* - 1, il tasso scende sotto 0.95
    const atPriorYear = { ...plan, retirementAge: result.optimalValue - 1 }
    expect(evaluateSuccessRate(atPriorYear)).toBeLessThan(targetSuccessRate)
  })

  it('gestisce i casi limite alreadyMet e unreachable', () => {
    // Caso 1: alreadyMet con patrimonio enorme
    const richPlan = basePlan({
      startYear: 2026,
      birthYear: 1986,
      retirementAge: 65,
      initialPortfolio: 10_000_000,
      annualExpenses: 20_000,
      runs: 200,
      seed: 123
    })

    const metResult = solveGoalSeek({
      plan: richPlan,
      param: 'retirementAge',
      targetSuccessRate: 0.95
    })

    expect(metResult.status).toBe('alreadyMet')
    expect(metResult.optimalValue).toBe(40) // Età attuale (2026 - 1986)
    expect(metResult.achievedSuccessRate).toBeGreaterThanOrEqual(0.95)

    // Caso 2: unreachable con 0 patrimonio, poco reddito e spese altissime
    const poorPlan = basePlan({
      startYear: 2026,
      birthYear: 1991, // 35 anni
      retirementAge: 65,
      lifeExpectancyAge: 90,
      initialPortfolio: 0,
      annualIncome: 10_000,
      annualExpenses: 50_000,
      runs: 200,
      seed: 777
    })

    const unreachableResult = solveGoalSeek({
      plan: poorPlan,
      param: 'retirementAge',
      targetSuccessRate: 0.95,
      minBound: 35,
      maxBound: 89
    })

    expect(unreachableResult.status).toBe('unreachable')
    expect(unreachableResult.achievedSuccessRate).toBeLessThan(0.95)
  })

  it('risolve initialPortfolio trovando il capitale minimo richiesto', () => {
    const plan = basePlan({
      startYear: 2026,
      birthYear: 1986,
      retirementAge: 40,
      lifeExpectancyAge: 80,
      initialPortfolio: 0,
      initialCostBasis: 0,
      annualIncome: 0,
      annualExpenses: 30_000,
      runs: 300,
      seed: 101
    })

    const result = solveGoalSeek({
      plan,
      param: 'initialPortfolio',
      targetSuccessRate: 0.9,
      tolerance: 2_000
    })

    expect(result.status).toBe('converged')
    expect(result.optimalValue).toBeGreaterThan(400_000)
    expect(result.optimalValue).toBeLessThan(2_500_000)

    const optPlan = { ...plan, initialPortfolio: result.optimalValue }
    expect(evaluateSuccessRate(optPlan)).toBeGreaterThanOrEqual(0.9)
  })
})

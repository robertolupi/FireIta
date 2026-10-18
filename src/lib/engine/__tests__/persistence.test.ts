import { describe, expect, it } from 'vitest'
import {
  createDefaultPlan,
  decodePlanFromUrlParam,
  encodePlanToUrlParam,
  exportYearsToCsv,
  sanitizePlan
} from '../../persistence'
import { runProjection } from '../projection'
import type { Plan } from '../types'

describe('persistence', () => {
  it('round-trips a Plan with guardrails and all LifeEvent types through URL param', () => {
    const plan: Plan = {
      ...createDefaultPlan(),
      startYear: 2026,
      birthYear: 1980,
      retirementAge: 60,
      lifeExpectancyAge: 92,
      initialPortfolio: 250_000,
      initialCostBasis: 180_000,
      stampDutyRate: 0.002,
      whitelistAllocation: 0.3,
      pensionFund: {
        initialBalance: 30_000,
        initialTaxableBase: 25_000,
        initialSeniorityYears: 12,
        annualContribution: 5164.57,
        irpefMarginalRate: 0.35,
        returnRateOffset: -0.01,
        ritaStartAge: 57,
        ritaEndAge: 67
      },
      withdrawalStrategy: {
        type: 'guardrails',
        initialRate: 0.045,
        lowerGuardrail: 0.035,
        upperGuardrail: 0.055,
        increasePct: 0.1,
        decreasePct: 0.1,
        skipInflationAfterNegativeReturn: true
      },
      events: [
        { kind: 'setExpenses', fromYear: 2036, amount: 22_000 },
        { kind: 'oneTimeExpense', atYear: 2032, amount: 15_000 },
        { kind: 'stopWorking', atYear: 2035 },
        {
          kind: 'recurringIncome',
          fromYear: 2047,
          toYear: 2070,
          amount: 18_000,
          inflationAdjusted: true
        }
      ]
    }

    const encoded = encodePlanToUrlParam(plan)
    const decoded = decodePlanFromUrlParam(encoded)
    expect(decoded).toEqual(plan)
  })

  it('round-trips all other withdrawal strategies (constantDollar, spendExpenses, vpw)', () => {
    const base = createDefaultPlan()

    const constantDollarPlan: Plan = {
      ...base,
      withdrawalStrategy: { type: 'constantDollar', rate: 0.038 }
    }
    expect(decodePlanFromUrlParam(encodePlanToUrlParam(constantDollarPlan))).toEqual(
      constantDollarPlan
    )

    const spendExpensesPlan: Plan = {
      ...base,
      withdrawalStrategy: { type: 'spendExpenses' }
    }
    expect(decodePlanFromUrlParam(encodePlanToUrlParam(spendExpensesPlan))).toEqual(
      spendExpensesPlan
    )

    const vpwPlan: Plan = {
      ...base,
      withdrawalStrategy: {
        type: 'vpw',
        realReturnRate: 0.03,
        legacyFraction: 0.2,
        minRate: 0.025,
        maxRate: 0.08
      }
    }
    expect(decodePlanFromUrlParam(encodePlanToUrlParam(vpwPlan))).toEqual(vpwPlan)
  })

  it('sanitizes corrupted or out-of-range inputs safely', () => {
    const def = createDefaultPlan()
    expect(sanitizePlan(null)).toEqual(def)
    expect(sanitizePlan({})).toEqual(def)

    const corrupted = sanitizePlan({
      startYear: 2026,
      retirementAge: 'non-un-numero',
      runs: 99_999_999,
      taxRate: 5,
      events: [
        { kind: 'unknown' },
        { kind: 'setExpenses', fromYear: 2030, amount: 20_000 },
        { kind: 'oneTimeExpense', atYear: 'bad', amount: 1000 }
      ]
    })

    expect(corrupted.retirementAge).toBe(def.retirementAge)
    expect(corrupted.runs).toBe(10_000)
    expect(corrupted.taxRate).toBe(1)
    expect(corrupted.events).toEqual([{ kind: 'setExpenses', fromYear: 2030, amount: 20_000 }])
    expect(decodePlanFromUrlParam('!!!not-base64!!!')).toBeNull()
  })

  it('exports YearState[] to CSV with header + 5 rows of 16 columns', () => {
    const plan: Plan = {
      ...createDefaultPlan(),
      startYear: 2026,
      birthYear: 1986,
      retirementAge: 65,
      lifeExpectancyAge: 45
    }
    // 5-year horizon: age 40, 41, 42, 43, 44
    const years = runProjection(plan, [0.05, 0.04, -0.02, 0.06, 0.05])
    expect(years).toHaveLength(5)

    const csv = exportYearsToCsv(years)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(6)
    for (const line of lines) {
      expect(line.split(',')).toHaveLength(16)
    }
    expect(lines[0]).toContain('Anno,Eta,Fase,PatrimonioInizio')
  })
})

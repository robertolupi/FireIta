import { describe, expect, it } from 'vitest'
import type { Plan } from '../types'
import {
  applyStampDuty,
  effectiveCapitalGainsTaxRate,
  pensionFundTaxRate
} from '../tax'
import { runProjection } from '../projection'

function basePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    startYear: 2026,
    birthYear: 1976,
    retirementAge: 50,
    lifeExpectancyAge: 70,
    initialPortfolio: 100_000,
    initialCostBasis: 100_000,
    annualIncome: 0,
    incomeGrowthRate: 0,
    annualExpenses: 0,
    inflationRate: 0,
    meanReturn: 0,
    returnStdDev: 0,
    runs: 1,
    seed: 1,
    taxRate: 0.26,
    withdrawalStrategy: { type: 'percentCap', rate: 0.1 },
    events: [],
    ...overrides
  }
}

describe('Fiscalità e Previdenza Italiana (Bollo 0,20%, White List, INPS, Fondo Pensione / RITA)', () => {
  it('Caso 1: imposta di bollo 0,20% con rendimento nullo e guadagno nullo', () => {
    const plan = basePlan({
      lifeExpectancyAge: 51,
      initialPortfolio: 100_000,
      initialCostBasis: 100_000,
      annualExpenses: 0,
      taxRate: 0.26,
      stampDutyRate: 0.002
    })
    const years = runProjection(plan, [0])
    expect(years).toHaveLength(1)
    expect(years[0].endPortfolio).toBeCloseTo(99_800, 5)
    expect(years[0].endCostBasis).toBeCloseTo(99_800, 5)
    expect(years[0].taxPaid).toBeCloseTo(200, 5)
    expect(years[0].stampDutyPaid).toBeCloseTo(200, 5)
  })

  it('Caso 2: imposta di bollo + vendita in presenza di plusvalenza preserva gainFraction', () => {
    const plan = basePlan({
      lifeExpectancyAge: 52,
      initialPortfolio: 200_000,
      initialCostBasis: 100_000,
      stampDutyRate: 0.002,
      taxRate: 0.26,
      annualExpenses: 10_000,
      withdrawalStrategy: { type: 'percentCap', rate: 0.1 }
    })
    const years = runProjection(plan, [0, 0])

    // Anno 0: vendita per ottenere 10.000 € netti con g = 50%
    const expectedGross = 10_000 / (1 - 0.26 * 0.5)
    const preStamp = 200_000 - expectedGross
    const expectedStamp = preStamp * 0.002
    expect(years[0].grossSale).toBeCloseTo(expectedGross, 2)
    expect(years[0].stampDutyPaid).toBeCloseTo(expectedStamp, 2)
    expect(years[0].endPortfolio).toBeCloseTo(preStamp - expectedStamp, 2)

    // Frazione di plusvalenza a fine anno 0 (e inizio anno 1) deve restare esattamente 0.50
    const gainFractionEndYear0 =
      (years[0].endPortfolio - years[0].endCostBasis) / years[0].endPortfolio
    expect(gainFractionEndYear0).toBeCloseTo(0.5, 9)

    const sdZero = applyStampDuty(100, 50, 0)
    expect(sdZero.stampDuty).toBe(0)
  })

  it('Caso 3: aliquota effettiva mista (60% Azioni al 26% / 40% Titoli di Stato White List al 12,5%)', () => {
    expect(effectiveCapitalGainsTaxRate(0.26, 0.4)).toBeCloseTo(0.206, 6)

    const plan = basePlan({
      lifeExpectancyAge: 51,
      initialPortfolio: 100_000,
      initialCostBasis: 0,
      taxRate: 0.26,
      whitelistAllocation: 0.4,
      annualExpenses: 7_940,
      withdrawalStrategy: { type: 'percentCap', rate: 0.2 }
    })
    const years = runProjection(plan, [0])
    expect(years[0].grossSale).toBeCloseTo(10_000, 4)
    expect(years[0].taxPaid).toBeCloseTo(2_060, 4)
    expect(years[0].withdrawal).toBeCloseTo(7_940, 4)
  })

  it('Caso 4: pensione pubblica INPS post-ritiro (recurringIncome indicizzata all’inflazione)', () => {
    const plan = basePlan({
      startYear: 2026,
      birthYear: 1976,
      retirementAge: 50,
      lifeExpectancyAge: 70,
      initialPortfolio: 2_000_000,
      initialCostBasis: 2_000_000,
      annualExpenses: 30_000,
      inflationRate: 0.02,
      taxRate: 0,
      withdrawalStrategy: { type: 'percentCap', rate: 0.05 },
      events: [
        {
          kind: 'recurringIncome',
          fromYear: 2043,
          amount: 20_000,
          inflationAdjusted: true
        }
      ]
    })
    const years = runProjection(plan, Array(20).fill(0))

    // Anni 0..16 (età 50..66): nessuna pensione, preleva l'intero fabbisogno 30.000 * 1.02^t
    expect(years[0].income).toBe(0)
    expect(years[0].withdrawal).toBeCloseTo(30_000, 2)
    expect(years[16].income).toBe(0)
    expect(years[16].withdrawal).toBeCloseTo(30_000 * Math.pow(1.02, 16), 2)

    // Anno 17 (calendarYear 2043, età 67): pensione INPS = 20.000 * 1.02^17, prelievo = 10.000 * 1.02^17
    const factor17 = Math.pow(1.02, 17)
    expect(years[17].age).toBe(67)
    expect(years[17].income).toBeCloseTo(20_000 * factor17, 2)
    expect(years[17].withdrawal).toBeCloseTo(10_000 * factor17, 2)
    expect(years[17].expensesNotCovered).toBe(false)

    // Se la pensione supera le spese (amount = 35.000), withdrawal = 0 e il surplus è versato (contribution > 0)
    const surplusPlan = basePlan({
      ...plan,
      events: [
        {
          kind: 'recurringIncome',
          fromYear: 2043,
          amount: 35_000,
          inflationAdjusted: true
        }
      ]
    })
    const surplusYears = runProjection(surplusPlan, Array(20).fill(0))
    expect(surplusYears[17].withdrawal).toBe(0)
    expect(surplusYears[17].contribution).toBeCloseTo(5_000 * factor17, 2)
  })

  it('Caso 5: tassazione Fondo Pensione (15% → 9%) e ponte RITA riducono i prelievi dal dossier ETF', () => {
    expect(pensionFundTaxRate(10)).toBeCloseTo(0.15, 6)
    expect(pensionFundTaxRate(15)).toBeCloseTo(0.15, 6)
    expect(pensionFundTaxRate(20)).toBeCloseTo(0.135, 6)
    expect(pensionFundTaxRate(35)).toBeCloseTo(0.09, 6)
    expect(pensionFundTaxRate(40)).toBeCloseTo(0.09, 6)

    const withoutRita = basePlan({
      startYear: 2026,
      birthYear: 1969, // età 57 nel 2026
      retirementAge: 57,
      lifeExpectancyAge: 60,
      initialPortfolio: 200_000,
      initialCostBasis: 200_000,
      annualExpenses: 25_000,
      taxRate: 0,
      withdrawalStrategy: { type: 'spendExpenses' }
    })
    const withRita = basePlan({
      ...withoutRita,
      pensionFund: {
        initialBalance: 60_000,
        initialSeniorityYears: 35, // aliquota minima 9%
        annualContribution: 0,
        irpefMarginalRate: 0.35,
        ritaStartAge: 57,
        ritaEndAge: 59
      }
    })

    const yearsNoRita = runProjection(withoutRita, [0, 0, 0])
    const yearsWithRita = runProjection(withRita, [0, 0, 0])

    // Con RITA attiva (60.000 / 3 = 20.000 lordi/anno -> 18.200 netti al 9%),
    // il prelievo dal dossier titoli scende da 25.000 € a 6.800 €/anno
    expect(yearsWithRita[0].income).toBeCloseTo(20_000 * (1 - 0.09), 2)
    expect(yearsWithRita[0].withdrawal).toBeCloseTo(25_000 - 18_200, 2)
    expect(yearsWithRita[2].pensionFundBalance).toBeCloseTo(0, 5)
    expect(yearsWithRita[2].endPortfolio).toBeGreaterThan(yearsNoRita[2].endPortfolio)
  })
})

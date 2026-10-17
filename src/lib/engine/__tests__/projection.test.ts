import { describe, expect, it } from 'vitest'
import type { Plan } from '../types'
import { currentAge, effectiveStopYear, horizonYears, runProjection } from '../projection'

function basePlan(overrides: Partial<Plan> = {}): Plan {
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
    withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
    events: [],
    ...overrides
  }
}

describe('derivazioni da età', () => {
  it('deriva stopYear e orizzonte da birthYear/retirementAge/lifeExpectancyAge', () => {
    const plan = basePlan({ retirementAge: 67, lifeExpectancyAge: 95 })

    expect(currentAge(plan)).toBe(49)
    expect(effectiveStopYear(plan)).toBe(18)
    expect(horizonYears(plan)).toBe(46)

    const years = runProjection(plan, Array(46).fill(0))
    expect(years).toHaveLength(46)
    expect(years[0].age).toBe(49)
    expect(years[0].calendarYear).toBe(2026)
    expect(years[17].phase).toBe('accumulation')
    expect(years[18].phase).toBe('retirement')
    expect(years[18].age).toBe(67)
    expect(years[18].calendarYear).toBe(2044)
    expect(years[45].age).toBe(94)
    expect(years[45].calendarYear).toBe(2071)
  })

  it('retirementAge ≤ età attuale → già in pensione (stop clampato a 0)', () => {
    const plan = basePlan({ retirementAge: 40, annualExpenses: 300 })
    const years = runProjection(plan, [0, 0, 0, 0, 0])

    expect(effectiveStopYear(plan)).toBe(0)
    expect(years[0].phase).toBe('retirement')
    expect(years[0].withdrawal).toBeCloseTo(300)
  })

  it('retirementAge ≥ lifeExpectancyAge → fase di non-lavoro assente, nessun errore', () => {
    const plan = basePlan({ retirementAge: 95, lifeExpectancyAge: 95, annualIncome: 5_000, annualExpenses: 3_000 })
    const years = runProjection(plan, Array(horizonYears(plan)).fill(0))

    expect(years).toHaveLength(46)
    expect(years.every((y) => y.phase === 'accumulation')).toBe(true)
    expect(years[45].endPortfolio).toBeCloseTo(10_000 + 46 * 2_000)
    expect(years.every((y) => !y.depleted)).toBe(true)
  })

  it('orizzonte minimo di 1 anno se lifeExpectancy già raggiunta', () => {
    const plan = basePlan({ lifeExpectancyAge: 49 })
    expect(horizonYears(plan)).toBe(1)
    expect(runProjection(plan, [0])).toHaveLength(1)
  })
})

describe('runProjection', () => {
  it('scenario deterministico: rendimento 0%, cost basis pieno, spese = tetto 4%', () => {
    const plan = basePlan({ taxRate: 0.26, annualExpenses: 400 })
    const years = runProjection(plan, [0, 0, 0, 0, 0])

    expect(years).toHaveLength(5)
    expect(years[0].withdrawal).toBeCloseTo(400)
    expect(years[0].taxPaid).toBeCloseTo(0)
    expect(years[0].endPortfolio).toBeCloseTo(9_600)
    expect(years[4].endPortfolio).toBeCloseTo(8_000)
    expect(years[4].endCostBasis).toBeCloseTo(8_000)
    expect(years.every((y) => !y.depleted)).toBe(true)
    expect(years.every((y) => !y.expensesNotCovered)).toBe(true)
  })

  it('prelievo = spese quando le spese sono sotto il tetto', () => {
    const plan = basePlan({ annualExpenses: 300 })
    const years = runProjection(plan, [0, 0, 0, 0, 0])

    expect(years[0].withdrawal).toBeCloseTo(300)
    expect(years[0].endPortfolio).toBeCloseTo(9_700)
    expect(years[4].endPortfolio).toBeCloseTo(8_500)
    expect(years[0].expensesNotCovered).toBe(false)
  })

  it('prelievo cappato al tetto quando le spese superano il tetto', () => {
    const plan = basePlan({ annualExpenses: 600 })
    const years = runProjection(plan, [0, 0, 0, 0, 0])

    expect(years[0].withdrawal).toBeCloseTo(400)
    expect(years[0].endPortfolio).toBeCloseTo(9_600)
    expect(years[0].expensesNotCovered).toBe(true)
    expect(years.every((y) => y.expensesNotCovered)).toBe(true)
  })

  it('il tetto si rivaluta con l\'inflazione', () => {
    const plan = basePlan({ inflationRate: 0.1, annualExpenses: 100_000, lifeExpectancyAge: 52 })
    const years = runProjection(plan, [0, 0, 0])

    expect(years[0].withdrawal).toBeCloseTo(400)
    expect(years[1].withdrawal).toBeCloseTo(440)
    expect(years[2].withdrawal).toBeCloseTo(484)
    expect(years[2].endPortfolio).toBeCloseTo(8_676)
  })

  it('le spese una tantum rientrano nel fabbisogno soggetto al tetto', () => {
    const plan = basePlan({
      annualExpenses: 100,
      lifeExpectancyAge: 51,
      events: [{ kind: 'oneTimeExpense', atYear: 2026, amount: 250 }]
    })
    const years = runProjection(plan, [0, 0])

    expect(years[0].withdrawal).toBeCloseTo(350)
    expect(years[0].expensesNotCovered).toBe(false)
    expect(years[1].withdrawal).toBeCloseTo(100)

    const capped = basePlan({
      annualExpenses: 100,
      lifeExpectancyAge: 51,
      events: [{ kind: 'oneTimeExpense', atYear: 2026, amount: 500 }]
    })
    const cappedYears = runProjection(capped, [0, 0])
    expect(cappedYears[0].withdrawal).toBeCloseTo(400)
    expect(cappedYears[0].expensesNotCovered).toBe(true)
  })

  it('evento con età convertita in anno civile si applica all\'anno giusto', () => {
    const plan = basePlan({
      retirementAge: 60,
      lifeExpectancyAge: 55,
      events: [{ kind: 'oneTimeExpense', atYear: 2028, amount: 1_000 }]
    })
    const years = runProjection(plan, Array(6).fill(0))

    expect(years[1].withdrawal).toBeCloseTo(0)
    expect(years[1].endPortfolio).toBeCloseTo(10_000)
    expect(years[2].calendarYear).toBe(2028)
    expect(years[2].withdrawal).toBeCloseTo(1_000)
    expect(years[2].endPortfolio).toBeCloseTo(9_000)
  })

  it('fase di accumulo: contributi, crescita e passaggio alla fase senza lavoro', () => {
    const plan = basePlan({
      retirementAge: 51,
      lifeExpectancyAge: 52,
      annualIncome: 5_000,
      annualExpenses: 3_000,
      taxRate: 0
    })
    const years = runProjection(plan, [0.1, 0.1, 0.1])

    expect(years[0].contribution).toBeCloseTo(2_000)
    expect(years[0].endPortfolio).toBeCloseTo(13_200)
    expect(years[0].endCostBasis).toBeCloseTo(12_000)

    expect(years[1].endPortfolio).toBeCloseTo(16_720)
    expect(years[1].endCostBasis).toBeCloseTo(14_000)

    expect(years[2].phase).toBe('retirement')
    expect(years[2].withdrawal).toBeCloseTo(668.8)
    expect(years[2].expensesNotCovered).toBe(true)
    expect(years[2].endPortfolio).toBeCloseTo(17_723.2)
  })

  it('eventi: oneTimeExpense in accumulo e stopWorking anticipato', () => {
    const plan = basePlan({
      retirementAge: 52,
      lifeExpectancyAge: 54,
      annualIncome: 5_000,
      annualExpenses: 3_000,
      events: [
        { kind: 'oneTimeExpense', atYear: 2026, amount: 1_000 },
        { kind: 'stopWorking', atYear: 2027 },
        { kind: 'setExpenses', fromYear: 2027, amount: 2_000 }
      ]
    })
    const years = runProjection(plan, [0, 0, 0, 0, 0])

    expect(years[0].endPortfolio).toBeCloseTo(11_000)
    expect(years[0].expensesNotCovered).toBe(false)
    expect(years[1].phase).toBe('retirement')
    expect(years[1].withdrawal).toBeCloseTo(440)
    expect(years[1].expensesNotCovered).toBe(true)
    expect(years[1].endPortfolio).toBeCloseTo(10_560)
    expect(years[2].withdrawal).toBeCloseTo(440)
    expect(years[2].endPortfolio).toBeCloseTo(10_120)
  })

  it('segna deplezione e spese non coperte quando il patrimonio si esaurisce', () => {
    const plan = basePlan({
      initialPortfolio: 1_000,
      initialCostBasis: 1_000,
      retirementAge: 54,
      lifeExpectancyAge: 54,
      annualExpenses: 500
    })
    const years = runProjection(plan, [0, 0, 0, 0, 0])

    expect(years[0].endPortfolio).toBeCloseTo(500)
    expect(years[1].depleted).toBe(true)
    expect(years[4].endPortfolio).toBe(0)
    expect(years[4].expensesNotCovered).toBe(true)
  })

  it('setExpenses considera l\'importo in termini reali (rivalutato all\'inflazione da startYear)', () => {
    const plan = basePlan({
      startYear: 2026,
      birthYear: 1977,
      retirementAge: 60,
      lifeExpectancyAge: 53,
      annualExpenses: 2_000,
      inflationRate: 0.1,
      events: [{ kind: 'setExpenses', fromYear: 2028, amount: 1_000 }]
    })
    const years = runProjection(plan, [0, 0, 0, 0])

    expect(years[0].expenses).toBeCloseTo(2_000)
    expect(years[1].expenses).toBeCloseTo(2_200)
    // Anno 2 (2028): 1_000 € reali * (1.1)^2 = 1_210 € nominali
    expect(years[2].expenses).toBeCloseTo(1_210)
    // Anno 3 (2029): 1_000 € reali * (1.1)^3 = 1_331 € nominali
    expect(years[3].expenses).toBeCloseTo(1_331)
  })
})

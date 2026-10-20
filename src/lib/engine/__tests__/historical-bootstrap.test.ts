import { describe, expect, it } from 'vitest'
import type { HistoricalYearData, Plan } from '../types'
import { HISTORICAL_DATASETS } from '../historicalData'
import { mulberry32, runMonteCarlo, sampleBlockBootstrapTrajectory } from '../montecarlo'
import { runProjection } from '../projection'
import {
  createDefaultPlan,
  decodePlanFromUrlParam,
  encodePlanToUrlParam,
  sanitizePlan
} from '../../persistence'

function basePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    startYear: 2026,
    birthYear: 1977,
    retirementAge: 49,
    lifeExpectancyAge: 54,
    initialPortfolio: 1_000_000,
    initialCostBasis: 1_000_000,
    annualIncome: 0,
    incomeGrowthRate: 0,
    annualExpenses: 0,
    inflationRate: 0,
    meanReturn: 0,
    returnStdDev: 0,
    runs: 10,
    seed: 42,
    taxRate: 0,
    withdrawalStrategy: { type: 'spendExpenses' },
    events: [],
    ...overrides
  }
}

function row(
  calendarYear: number,
  equityReturn: number,
  bondReturn: number,
  inflationRate: number
): HistoricalYearData {
  return { calendarYear, equityReturn, bondReturn, inflationRate }
}

describe('runProjection con vettore inflations', () => {
  it('inflations costante ≡ plan.inflationRate (entro 1e-12), con setExpenses/percentCap/recurringIncome', () => {
    const plan = basePlan({
      lifeExpectancyAge: 59, // orizzonte 10
      inflationRate: 0.03,
      annualExpenses: 10_000,
      withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
      events: [
        { kind: 'setExpenses', fromYear: 2030, amount: 12_000 },
        { kind: 'recurringIncome', fromYear: 2040, amount: 8_000 },
        { kind: 'recurringIncome', fromYear: 2032, amount: 3_000, inflationAdjusted: false }
      ]
    })
    const returns = [0.05, -0.02, 0.08, 0.01, 0.03, -0.05, 0.07, 0.02, 0.04, 0.06]

    const scalar = runProjection(plan, returns)
    const vector = runProjection(plan, returns, Array(10).fill(0.03))

    expect(vector).toHaveLength(10)
    for (let t = 0; t < 10; t++) {
      expect(vector[t].expenses).toBeCloseTo(scalar[t].expenses, 9)
      expect(vector[t].withdrawal).toBeCloseTo(scalar[t].withdrawal, 9)
      expect(vector[t].income).toBeCloseTo(scalar[t].income, 9)
      expect(vector[t].endPortfolio).toBeCloseTo(scalar[t].endPortfolio, 9)
      expect(vector[t].inflationRate).toBe(0.03)
      expect(scalar[t].inflationRate).toBeUndefined()
    }
  })

  it('shock stagflattivo: indice dei prezzi cumulativo da vettore variabile', () => {
    const plan = basePlan({
      lifeExpectancyAge: 52, // orizzonte 3
      annualExpenses: 10_000,
      initialPortfolio: 10_000_000
    })
    const years = runProjection(plan, [-0.15, -0.1, 0.05], [0.1, 0.2, 0])

    expect(years[0].expenses).toBeCloseTo(10_000, 9)
    expect(years[1].expenses).toBeCloseTo(11_000, 9)
    expect(years[2].expenses).toBeCloseTo(13_200, 9)
    expect(years.map((y) => y.inflationRate)).toEqual([0.1, 0.2, 0])
  })

  it('setExpenses resta in termini reali da startYear anche con inflazione variabile', () => {
    const plan = basePlan({
      lifeExpectancyAge: 52,
      annualExpenses: 10_000,
      initialPortfolio: 10_000_000,
      events: [{ kind: 'setExpenses', fromYear: 2027, amount: 20_000 }]
    })
    const years = runProjection(plan, [0, 0, 0], [0.1, 0.2, 0])

    expect(years[0].expenses).toBeCloseTo(10_000, 9)
    expect(years[1].expenses).toBeCloseTo(20_000 * 1.1, 9)
    expect(years[2].expenses).toBeCloseTo(20_000 * 1.1 * 1.2, 9)
  })

  it('il tetto percentCap è indicizzato al vettore inflazione, non a plan.inflationRate', () => {
    const plan = basePlan({
      lifeExpectancyAge: 51, // orizzonte 2
      annualExpenses: 100_000,
      initialPortfolio: 1_000_000,
      withdrawalStrategy: { type: 'percentCap', rate: 0.04 }
    })
    const years = runProjection(plan, [0, 0], [0.5, 0.5])

    // il fabbisogno (100k, poi 150k) supera sempre il tetto: il prelievo è il cap
    expect(years[0].withdrawal).toBeCloseTo(40_000, 9)
    expect(years[1].withdrawal).toBeCloseTo(60_000, 9)
  })

  it('guardrails: adeguamento con inflazione campionata dell\u2019anno precedente e skip dopo anno negativo', () => {
    const plan = basePlan({
      lifeExpectancyAge: 52,
      annualExpenses: 0,
      initialPortfolio: 1_000_000,
      inflationRate: 0,
      withdrawalStrategy: {
        type: 'guardrails',
        initialRate: 0.05,
        lowerGuardrail: 0.01,
        upperGuardrail: 0.2,
        increasePct: 0.1,
        decreasePct: 0.1,
        skipInflationAfterNegativeReturn: true
      }
    })
    const years = runProjection(plan, [-0.1, 0, 0], [0.1, 0.2, 0.05])

    expect(years[0].withdrawal).toBeCloseTo(50_000, 9)
    // anno 1: rendimento precedente -10% e inflazione precedente 10% > 0 → skip aggiustamento
    expect(years[1].withdrawal).toBeCloseTo(50_000, 9)
    // anno 2: rendimento precedente 0 → aggiustamento con inflazione campionata dell'anno 1 (20%)
    expect(years[2].withdrawal).toBeCloseTo(60_000, 9)
  })

  it('guardrails con inflations costante coincide con il comportamento scalare', () => {
    const plan = basePlan({
      lifeExpectancyAge: 56,
      annualExpenses: 5_000,
      initialPortfolio: 1_000_000,
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
    const returns = [0.05, -0.1, 0.02, 0.08, -0.03, 0.04, 0.01]

    const scalar = runProjection(plan, returns)
    const vector = runProjection(plan, returns, Array(7).fill(0.03))

    for (let t = 0; t < 7; t++) {
      expect(vector[t].withdrawal).toBeCloseTo(scalar[t].withdrawal, 9)
      expect(vector[t].endPortfolio).toBeCloseTo(scalar[t].endPortfolio, 9)
    }
  })
})

describe('rolling historical backtest', () => {
  const dataset = [
    row(2000, 0.1, 0.02, 0.01),
    row(2001, -0.2, 0.05, 0.02),
    row(2002, 0.15, 0.01, 0.03),
    row(2003, 0.05, 0.03, 0.04),
    row(2004, -0.1, 0.04, 0.05),
    row(2005, 0.2, 0.02, 0.06)
  ]

  it('genera N-H+1 finestre contigue con rendimenti e inflazione storica accoppiati', () => {
    const plan = basePlan({
      lifeExpectancyAge: 53, // orizzonte 4
      simulationMode: { type: 'historicalRolling', stockAllocation: 0.6, customDataset: dataset }
    })
    const results = runMonteCarlo(plan)

    expect(results).toHaveLength(3)
    results.forEach((result, m) => {
      expect(result.years).toHaveLength(4)
      for (let t = 0; t < 4; t++) {
        const histRow = dataset[m + t]
        expect(result.years[t].returnRate).toBeCloseTo(
          0.6 * histRow.equityReturn + 0.4 * histRow.bondReturn,
          12
        )
        expect(result.years[t].inflationRate).toBe(histRow.inflationRate)
      }
    })
  })

  it('orizzonte più lungo della serie: wrap-around circolare con N traiettorie', () => {
    const plan = basePlan({
      lifeExpectancyAge: 57, // orizzonte 8 > 6 anni storici
      simulationMode: { type: 'historicalRolling', stockAllocation: 1, customDataset: dataset }
    })
    const results = runMonteCarlo(plan)

    expect(results).toHaveLength(dataset.length)
    results.forEach((result, m) => {
      expect(result.years).toHaveLength(8)
      for (let t = 0; t < 8; t++) {
        expect(result.years[t].returnRate).toBeCloseTo(
          dataset[(m + t) % dataset.length].equityReturn,
          12
        )
      }
    })
  })
})

describe('block bootstrap', () => {
  const dataset = Array.from({ length: 10 }, (_, y) =>
    row(2000 + y, y * 0.01, 0, y * 0.005)
  )

  it('preserva contiguità dei blocchi e correlazione rendimento-inflazione', () => {
    const plan = basePlan({
      lifeExpectancyAge: 55, // orizzonte 6
      runs: 20,
      simulationMode: {
        type: 'blockBootstrap',
        blockSize: 3,
        stationary: false,
        stockAllocation: 1,
        customDataset: dataset
      }
    })
    const results = runMonteCarlo(plan)

    expect(results).toHaveLength(20)
    for (const result of results) {
      const ys = result.years
      for (let t = 0; t < 6; t++) {
        // inflazione storica sempre metà del rendimento (correlazione accoppiata)
        expect(ys[t].inflationRate! * 2).toBeCloseTo(ys[t].returnRate, 12)
        // dentro ogni blocco di 3 anni gli indici storici sono consecutivi modulo 10
        if (t % 3 !== 0) {
          const idx = Math.round(ys[t].returnRate / 0.01)
          const prevIdx = Math.round(ys[t - 1].returnRate / 0.01)
          expect(idx).toBe((prevIdx + 1) % 10)
        }
      }
    }
  })

  it('stationary bootstrap: deterministico a parità di seed e correlazione preservata', () => {
    const a = sampleBlockBootstrapTrajectory(mulberry32(7), dataset, 12, 3, 1, true)
    const b = sampleBlockBootstrapTrajectory(mulberry32(7), dataset, 12, 3, 1, true)

    expect(a.returns).toEqual(b.returns)
    expect(a.inflations).toEqual(b.inflations)
    expect(a.returns).toHaveLength(12)
    for (let t = 0; t < 12; t++) {
      expect(a.inflations[t] * 2).toBeCloseTo(a.returns[t] as number, 12)
    }
  })

  it('stockAllocation clippata e rendimento misto azionario/obbligazionario', () => {
    const single = [row(2000, 0.1, 0.02, 0.03)]
    const { returns, inflations } = sampleBlockBootstrapTrajectory(mulberry32(1), single, 3, 5, 0.5)

    expect(returns).toEqual([0.5 * 0.1 + 0.5 * 0.02, 0.5 * 0.1 + 0.5 * 0.02, 0.5 * 0.1 + 0.5 * 0.02])
    expect(inflations).toEqual([0.03, 0.03, 0.03])
  })

  it('modalità parametrica esplicita ≡ simulationMode omesso', () => {
    const plan = basePlan({ annualExpenses: 20_000, meanReturn: 0.05, returnStdDev: 0.15 })
    const implicit = runMonteCarlo(plan)
    const explicit = runMonteCarlo({ ...plan, simulationMode: { type: 'parametric' } })

    expect(explicit).toEqual(implicit)
  })
})

describe('dataset storici bundled', () => {
  it('USA: 1928-2024, anni consecutivi e valori plausibili', () => {
    const data = HISTORICAL_DATASETS.usa
    expect(data).toHaveLength(97)
    expect(data[0].calendarYear).toBe(1928)
    expect(data[data.length - 1].calendarYear).toBe(2024)
    for (let i = 1; i < data.length; i++) {
      expect(data[i].calendarYear).toBe(data[i - 1].calendarYear + 1)
    }
    for (const r of data) {
      expect(r.equityReturn).toBeGreaterThan(-0.6)
      expect(r.equityReturn).toBeLessThan(0.7)
      expect(r.bondReturn).toBeGreaterThan(-0.4)
      expect(r.bondReturn).toBeLessThan(0.6)
      expect(r.inflationRate).toBeGreaterThan(-0.15)
      expect(r.inflationRate).toBeLessThan(0.5)
    }
  })

  it('Italia: almeno 70 anni, inflazione FOI plausibile e anni consecutivi', () => {
    const data = HISTORICAL_DATASETS.italia
    expect(data.length).toBeGreaterThanOrEqual(70)
    for (let i = 1; i < data.length; i++) {
      expect(data[i].calendarYear).toBe(data[i - 1].calendarYear + 1)
    }
    for (const r of data) {
      expect(r.inflationRate).toBeGreaterThan(-0.15)
      expect(r.inflationRate).toBeLessThan(0.5)
    }
    // ancore storiche ISTAT note
    const by1980 = data.find((r) => r.calendarYear === 1980)
    expect(by1980!.inflationRate).toBeGreaterThan(0.15)
  })
})

describe('persistence di simulationMode', () => {
  it('sanitizePlan preserva una modalità valida e scarta valori corrotti', () => {
    const clean = sanitizePlan({
      ...createDefaultPlan(),
      simulationMode: { type: 'blockBootstrap', datasetId: 'italia', blockSize: 8, stationary: true, stockAllocation: 0.7 }
    })
    expect(clean.simulationMode).toEqual({
      type: 'blockBootstrap',
      datasetId: 'italia',
      blockSize: 8,
      stationary: true,
      stockAllocation: 0.7
    })

    const corrupted = sanitizePlan({
      ...createDefaultPlan(),
      simulationMode: { type: 'blockBootstrap', datasetId: 'moon', blockSize: 999, stockAllocation: 5 }
    })
    expect(corrupted.simulationMode).toEqual({ type: 'blockBootstrap', blockSize: 20, stockAllocation: 1 })

    const unknown = sanitizePlan({ ...createDefaultPlan(), simulationMode: { type: 'wat' } })
    expect(unknown.simulationMode).toBeUndefined()
  })

  it('round-trip URL con simulationMode storico', () => {
    const plan = sanitizePlan({
      ...createDefaultPlan(),
      simulationMode: { type: 'historicalRolling', datasetId: 'usa', stockAllocation: 0.8 }
    })
    const decoded = decodePlanFromUrlParam(encodePlanToUrlParam(plan))

    expect(decoded?.simulationMode).toEqual({
      type: 'historicalRolling',
      datasetId: 'usa',
      stockAllocation: 0.8
    })
  })
})

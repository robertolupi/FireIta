import { describe, expect, it } from 'vitest'
import type { Plan } from '../types'
import type { YearBand } from '../stats'
import {
  computeFireTargetSeries,
  extractChartMarkers,
  resolveReferenceSwr,
  snapBandIndex
} from '../chart-helpers'

function makeBands(startYear: number, birthYear: number, count: number): YearBand[] {
  return Array.from({ length: count }, (_, i) => ({
    year: i,
    age: startYear - birthYear + i,
    calendarYear: startYear + i,
    survivalRate: 1,
    p10: 100_000,
    p25: 200_000,
    p50: 300_000,
    p75: 400_000,
    p90: 500_000
  }))
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    startYear: 2026,
    birthYear: 1978,
    retirementAge: 60, // anno 2038 (indice 12)
    lifeExpectancyAge: 79,
    initialPortfolio: 200_000,
    initialCostBasis: 160_000,
    annualIncome: 40_000,
    incomeGrowthRate: 0.02,
    annualExpenses: 24_000,
    inflationRate: 0.02,
    meanReturn: 0.05,
    returnStdDev: 0.15,
    runs: 50,
    seed: 42,
    taxRate: 0.26,
    withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
    events: [],
    ...overrides
  }
}

describe('chart-helpers — FanChart interattivo', () => {
  it('1. snapBandIndex: mappa correttamente xSvg agli indici 0..N-1 e restituisce null fuori margine', () => {
    const W = 800
    const PAD_X = 64
    const N = 31

    expect(snapBandIndex(64, W, PAD_X, N)).toBe(0)
    expect(snapBandIndex(736, W, PAD_X, N)).toBe(30)
    expect(snapBandIndex(400, W, PAD_X, N)).toBe(15)

    // Fuori margine
    expect(snapBandIndex(40, W, PAD_X, N)).toBeNull()
    expect(snapBandIndex(760, W, PAD_X, N)).toBeNull()
    expect(snapBandIndex(400, W, PAD_X, 0)).toBeNull()
    expect(snapBandIndex(400, W, PAD_X, 1)).toBe(0)
  })

  it('2. extractChartMarkers: estrae e deduplica per anno i marker di ritiro ed eventi di vita', () => {
    const plan = makePlan({
      startYear: 2026,
      birthYear: 1978,
      retirementAge: 60, // 2038
      events: [
        { kind: 'oneTimeExpense', atYear: 2038, amount: 30_000 },
        { kind: 'recurringIncome', fromYear: 2045, amount: 18_000, inflationAdjusted: true }
      ]
    })
    const bands = makeBands(2026, 1978, 31)
    const markers = extractChartMarkers(plan, bands, 800, 64)

    expect(markers).toHaveLength(2)

    const m2038 = markers.find((m) => m.year === 2038)!
    expect(m2038).toBeDefined()
    expect(m2038.isStopWork).toBe(true)
    expect(m2038.bandIndex).toBe(12)
    expect(m2038.labels).toContain('Ritiro (FIRE)')
    expect(m2038.labels.some((l) => l.includes('30'))).toBe(true)

    const m2045 = markers.find((m) => m.year === 2045)!
    expect(m2045).toBeDefined()
    expect(m2045.isStopWork).toBe(false)
    expect(m2045.bandIndex).toBe(19)
  })

  it('3. computeFireTargetSeries: costante in modalità real e crescente con inflazione in modalità nominal', () => {
    const plan = makePlan({
      annualExpenses: 24_000,
      inflationRate: 0.02,
      withdrawalStrategy: { type: 'percentCap', rate: 0.04 }
    })
    const bands = makeBands(2026, 1978, 11) // 0..10 anni

    const realSeries = computeFireTargetSeries(plan, bands, 'real', 0.04)
    expect(realSeries).toHaveLength(11)
    for (const v of realSeries) {
      expect(v).toBeCloseTo(600_000, 5)
    }

    const nominalSeries = computeFireTargetSeries(plan, bands, 'nominal', 0.04)
    expect(nominalSeries[0]).toBeCloseTo(600_000, 5)
    expect(nominalSeries[10]).toBeCloseTo(600_000 * Math.pow(1.02, 10), 4)

    expect(resolveReferenceSwr(plan)).toBe(0.04)
    expect(
      resolveReferenceSwr(
        makePlan({
          withdrawalStrategy: {
            type: 'guardrails',
            initialRate: 0.05,
            lowerGuardrail: 0.04,
            upperGuardrail: 0.06,
            increasePct: 0.1,
            decreasePct: 0.1
          }
        })
      )
    ).toBe(0.05)
    expect(resolveReferenceSwr(makePlan({ withdrawalStrategy: { type: 'vpw' } }))).toBe(0.04)
  })
})

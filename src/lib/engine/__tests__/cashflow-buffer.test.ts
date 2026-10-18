import { describe, expect, it } from 'vitest'
import { deflateYearState } from '../deflate'
import { runProjection } from '../projection'
import type { Plan } from '../types'
import { decodePlanFromUrlParam, encodePlanToUrlParam } from '../../persistence'

function basePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    startYear: 2026,
    birthYear: 1966,
    retirementAge: 60,
    lifeExpectancyAge: 63,
    initialPortfolio: 100_000,
    initialCostBasis: 100_000,
    annualIncome: 0,
    incomeGrowthRate: 0,
    annualExpenses: 10_000,
    inflationRate: 0,
    meanReturn: 0.05,
    returnStdDev: 0,
    runs: 10,
    seed: 1,
    taxRate: 0.26,
    stampDutyRate: 0,
    whitelistAllocation: 0,
    withdrawalStrategy: { type: 'spendExpenses' },
    events: [],
    ...overrides
  }
}

describe('CashflowTiming & CashBuffer (Proposal 11)', () => {
  it('1. deterministic timing: legacy vs startOfYear vs midYear in retirement', () => {
    const legacyYears = runProjection(
      basePlan({ lifeExpectancyAge: 61, taxRate: 0, cashflowTiming: 'legacy' }),
      [0.1]
    )
    expect(legacyYears[0].investmentReturn).toBeCloseTo(10_000, 2)
    expect(legacyYears[0].endPortfolio).toBeCloseTo(100_000, 2)

    const startYears = runProjection(
      basePlan({ lifeExpectancyAge: 61, taxRate: 0, cashflowTiming: 'startOfYear' }),
      [0.1]
    )
    expect(startYears[0].investmentReturn).toBeCloseTo(9_000, 2)
    expect(startYears[0].endPortfolio).toBeCloseTo(99_000, 2)

    const midYears = runProjection(
      basePlan({ lifeExpectancyAge: 61, taxRate: 0, cashflowTiming: 'midYear' }),
      [0.1]
    )
    expect(midYears[0].investmentReturn).toBeCloseTo(9_500, 2)
    expect(midYears[0].endPortfolio).toBeCloseTo(99_500, 2)
  })

  it('2. mitigates Sequence of Returns Risk with Cash Buffer during early market crash', () => {
    const returns = [-0.25, -0.15, 0.35]
    const planNoBuffer = basePlan({
      initialPortfolio: 500_000,
      initialCostBasis: 300_000,
      taxRate: 0.26,
      annualExpenses: 20_000,
      lifeExpectancyAge: 63
    })
    const planWithBuffer = basePlan({
      initialPortfolio: 500_000,
      initialCostBasis: 300_000,
      taxRate: 0.26,
      annualExpenses: 20_000,
      lifeExpectancyAge: 63,
      cashBuffer: {
        enabled: true,
        yearsOfExpenses: 2,
        cashReturnRate: 0,
        drawdownThreshold: 0
      }
    })

    const noBufYears = runProjection(planNoBuffer, returns)
    const bufYears = runProjection(planWithBuffer, returns)

    // Negli anni 0 e 1 (r = -25%, -15%), il piano con Cash Buffer non vende quote azionarie
    expect(bufYears[0].grossSale).toBe(0)
    expect(bufYears[0].taxPaid).toBe(0)
    expect(bufYears[0].bufferWithdrawal).toBeCloseTo(20_000, 2)
    expect(bufYears[0].cashBufferEnd).toBeCloseTo(20_000, 2)

    expect(bufYears[1].grossSale).toBe(0)
    expect(bufYears[1].taxPaid).toBe(0)
    expect(bufYears[1].bufferWithdrawal).toBeCloseTo(20_000, 2)
    expect(bufYears[1].cashBufferEnd).toBeCloseTo(0, 2)

    // A fine anno 2 (+35%), il patrimonio complessivo col Cash Buffer supera quello senza buffer
    expect(bufYears[2].endPortfolio).toBeGreaterThan(noBufYears[2].endPortfolio)
  })

  it('3. partial buffer exhaustion falls back to invested portfolio for the remainder', () => {
    // Target buffer = 1.6 * 20_000 = 32_000.
    // Anno 0 (r = -10%): preleva 20_000 dal buffer -> residuo M_1 = 12_000.
    // Anno 1 (r = -10%): preleva 12_000 dal buffer + 8_000 dal portafoglio.
    const plan = basePlan({
      initialPortfolio: 300_000,
      initialCostBasis: 300_000,
      annualExpenses: 20_000,
      lifeExpectancyAge: 62,
      cashBuffer: {
        enabled: true,
        yearsOfExpenses: 1.6,
        cashReturnRate: 0,
        drawdownThreshold: 0
      }
    })

    const years = runProjection(plan, [-0.1, -0.1])
    expect(years[0].cashBufferEnd).toBeCloseTo(12_000, 2)

    expect(years[1].cashBufferStart).toBeCloseTo(12_000, 2)
    expect(years[1].bufferWithdrawal).toBeCloseTo(12_000, 2)
    expect(years[1].cashBufferEnd).toBeCloseTo(0, 2)
    expect(years[1].grossSale).toBeCloseTo(8_000, 2)
    expect(years[1].withdrawal).toBeCloseTo(20_000, 2)
  })

  it('4. conditional refill caps transfer to excess investment return (I_t - W_t)', () => {
    // Portafoglio iniziale 340_000 (costBasis = 340_000, zero tasse), buffer 2 anni = 40_000.
    // Quota investita iniziale = 300_000.
    // Anno 0 (r = 0, ma soglia drawdownThreshold = 0.01 così usa buffer): M_1 = 20_000, P_1 = 300_000.
    // Anno 1 (r = 0, sotto soglia 0.01): M_2 = 0, P_2 = 300_000.
    // Anno 2 (r = +0.10 >= soglia 0.01): I_2 = 300_000 * 0.10 = 30_000, spesa W_2 = 20_000.
    // Deficit buffer D_2 = 40_000, ma eccedenza rendimento = I_2 - W_2 = 10_000 -> Refill = 10_000!
    const plan = basePlan({
      initialPortfolio: 340_000,
      initialCostBasis: 340_000,
      annualExpenses: 20_000,
      lifeExpectancyAge: 63,
      cashBuffer: {
        enabled: true,
        yearsOfExpenses: 2,
        cashReturnRate: 0,
        drawdownThreshold: 0.01
      }
    })

    const years = runProjection(plan, [0, 0, 0.1])
    expect(years[1].cashBufferEnd).toBeCloseTo(0, 2)
    expect(years[2].investmentReturn).toBeCloseTo(30_000, 2)
    expect(years[2].withdrawal).toBeCloseTo(20_000, 2)
    expect(years[2].bufferRefill).toBeCloseTo(10_000, 2)
    expect(years[2].cashBufferEnd).toBeCloseTo(10_000, 2)
  })

  it('5. deflates cashBuffer fields and round-trips cashflowTiming/cashBuffer in URL', () => {
    const plan = basePlan({
      inflationRate: 0.1,
      cashflowTiming: 'midYear',
      cashBuffer: {
        enabled: true,
        yearsOfExpenses: 2,
        cashReturnRate: 0.02,
        drawdownThreshold: 0
      }
    })

    const decoded = decodePlanFromUrlParam(encodePlanToUrlParam(plan))
    expect(decoded).toEqual(plan)

    const years = runProjection(plan, [-0.1, 0.1])
    const deflatedY1 = deflateYearState(years[1], plan.startYear, plan.inflationRate)
    expect(deflatedY1.cashBufferEnd).toBeCloseTo((years[1].cashBufferEnd ?? 0) / 1.1, 2)
    expect(deflatedY1.cashBufferBalance).toBeCloseTo((years[1].cashBufferBalance ?? 0) / 1.1, 2)
  })
})

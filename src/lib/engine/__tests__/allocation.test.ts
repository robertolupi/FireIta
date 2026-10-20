import { describe, expect, it } from 'vitest'
import type { AssetBuckets, AssetClassId, Plan } from '../types'
import {
  allocateProportionally,
  computeTargetWeights,
  contributeToBuckets,
  rebalanceBuckets,
  totalValue,
  withdrawFromBuckets
} from '../allocation'
import { cholesky3x3, mulberry32, runMonteCarlo, sampleMultiAssetReturns } from '../montecarlo'
import { runProjection } from '../projection'
import {
  createDefaultPlan,
  decodePlanFromUrlParam,
  encodePlanToUrlParam,
  sanitizePlan
} from '../../persistence'

function buckets(
  equity: [number, number],
  bonds: [number, number],
  cash: [number, number] = [0, 0]
): AssetBuckets {
  return {
    equity: { value: equity[0], costBasis: equity[1] },
    bonds: { value: bonds[0], costBasis: bonds[1] },
    cash: { value: cash[0], costBasis: cash[1] }
  }
}

const TAX: Record<AssetClassId, number> = { equity: 0.26, bonds: 0.125, cash: 0.26 }

describe('computeTargetWeights', () => {
  const glidepath = {
    type: 'bondTent' as const,
    accumulationWeights: { equity: 0.8, bonds: 0.2, cash: 0 },
    peakWeights: { equity: 0.4, bonds: 0.5, cash: 0.1 },
    postTentWeights: { equity: 0.7, bonds: 0.3, cash: 0 },
    yearsBeforeRetirement: 5,
    yearsAfterRetirement: 10
  }

  it('interpolazione esatta del Bond Tent (stopYear = 10)', () => {
    expect(computeTargetWeights(glidepath, 3, 10)).toEqual({ equity: 0.8, bonds: 0.2, cash: 0 })

    const mid1 = computeTargetWeights(glidepath, 7.5, 10)
    expect(mid1.equity).toBeCloseTo(0.6, 12)
    expect(mid1.bonds).toBeCloseTo(0.35, 12)
    expect(mid1.cash).toBeCloseTo(0.05, 12)

    expect(computeTargetWeights(glidepath, 10, 10)).toEqual({ equity: 0.4, bonds: 0.5, cash: 0.1 })

    const mid2 = computeTargetWeights(glidepath, 15, 10)
    expect(mid2.equity).toBeCloseTo(0.55, 12)
    expect(mid2.bonds).toBeCloseTo(0.4, 12)
    expect(mid2.cash).toBeCloseTo(0.05, 12)

    expect(computeTargetWeights(glidepath, 25, 10)).toEqual({ equity: 0.7, bonds: 0.3, cash: 0 })
  })

  it('Bond Tent con yearsBeforeRetirement = 0 raggiunge esattamente peak all\'anno FIRE', () => {
    const instantDerisk = {
      ...glidepath,
      yearsBeforeRetirement: 0,
      yearsAfterRetirement: 10
    }
    // Anno prima del pensionamento: accumulo
    expect(computeTargetWeights(instantDerisk, 9, 10)).toEqual({ equity: 0.8, bonds: 0.2, cash: 0 })
    // Anno di pensionamento esatto: picco difensivo
    expect(computeTargetWeights(instantDerisk, 10, 10)).toEqual({ equity: 0.4, bonds: 0.5, cash: 0.1 })
    // Discesa post-tenda: metà discesa a t = 15
    const mid = computeTargetWeights(instantDerisk, 15, 10)
    expect(mid.equity).toBeCloseTo(0.55, 12)
    expect(mid.bonds).toBeCloseTo(0.4, 12)
    expect(mid.cash).toBeCloseTo(0.05, 12)
    // Post-tenda a regime
    expect(computeTargetWeights(instantDerisk, 20, 10)).toEqual({ equity: 0.7, bonds: 0.3, cash: 0 })
  })

  it('Bond Tent con yearsAfterRetirement = 0 o già in pensione (stopYear = 0)', () => {
    const flatPost = {
      ...glidepath,
      yearsBeforeRetirement: 5,
      yearsAfterRetirement: 0
    }
    expect(computeTargetWeights(flatPost, 10, 10)).toEqual({ equity: 0.4, bonds: 0.5, cash: 0.1 })
    expect(computeTargetWeights(flatPost, 11, 10)).toEqual({ equity: 0.7, bonds: 0.3, cash: 0 })

    const alreadyRetired = {
      ...glidepath,
      yearsBeforeRetirement: 5,
      yearsAfterRetirement: 10
    }
    // Anno 0 è stopYear: picco
    expect(computeTargetWeights(alreadyRetired, 0, 0)).toEqual({ equity: 0.4, bonds: 0.5, cash: 0.1 })
    // Anno 5: metà salita verso regime
    const mid = computeTargetWeights(alreadyRetired, 5, 0)
    expect(mid.equity).toBeCloseTo(0.55, 12)
  })

  it('static restituisce i pesi normalizzati a ogni anno', () => {
    const w = computeTargetWeights(
      { type: 'static', weights: { equity: 6, bonds: 3, cash: 1 } },
      7,
      10
    )
    expect(w.equity).toBeCloseTo(0.6, 12)
    expect(w.bonds).toBeCloseTo(0.3, 12)
    expect(w.cash).toBeCloseTo(0.1, 12)
  })

  it('normalizzazione difensiva: pesi a somma zero → 100% equity', () => {
    const w = computeTargetWeights(
      { type: 'static', weights: { equity: 0, bonds: 0, cash: 0 } },
      0,
      10
    )
    expect(w).toEqual({ equity: 1, bonds: 0, cash: 0 })
  })
})

describe('allocateProportionally', () => {
  it('ripartisce valore e cost basis secondo i pesi', () => {
    const b = allocateProportionally({ equity: 0.6, bonds: 0.3, cash: 0.1 }, 100_000, 80_000)
    expect(b.equity.value).toBeCloseTo(60_000, 9)
    expect(b.equity.costBasis).toBeCloseTo(48_000, 9)
    expect(b.bonds.value).toBeCloseTo(30_000, 9)
    expect(b.cash.costBasis).toBeCloseTo(8_000, 9)
    expect(totalValue(b)).toBeCloseTo(100_000, 9)
  })
})

describe('contributeToBuckets (soft rebalancing)', () => {
  it('il contributo va interamente al bucket sottopesato, zero imposte', () => {
    const b = buckets([70_000, 70_000], [30_000, 30_000])
    contributeToBuckets(b, 10_000, { equity: 0.6, bonds: 0.4, cash: 0 })

    expect(b.equity.value).toBeCloseTo(70_000, 9)
    expect(b.bonds.value).toBeCloseTo(40_000, 9)
    expect(b.bonds.costBasis).toBeCloseTo(40_000, 9)
    expect(totalValue(b)).toBeCloseTo(110_000, 9)
  })

  it('senza deficit ripartisce secondo i pesi target', () => {
    const b = buckets([60_000, 60_000], [40_000, 40_000])
    contributeToBuckets(b, 10_000, { equity: 0.6, bonds: 0.4, cash: 0 })

    expect(b.equity.value).toBeCloseTo(66_000, 9)
    expect(b.bonds.value).toBeCloseTo(44_000, 9)
  })
})

describe('withdrawFromBuckets (prelievo tax-aware)', () => {
  it('vende prima il sovrappeso, poi per TaxDrag crescente', () => {
    // equity: V=50k B=50k (plusvalenza 0, drag 0); bonds: V=50k B=25k (drag 0.0625)
    const b = buckets([50_000, 50_000], [50_000, 25_000])
    const r = withdrawFromBuckets(b, 20_000, { equity: 0.5, bonds: 0.5, cash: 0 }, TAX)

    expect(r.netProceeds).toBeCloseTo(20_000, 9)
    expect(r.depleted).toBe(false)
    // surplus equity 10k a imposta zero, surplus bonds 10k lordi al 12,5% sul 50% di gain,
    // residuo 625 netti da equity (drag più basso)
    expect(r.taxPaid).toBeCloseTo(625, 9)
    expect(b.equity.value).toBeCloseTo(50_000 - 10_000 - 625, 9)
    expect(b.bonds.value).toBeCloseTo(40_000, 9)
  })

  it('segnala depleted quando il patrimonio non copre il fabbisogno', () => {
    const b = buckets([5_000, 5_000], [0, 0])
    const r = withdrawFromBuckets(b, 20_000, { equity: 1, bonds: 0, cash: 0 }, TAX)

    expect(r.depleted).toBe(true)
    expect(r.netProceeds).toBeCloseTo(5_000, 9)
  })
})

describe('rebalanceBuckets (hard rebalancing)', () => {
  it('annual: vende l\u2019eccedenza tassata e reinveste il netto nei sottopesati', () => {
    // equity: V=80k B=40k (gain 50%, tau 26%); bonds: V=20k B=10k (tau 12,5%)
    const b = buckets([80_000, 40_000], [20_000, 10_000])
    const r = rebalanceBuckets(b, { equity: 0.5, bonds: 0.5, cash: 0 }, { mode: 'annual' }, TAX)

    // eccedenza equity 30k, imposta = 30k * 0.5 * 0.26 = 3_900
    expect(r.grossSale).toBeCloseTo(30_000, 9)
    expect(r.taxPaid).toBeCloseTo(3_900, 9)
    expect(b.equity.value).toBeCloseTo(50_000, 9)
    expect(b.equity.costBasis).toBeCloseTo(25_000, 9)
    expect(b.bonds.value).toBeCloseTo(20_000 + 26_100, 9)
    expect(b.bonds.costBasis).toBeCloseTo(10_000 + 26_100, 9)
    expect(totalValue(b)).toBeCloseTo(100_000 - 3_900, 9)
  })

  it('threshold: nessuna azione dentro la banda, azione oltre la banda', () => {
    const inside = buckets([64_000, 64_000], [36_000, 36_000])
    const r1 = rebalanceBuckets(
      inside,
      { equity: 0.6, bonds: 0.4, cash: 0 },
      { mode: 'threshold', band: 0.05 },
      TAX
    )
    expect(r1.taxPaid).toBe(0)
    expect(inside.equity.value).toBe(64_000)

    const outside = buckets([70_000, 70_000], [30_000, 30_000])
    const r2 = rebalanceBuckets(
      outside,
      { equity: 0.6, bonds: 0.4, cash: 0 },
      { mode: 'threshold', band: 0.05 },
      TAX
    )
    expect(r2.grossSale).toBeGreaterThan(0)
  })

  it('cashflowOnly: mai vendite', () => {
    const b = buckets([90_000, 45_000], [10_000, 5_000])
    const r = rebalanceBuckets(b, { equity: 0.5, bonds: 0.5, cash: 0 }, { mode: 'cashflowOnly' }, TAX)
    expect(r).toEqual({ taxPaid: 0, grossSale: 0 })
    expect(b.equity.value).toBe(90_000)
  })
})

describe('equivalenza mono-asset (multi-asset 100% equity ≡ legacy)', () => {
  function monoPlan(overrides: Partial<Plan> = {}): Plan {
    const plan: Plan = {
      startYear: 2026,
      birthYear: 1977,
      retirementAge: 49,
      lifeExpectancyAge: 56,
      initialPortfolio: 500_000,
      initialCostBasis: 400_000,
      annualIncome: 30_000,
      incomeGrowthRate: 0.01,
      annualExpenses: 20_000,
      inflationRate: 0.02,
      meanReturn: 0.05,
      returnStdDev: 0.15,
      runs: 1,
      seed: 7,
      taxRate: 0.26,
      stampDutyRate: 0.002,
      withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
      events: [{ kind: 'setExpenses', fromYear: 2030, amount: 24_000 }],
      ...overrides
    }
    return plan
  }

  function withMonoAsset(plan: Plan): Plan {
    return {
      ...plan,
      multiAsset: {
        assets: {
          equity: { id: 'equity', meanReturn: 0.05, returnStdDev: 0.15, taxRate: plan.taxRate },
          bonds: { id: 'bonds', meanReturn: 0.02, returnStdDev: 0.06, taxRate: 0.125 },
          cash: { id: 'cash', meanReturn: 0.01, returnStdDev: 0.01, taxRate: 0.26 }
        },
        correlations: { equityBonds: -0.1, equityCash: 0, bondsCash: 0.1 },
        glidepath: { type: 'static', weights: { equity: 1, bonds: 0, cash: 0 } },
        rebalance: { mode: 'annual' }
      }
    }
  }

  const returns = [0.05, -0.12, 0.08, 0.02, -0.03, 0.1, 0.04, 0.06, -0.01, 0.03]

  it('percentCap + stamp duty: stessi endPortfolio, taxPaid, endCostBasis', () => {
    const legacy = runProjection(monoPlan(), returns)
    const multi = runProjection(
      withMonoAsset(monoPlan()),
      returns.map((r) => ({ equity: r, bonds: r, cash: r }))
    )

    expect(multi).toHaveLength(legacy.length)
    for (let t = 0; t < legacy.length; t++) {
      expect(multi[t].endPortfolio).toBeCloseTo(legacy[t].endPortfolio, 9)
      expect(multi[t].taxPaid).toBeCloseTo(legacy[t].taxPaid, 9)
      expect(multi[t].endCostBasis).toBeCloseTo(legacy[t].endCostBasis, 9)
      expect(multi[t].withdrawal).toBeCloseTo(legacy[t].withdrawal, 9)
      expect(multi[t].returnRate).toBe(returns[t])
      expect(multi[t].buckets).toBeDefined()
      expect(multi[t].buckets!.bonds.value).toBe(0)
    }
  })

  it('guardrails: stesso percorso di prelievo', () => {
    const overrides: Partial<Plan> = {
      withdrawalStrategy: {
        type: 'guardrails',
        initialRate: 0.05,
        lowerGuardrail: 0.04,
        upperGuardrail: 0.06,
        increasePct: 0.1,
        decreasePct: 0.1,
        skipInflationAfterNegativeReturn: true
      }
    }
    const legacy = runProjection(monoPlan(overrides), returns)
    const multi = runProjection(
      withMonoAsset(monoPlan(overrides)),
      returns.map((r) => ({ equity: r, bonds: r, cash: r }))
    )

    for (let t = 0; t < legacy.length; t++) {
      expect(multi[t].withdrawal).toBeCloseTo(legacy[t].withdrawal, 9)
      expect(multi[t].endPortfolio).toBeCloseTo(legacy[t].endPortfolio, 9)
    }
  })
})

describe('campionamento multivariato (Cholesky)', () => {
  it('la correlazione empirica converge a quella configurata', () => {
    const assets = {
      equity: { id: 'equity' as const, meanReturn: 0.05, returnStdDev: 0.15, taxRate: 0.26 },
      bonds: { id: 'bonds' as const, meanReturn: 0.02, returnStdDev: 0.06, taxRate: 0.125 },
      cash: { id: 'cash' as const, meanReturn: 0.01, returnStdDev: 0.01, taxRate: 0.26 }
    }
    const chol = cholesky3x3({ equityBonds: -0.3, equityCash: 0, bondsCash: 0 })
    const rng = mulberry32(42)

    const n = 50_000
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < n; i++) {
      const r = sampleMultiAssetReturns(rng, assets, chol)
      xs.push(Math.log(1 + r.equity))
      ys.push(Math.log(1 + r.bonds))
    }

    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
    const mx = mean(xs)
    const my = mean(ys)
    let cov = 0
    let vx = 0
    let vy = 0
    for (let i = 0; i < n; i++) {
      cov += (xs[i] - mx) * (ys[i] - my)
      vx += (xs[i] - mx) ** 2
      vy += (ys[i] - my) ** 2
    }
    const pearson = cov / Math.sqrt(vx * vy)
    expect(pearson).toBeGreaterThan(-0.315)
    expect(pearson).toBeLessThan(-0.285)
  })

  it('matrice non definita positiva → fallback identità (nessun NaN)', () => {
    const chol = cholesky3x3({ equityBonds: 0.99, equityCash: 0.99, bondsCash: -0.99 })
    const r = sampleMultiAssetReturns(
      mulberry32(1),
      {
        equity: { id: 'equity', meanReturn: 0.05, returnStdDev: 0.15, taxRate: 0.26 },
        bonds: { id: 'bonds', meanReturn: 0.02, returnStdDev: 0.06, taxRate: 0.125 },
        cash: { id: 'cash', meanReturn: 0.01, returnStdDev: 0.01, taxRate: 0.26 }
      },
      chol
    )
    expect(Number.isFinite(r.equity)).toBe(true)
    expect(Number.isFinite(r.bonds)).toBe(true)
    expect(Number.isFinite(r.cash)).toBe(true)
  })
})

describe('storico + multi-asset', () => {
  it('historicalRolling alimenta i bucket con i rendimenti storici per asset', () => {
    const dataset = [
      { calendarYear: 2000, equityReturn: 0.1, bondReturn: 0.02, inflationRate: 0.01 },
      { calendarYear: 2001, equityReturn: -0.2, bondReturn: 0.05, inflationRate: 0.02 },
      { calendarYear: 2002, equityReturn: 0.15, bondReturn: 0.01, inflationRate: 0.03 },
      { calendarYear: 2003, equityReturn: 0.05, bondReturn: 0.03, inflationRate: 0.04 },
      { calendarYear: 2004, equityReturn: -0.1, bondReturn: 0.04, inflationRate: 0.05 },
      { calendarYear: 2005, equityReturn: 0.2, bondReturn: 0.02, inflationRate: 0.06 }
    ]
    const plan: Plan = {
      startYear: 2026,
      birthYear: 1977,
      retirementAge: 49,
      lifeExpectancyAge: 53, // orizzonte 4
      initialPortfolio: 1_000_000,
      initialCostBasis: 1_000_000,
      annualIncome: 0,
      incomeGrowthRate: 0,
      annualExpenses: 10_000,
      inflationRate: 0.02,
      meanReturn: 0.05,
      returnStdDev: 0.15,
      runs: 10,
      seed: 42,
      taxRate: 0.26,
      withdrawalStrategy: { type: 'spendExpenses' },
      events: [],
      simulationMode: { type: 'historicalRolling', customDataset: dataset },
      multiAsset: {
        assets: {
          equity: { id: 'equity', meanReturn: 0.05, returnStdDev: 0.15, taxRate: 0.26 },
          bonds: { id: 'bonds', meanReturn: 0.02, returnStdDev: 0.06, taxRate: 0.125 },
          cash: { id: 'cash', meanReturn: 0.015, returnStdDev: 0.01, taxRate: 0.26 }
        },
        correlations: { equityBonds: 0, equityCash: 0, bondsCash: 0 },
        glidepath: { type: 'static', weights: { equity: 0.5, bonds: 0.5, cash: 0 } },
        rebalance: { mode: 'cashflowOnly' }
      }
    }

    const results = runMonteCarlo(plan)
    expect(results).toHaveLength(3)

    const first = results[0]
    // anno 0: bucket 50/50, returnRate blended = 0.5*0.1 + 0.5*0.02
    expect(first.years[0].returnRate).toBeCloseTo(0.5 * 0.1 + 0.5 * 0.02, 12)
    expect(first.years[0].buckets).toBeDefined()
    expect(first.years[0].inflationRate).toBe(0.01)
    // anno 1: equity -20%, bonds +5% → il bucket equity perde più del blended
    expect(first.years[1].returnRate).toBeLessThan(0)
    const eq1 = first.years[1].buckets!.equity.value
    const bond1 = first.years[1].buckets!.bonds.value
    expect(bond1).toBeGreaterThan(eq1)
  })
})

describe('persistence di multiAsset', () => {
  const validMultiAsset = {
    assets: {
      equity: { id: 'equity', meanReturn: 0.05, returnStdDev: 0.15, taxRate: 0.26 },
      bonds: { id: 'bonds', meanReturn: 0.02, returnStdDev: 0.06, taxRate: 0.125 },
      cash: { id: 'cash', meanReturn: 0.015, returnStdDev: 0.01, taxRate: 0.26 }
    },
    correlations: { equityBonds: -0.1, equityCash: 0, bondsCash: 0.1 },
    glidepath: {
      type: 'bondTent',
      accumulationWeights: { equity: 0.8, bonds: 0.2, cash: 0 },
      peakWeights: { equity: 0.4, bonds: 0.5, cash: 0.1 },
      postTentWeights: { equity: 0.7, bonds: 0.3, cash: 0 },
      yearsBeforeRetirement: 5,
      yearsAfterRetirement: 10
    },
    rebalance: { mode: 'threshold', band: 0.05 }
  }

  it('sanitizePlan preserva una configurazione valida', () => {
    const clean = sanitizePlan({ ...createDefaultPlan(), multiAsset: validMultiAsset })
    expect(clean.multiAsset).toEqual(validMultiAsset)
  })

  it('scarta configurazioni corrotte (glidepath a somma zero, asset mancanti)', () => {
    const zeroWeights = sanitizePlan({
      ...createDefaultPlan(),
      multiAsset: {
        ...validMultiAsset,
        glidepath: { type: 'static', weights: { equity: 0, bonds: 0, cash: 0 } }
      }
    })
    expect(zeroWeights.multiAsset).toBeUndefined()

    const missingAsset = sanitizePlan({
      ...createDefaultPlan(),
      multiAsset: { ...validMultiAsset, assets: { equity: validMultiAsset.assets.equity } }
    })
    expect(missingAsset.multiAsset).toBeUndefined()

    const unknownGlidepath = sanitizePlan({
      ...createDefaultPlan(),
      multiAsset: { ...validMultiAsset, glidepath: { type: 'spiral' } }
    })
    expect(unknownGlidepath.multiAsset).toBeUndefined()
  })

  it('clamp di band e correlazioni fuori range', () => {
    const clean = sanitizePlan({
      ...createDefaultPlan(),
      multiAsset: {
        ...validMultiAsset,
        correlations: { equityBonds: -5, equityCash: 3, bondsCash: 0.1 },
        rebalance: { mode: 'threshold', band: 99 }
      }
    })
    expect(clean.multiAsset?.correlations.equityBonds).toBe(-0.99)
    expect(clean.multiAsset?.correlations.equityCash).toBe(0.99)
    expect(clean.multiAsset?.rebalance).toEqual({ mode: 'threshold', band: 0.5 })
  })

  it('round-trip URL con multiAsset', () => {
    const plan = sanitizePlan({ ...createDefaultPlan(), multiAsset: validMultiAsset })
    const decoded = decodePlanFromUrlParam(encodePlanToUrlParam(plan))
    expect(decoded?.multiAsset).toEqual(validMultiAsset)
  })
})

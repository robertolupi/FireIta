import type {
  AssetClassParams,
  AssetYearReturns,
  HistoricalYearData,
  Plan,
  SimResult,
  SimulationMode,
  YearState
} from './types'
import { computeHistoricalPortfolioReturn, HISTORICAL_DATASETS } from './historicalData'
import { horizonYears, runProjection } from './projection'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function standardNormal(rng: () => number): number {
  let u = 0
  while (u === 0) u = rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function sampleAnnualReturn(
  rng: () => number,
  meanReturn: number,
  stdDev: number
): number {
  if (stdDev <= 0) return meanReturn
  const m = 1 + meanReturn
  const variance = Math.log(1 + (stdDev * stdDev) / (m * m))
  const mu = Math.log(m) - variance / 2
  return Math.exp(mu + Math.sqrt(variance) * standardNormal(rng)) - 1
}

/**
 * Fattorizzazione di Cholesky della matrice di correlazione 3x3
 * (ordine: equity, bonds, cash). Restituisce la matrice identità come
 * fallback difensivo se la matrice non è definita positiva.
 */
export function cholesky3x3(correlations: {
  equityBonds: number
  equityCash: number
  bondsCash: number
}): number[][] {
  const clamp = (x: number) => Math.max(-0.99, Math.min(0.99, x))
  const r21 = clamp(correlations.equityBonds)
  const r31 = clamp(correlations.equityCash)
  const r32 = clamp(correlations.bondsCash)

  const l11 = 1
  const l21 = r21
  const l22Sq = 1 - l21 * l21
  if (l22Sq <= 0) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ]
  }
  const l22 = Math.sqrt(l22Sq)
  const l31 = r31
  const l32 = (r32 - l31 * l21) / l22
  const l33Sq = l11 - l31 * l31 - l32 * l32
  if (l33Sq <= 0) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ]
  }
  const l33 = Math.sqrt(l33Sq)
  return [
    [l11, 0, 0],
    [l21, l22, 0],
    [l31, l32, l33]
  ]
}

/** Campiona un anno di rendimenti log-normali correlati per le tre asset class. */
export function sampleMultiAssetReturns(
  rng: () => number,
  assets: Record<'equity' | 'bonds' | 'cash', AssetClassParams>,
  chol: number[][]
): AssetYearReturns {
  const z = [standardNormal(rng), standardNormal(rng), standardNormal(rng)]
  const ids = ['equity', 'bonds', 'cash'] as const
  const out: AssetYearReturns = { equity: 0, bonds: 0, cash: 0 }
  for (let i = 0; i < 3; i++) {
    const y = chol[i][0] * z[0] + chol[i][1] * z[1] + chol[i][2] * z[2]
    const { meanReturn, returnStdDev } = assets[ids[i]]
    if (returnStdDev <= 0) {
      out[ids[i]] = meanReturn
    } else {
      const m = 1 + meanReturn
      const variance = Math.log(1 + (returnStdDev * returnStdDev) / (m * m))
      const mu = Math.log(m) - variance / 2
      out[ids[i]] = Math.exp(mu + Math.sqrt(variance) * y) - 1
    }
  }
  return out
}

function buildSimResult(run: number, plan: Plan, years: YearState[]): SimResult {
  const depletedState = years.find((y) => y.depleted)
  const firstShortfallState = years.find((y) => y.expensesNotCovered)
  const shortfallYearsCount = years.filter((y) => y.expensesNotCovered).length
  const survived = !depletedState

  return {
    run,
    years,
    finalPortfolio: years.length > 0 ? years[years.length - 1].endPortfolio : plan.initialPortfolio,
    depletionYear: depletedState ? depletedState.year : null,
    success: survived,
    firstShortfallYear: firstShortfallState ? firstShortfallState.year : null,
    shortfallYearsCount,
    fullCoverage: survived && !firstShortfallState
  }
}

function resolveDataset(
  mode: Extract<SimulationMode, { type: 'historicalRolling' | 'blockBootstrap' }>
): HistoricalYearData[] {
  if (mode.customDataset && mode.customDataset.length > 0) return mode.customDataset
  return HISTORICAL_DATASETS[mode.datasetId ?? 'usa']
}

export function sampleBlockBootstrapTrajectory(
  rng: () => number,
  dataset: HistoricalYearData[],
  horizon: number,
  blockSize: number,
  stockAllocation = 1,
  stationary = false,
  multiAssetCashMean?: number
): { returns: Array<number | AssetYearReturns>; inflations: number[] } {
  const n = dataset.length
  const k = Math.max(1, Math.floor(blockSize))
  const wEq = Math.max(0, Math.min(1, stockAllocation))
  const returns: Array<number | AssetYearReturns> = []
  const inflations: number[] = []

  const pushRow = (row: HistoricalYearData) => {
    if (multiAssetCashMean !== undefined) {
      returns.push({
        equity: row.equityReturn,
        bonds: row.bondReturn,
        cash: multiAssetCashMean
      })
    } else {
      returns.push(computeHistoricalPortfolioReturn(row, wEq))
    }
    inflations.push(row.inflationRate)
  }

  if (stationary) {
    let idx = Math.floor(rng() * n)
    for (let t = 0; t < horizon; t++) {
      if (t > 0) {
        idx = rng() < 1 / k ? Math.floor(rng() * n) : (idx + 1) % n
      }
      pushRow(dataset[idx])
    }
  } else {
    while (returns.length < horizon) {
      const startIdx = Math.floor(rng() * n)
      for (let j = 0; j < k && returns.length < horizon; j++) {
        pushRow(dataset[(startIdx + j) % n])
      }
    }
  }

  return { returns, inflations }
}

function runHistoricalRolling(
  plan: Plan,
  dataset: HistoricalYearData[],
  stockAllocation: number,
  multiAssetCashMean?: number
): SimResult[] {
  const horizon = horizonYears(plan)
  const n = dataset.length
  const results: SimResult[] = []

  const pushRow = (
    row: HistoricalYearData,
    returns: Array<number | AssetYearReturns>,
    inflations: number[]
  ) => {
    if (multiAssetCashMean !== undefined) {
      returns.push({ equity: row.equityReturn, bonds: row.bondReturn, cash: multiAssetCashMean })
    } else {
      returns.push(computeHistoricalPortfolioReturn(row, stockAllocation))
    }
    inflations.push(row.inflationRate)
  }

  if (horizon <= n) {
    for (let m = 0; m <= n - horizon; m++) {
      const returns: Array<number | AssetYearReturns> = []
      const inflations: number[] = []
      for (let t = 0; t < horizon; t++) {
        pushRow(dataset[m + t], returns, inflations)
      }
      results.push(buildSimResult(m, plan, runProjection(plan, returns, inflations)))
    }
  } else {
    // Orizzonte più lungo della serie storica: wrap-around circolare (stile cFIREsim)
    for (let m = 0; m < n; m++) {
      const returns: Array<number | AssetYearReturns> = []
      const inflations: number[] = []
      for (let t = 0; t < horizon; t++) {
        pushRow(dataset[(m + t) % n], returns, inflations)
      }
      results.push(buildSimResult(m, plan, runProjection(plan, returns, inflations)))
    }
  }

  return results
}

export function runMonteCarlo(plan: Plan): SimResult[] {
  const mode = plan.simulationMode ?? { type: 'parametric' }
  const ma = plan.multiAsset

  if (mode.type === 'historicalRolling') {
    const dataset = resolveDataset(mode)
    if (dataset.length > 0) {
      return runHistoricalRolling(plan, dataset, mode.stockAllocation ?? 1, ma?.assets.cash.meanReturn)
    }
  } else if (mode.type === 'blockBootstrap') {
    const dataset = resolveDataset(mode)
    if (dataset.length > 0) {
      const rng = mulberry32(plan.seed)
      const horizon = horizonYears(plan)
      const results: SimResult[] = []
      for (let run = 0; run < Math.max(0, plan.runs); run++) {
        const { returns, inflations } = sampleBlockBootstrapTrajectory(
          rng,
          dataset,
          horizon,
          mode.blockSize ?? 5,
          mode.stockAllocation ?? 1,
          mode.stationary ?? false,
          ma?.assets.cash.meanReturn
        )
        results.push(buildSimResult(run, plan, runProjection(plan, returns, inflations)))
      }
      return results
    }
  }

  const rng = mulberry32(plan.seed)
  const horizon = horizonYears(plan)
  const results: SimResult[] = []

  if (ma) {
    const chol = cholesky3x3(ma.correlations)
    for (let run = 0; run < Math.max(0, plan.runs); run++) {
      const returns: AssetYearReturns[] = Array.from({ length: horizon }, () =>
        sampleMultiAssetReturns(rng, ma.assets, chol)
      )
      results.push(buildSimResult(run, plan, runProjection(plan, returns)))
    }
    return results
  }

  for (let run = 0; run < Math.max(0, plan.runs); run++) {
    const returns = Array.from({ length: horizon }, () =>
      sampleAnnualReturn(rng, plan.meanReturn, plan.returnStdDev)
    )
    results.push(buildSimResult(run, plan, runProjection(plan, returns)))
  }

  return results
}

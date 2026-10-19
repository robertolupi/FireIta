import type { HistoricalYearData, Plan, SimResult, SimulationMode, YearState } from './types'
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
  stationary = false
): { returns: number[]; inflations: number[] } {
  const n = dataset.length
  const k = Math.max(1, Math.floor(blockSize))
  const wEq = Math.max(0, Math.min(1, stockAllocation))
  const returns: number[] = []
  const inflations: number[] = []

  if (stationary) {
    let idx = Math.floor(rng() * n)
    for (let t = 0; t < horizon; t++) {
      if (t > 0) {
        idx = rng() < 1 / k ? Math.floor(rng() * n) : (idx + 1) % n
      }
      const row = dataset[idx]
      returns.push(computeHistoricalPortfolioReturn(row, wEq))
      inflations.push(row.inflationRate)
    }
  } else {
    while (returns.length < horizon) {
      const startIdx = Math.floor(rng() * n)
      for (let j = 0; j < k && returns.length < horizon; j++) {
        const row = dataset[(startIdx + j) % n]
        returns.push(computeHistoricalPortfolioReturn(row, wEq))
        inflations.push(row.inflationRate)
      }
    }
  }

  return { returns, inflations }
}

function runHistoricalRolling(
  plan: Plan,
  dataset: HistoricalYearData[],
  stockAllocation: number
): SimResult[] {
  const horizon = horizonYears(plan)
  const n = dataset.length
  const results: SimResult[] = []

  if (horizon <= n) {
    for (let m = 0; m <= n - horizon; m++) {
      const returns: number[] = []
      const inflations: number[] = []
      for (let t = 0; t < horizon; t++) {
        const row = dataset[m + t]
        returns.push(computeHistoricalPortfolioReturn(row, stockAllocation))
        inflations.push(row.inflationRate)
      }
      results.push(buildSimResult(m, plan, runProjection(plan, returns, inflations)))
    }
  } else {
    // Orizzonte più lungo della serie storica: wrap-around circolare (stile cFIREsim)
    for (let m = 0; m < n; m++) {
      const returns: number[] = []
      const inflations: number[] = []
      for (let t = 0; t < horizon; t++) {
        const row = dataset[(m + t) % n]
        returns.push(computeHistoricalPortfolioReturn(row, stockAllocation))
        inflations.push(row.inflationRate)
      }
      results.push(buildSimResult(m, plan, runProjection(plan, returns, inflations)))
    }
  }

  return results
}

export function runMonteCarlo(plan: Plan): SimResult[] {
  const mode = plan.simulationMode ?? { type: 'parametric' }

  if (mode.type === 'historicalRolling') {
    const dataset = resolveDataset(mode)
    if (dataset.length > 0) {
      return runHistoricalRolling(plan, dataset, mode.stockAllocation ?? 1)
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
          mode.stationary ?? false
        )
        results.push(buildSimResult(run, plan, runProjection(plan, returns, inflations)))
      }
      return results
    }
  }

  const rng = mulberry32(plan.seed)
  const horizon = horizonYears(plan)
  const results: SimResult[] = []

  for (let run = 0; run < Math.max(0, plan.runs); run++) {
    const returns = Array.from({ length: horizon }, () =>
      sampleAnnualReturn(rng, plan.meanReturn, plan.returnStdDev)
    )
    results.push(buildSimResult(run, plan, runProjection(plan, returns)))
  }

  return results
}

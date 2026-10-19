import type { SimResult } from './types'

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const index = (p / 100) * (sortedValues.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower)
}

export interface YearBand {
  year: number
  age: number
  calendarYear?: number
  survivalRate?: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export type PercentileKey = 'p10' | 'p25' | 'p50' | 'p75' | 'p90'

export type PercentileRuns = Record<PercentileKey, SimResult | null>

export interface SimStats {
  runs: number
  /** Quota di run in cui il patrimonio non si esaurisce (depletionYear === null) */
  successRate: number
  /** Quota di run con patrimonio integro E 100% delle spese coperte in ogni anno */
  fullCoverageRate: number
  /** Quota di run con patrimonio non esaurito ma con almeno 1 anno di spese tagliate */
  cutSpendingRate: number
  /** Quota di run con patrimonio esaurito prima della fine dell'orizzonte */
  depletionRate: number
  finalPercentiles: { p10: number; p25: number; p50: number; p75: number; p90: number }
  meanDepletionAge: number | null
  meanFirstShortfallAge: number | null
  meanShortfallYears: number
  bands: YearBand[]
  medianRun: SimResult | null
  percentileRuns: PercentileRuns
}

/**
 * Restituisce il numero di anni in cui il portafoglio resta strettamente positivo.
 */
function survivalYears(run: SimResult): number {
  const idx = run.years.findIndex((y) => y.endPortfolio <= 0)
  return idx === -1 ? run.years.length : idx
}

/**
 * Comparatore che distingue le run esaurite in base a quanto presto finiscono i soldi,
 * e le run sopravvissute in base al patrimonio finale.
 */
export function compareSimRuns(a: SimResult, b: SimResult): number {
  const survA = survivalYears(a)
  const survB = survivalYears(b)
  if (survA !== survB) return survA - survB
  return a.finalPortfolio - b.finalPortfolio
}

function pickRunAtQuantile(sortedRuns: SimResult[], q: number): SimResult | null {
  if (sortedRuns.length === 0) return null
  const idx = Math.min(
    sortedRuns.length - 1,
    Math.max(0, Math.round(q * (sortedRuns.length - 1)))
  )
  return sortedRuns[idx]
}

export function percentileTyped(sortedValues: Float64Array, p: number): number {
  if (sortedValues.length === 0) return 0
  const index = (p / 100) * (sortedValues.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower)
}

export function computeStats(results: SimResult[]): SimStats {
  if (results.length === 0) {
    return {
      runs: 0,
      successRate: 0,
      fullCoverageRate: 0,
      cutSpendingRate: 0,
      depletionRate: 0,
      finalPercentiles: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
      meanDepletionAge: null,
      meanFirstShortfallAge: null,
      meanShortfallYears: 0,
      bands: [],
      medianRun: null,
      percentileRuns: {
        p10: null,
        p25: null,
        p50: null,
        p75: null,
        p90: null
      }
    }
  }

  const runCount = results.length
  const finalsBuffer = new Float64Array(runCount)
  for (let r = 0; r < runCount; r++) {
    finalsBuffer[r] = results[r].finalPortfolio
  }
  finalsBuffer.sort()

  const successes = results.filter((r) => r.success).length
  const fullCoverages = results.filter((r) => r.fullCoverage).length
  const cutSpendingRuns = results.filter((r) => r.success && !r.fullCoverage).length
  const depletedRuns = runCount - successes

  const depletionAges = results
    .filter((r) => r.depletionYear !== null)
    .map((r) => r.years[r.depletionYear as number].age)

  const shortfallRuns = results.filter((r) => r.firstShortfallYear !== null)
  const firstShortfallAges = shortfallRuns.map(
    (r) => r.years[r.firstShortfallYear as number].age
  )
  const meanFirstShortfallAge =
    firstShortfallAges.length > 0
      ? firstShortfallAges.reduce((sum, a) => sum + a, 0) / firstShortfallAges.length
      : null

  const meanShortfallYears =
    shortfallRuns.length > 0
      ? shortfallRuns.reduce((sum, r) => sum + r.shortfallYearsCount, 0) / shortfallRuns.length
      : 0

  const yearCount = results[0].years.length
  const bands: YearBand[] = []
  const colBuffer = new Float64Array(runCount)

  for (let year = 0; year < yearCount; year++) {
    let aliveCount = 0
    for (let r = 0; r < runCount; r++) {
      const y = results[r].years[year]
      colBuffer[r] = y.endPortfolio
      if (!y.depleted) aliveCount++
    }
    colBuffer.sort()
    bands.push({
      year,
      age: results[0].years[year].age,
      calendarYear: results[0].years[year].calendarYear,
      survivalRate: aliveCount / runCount,
      p10: percentileTyped(colBuffer, 10),
      p25: percentileTyped(colBuffer, 25),
      p50: percentileTyped(colBuffer, 50),
      p75: percentileTyped(colBuffer, 75),
      p90: percentileTyped(colBuffer, 90)
    })
  }

  const sortedByOutcome = [...results].sort(compareSimRuns)
  const percentileRuns: PercentileRuns = {
    p10: pickRunAtQuantile(sortedByOutcome, 0.1),
    p25: pickRunAtQuantile(sortedByOutcome, 0.25),
    p50: pickRunAtQuantile(sortedByOutcome, 0.5),
    p75: pickRunAtQuantile(sortedByOutcome, 0.75),
    p90: pickRunAtQuantile(sortedByOutcome, 0.9)
  }
  const medianRun = percentileRuns.p50

  return {
    runs: runCount,
    successRate: successes / runCount,
    fullCoverageRate: fullCoverages / runCount,
    cutSpendingRate: cutSpendingRuns / runCount,
    depletionRate: depletedRuns / runCount,
    finalPercentiles: {
      p10: percentileTyped(finalsBuffer, 10),
      p25: percentileTyped(finalsBuffer, 25),
      p50: percentileTyped(finalsBuffer, 50),
      p75: percentileTyped(finalsBuffer, 75),
      p90: percentileTyped(finalsBuffer, 90)
    },
    meanDepletionAge:
      depletionAges.length > 0
        ? depletionAges.reduce((sum, a) => sum + a, 0) / depletionAges.length
        : null,
    meanFirstShortfallAge,
    meanShortfallYears,
    bands,
    medianRun,
    percentileRuns
  }
}

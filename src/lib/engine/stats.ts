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
      medianRun: null
    }
  }

  const finals = results.map((r) => r.finalPortfolio).sort((a, b) => a - b)
  const successes = results.filter((r) => r.success).length
  const fullCoverages = results.filter((r) => r.fullCoverage).length
  const cutSpendingRuns = results.filter((r) => r.success && !r.fullCoverage).length
  const depletedRuns = results.length - successes

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
  for (let year = 0; year < yearCount; year++) {
    const values = results.map((r) => r.years[year].endPortfolio).sort((a, b) => a - b)
    const aliveCount = results.filter((r) => !r.years[year].depleted).length
    bands.push({
      year,
      age: results[0].years[year].age,
      calendarYear: results[0].years[year].calendarYear,
      survivalRate: aliveCount / results.length,
      p10: percentile(values, 10),
      p25: percentile(values, 25),
      p50: percentile(values, 50),
      p75: percentile(values, 75),
      p90: percentile(values, 90)
    })
  }

  const sortedByFinal = [...results].sort((a, b) => a.finalPortfolio - b.finalPortfolio)
  const medianRun = sortedByFinal[Math.floor((sortedByFinal.length - 1) / 2)]

  return {
    runs: results.length,
    successRate: successes / results.length,
    fullCoverageRate: fullCoverages / results.length,
    cutSpendingRate: cutSpendingRuns / results.length,
    depletionRate: depletedRuns / results.length,
    finalPercentiles: {
      p10: percentile(finals, 10),
      p25: percentile(finals, 25),
      p50: percentile(finals, 50),
      p75: percentile(finals, 75),
      p90: percentile(finals, 90)
    },
    meanDepletionAge:
      depletionAges.length > 0
        ? depletionAges.reduce((sum, a) => sum + a, 0) / depletionAges.length
        : null,
    meanFirstShortfallAge,
    meanShortfallYears,
    bands,
    medianRun
  }
}

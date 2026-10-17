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
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export interface SimStats {
  runs: number
  successRate: number
  finalPercentiles: { p10: number; p25: number; p50: number; p75: number; p90: number }
  meanDepletionAge: number | null
  bands: YearBand[]
  medianRun: SimResult | null
}

export function computeStats(results: SimResult[]): SimStats {
  if (results.length === 0) {
    return {
      runs: 0,
      successRate: 0,
      finalPercentiles: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
      meanDepletionAge: null,
      bands: [],
      medianRun: null
    }
  }

  const finals = results.map((r) => r.finalPortfolio).sort((a, b) => a - b)
  const successes = results.filter((r) => r.success).length
  const depletionAges = results
    .filter((r) => r.depletionYear !== null)
    .map((r) => r.years[r.depletionYear as number].age)

  const yearCount = results[0].years.length
  const bands: YearBand[] = []
  for (let year = 0; year < yearCount; year++) {
    const values = results.map((r) => r.years[year].endPortfolio).sort((a, b) => a - b)
    bands.push({
      year,
      age: results[0].years[year].age,
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
    bands,
    medianRun
  }
}

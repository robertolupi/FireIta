import type { SimResult, YearState } from './types'
import type { PercentileRuns, SimStats, YearBand } from './stats'

export type ValueMode = 'nominal' | 'real'

/**
 * Calcola il divisore di inflazione cumulata (1 + r_infl)^t.
 * Accetta sia un anno di calendario (es. 2036 >= startYear) sia un indice 0-based (es. 10 < startYear).
 */
export function inflationDivisor(year: number, startYear: number, inflationRate: number): number {
  const t = year >= startYear ? year - startYear : Math.max(0, year)
  const safeBase = Math.max(0.01, 1 + inflationRate)
  return Math.pow(safeBase, t)
}

/**
 * Converte uno stato annuale nominale in valori reali (euro dell'anno startYear).
 */
export function deflateYearState(
  state: YearState,
  startYear: number,
  inflationRate: number
): YearState {
  const yearRef =
    state.year >= startYear
      ? state.year
      : state.calendarYear >= startYear
        ? state.calendarYear
        : state.year
  const d = inflationDivisor(yearRef, startYear, inflationRate)
  if (d === 1) return state

  return {
    ...state,
    income: state.income / d,
    expenses: state.expenses / d,
    contribution: state.contribution / d,
    withdrawal: state.withdrawal / d,
    grossSale: state.grossSale / d,
    taxPaid: state.taxPaid / d,
    ...(state.stampDutyPaid !== undefined ? { stampDutyPaid: state.stampDutyPaid / d } : {}),
    ...(state.pensionFundBalance !== undefined
      ? { pensionFundBalance: state.pensionFundBalance / d }
      : {}),
    ...(state.cashBufferStart !== undefined ? { cashBufferStart: state.cashBufferStart / d } : {}),
    ...(state.cashBufferEnd !== undefined ? { cashBufferEnd: state.cashBufferEnd / d } : {}),
    ...(state.bufferWithdrawal !== undefined
      ? { bufferWithdrawal: state.bufferWithdrawal / d }
      : {}),
    ...(state.bufferRefill !== undefined ? { bufferRefill: state.bufferRefill / d } : {}),
    ...(state.cashBufferBalance !== undefined
      ? { cashBufferBalance: state.cashBufferBalance / d }
      : {}),
    ...(state.cashBufferMovement !== undefined
      ? { cashBufferMovement: state.cashBufferMovement / d }
      : {}),
    investmentReturn: state.investmentReturn / d,
    startPortfolio: state.startPortfolio / d,
    endPortfolio: state.endPortfolio / d,
    endCostBasis: state.endCostBasis / d,
    ...(state.rebalanceTaxPaid !== undefined
      ? { rebalanceTaxPaid: state.rebalanceTaxPaid / d }
      : {}),
    ...(state.buckets
      ? {
          buckets: {
            equity: {
              value: state.buckets.equity.value / d,
              costBasis: state.buckets.equity.costBasis / d
            },
            bonds: {
              value: state.buckets.bonds.value / d,
              costBasis: state.buckets.bonds.costBasis / d
            },
            cash: {
              value: state.buckets.cash.value / d,
              costBasis: state.buckets.cash.costBasis / d
            }
          }
        }
      : {})
  }
}

/**
 * Converte una YearBand (percentili p10..p90 per l'anno y) in valori reali.
 */
export function deflateYearBand(
  band: YearBand,
  startYear: number,
  inflationRate: number
): YearBand {
  const d = inflationDivisor(band.year, startYear, inflationRate)
  if (d === 1) return band

  return {
    ...band,
    p10: band.p10 / d,
    p25: band.p25 / d,
    p50: band.p50 / d,
    p75: band.p75 / d,
    p90: band.p90 / d
  }
}

function deflateSimResult(
  run: SimResult | null,
  startYear: number,
  inflationRate: number
): SimResult | null {
  if (!run) return null
  const years = run.years.map((y) => deflateYearState(y, startYear, inflationRate))
  return {
    ...run,
    years,
    finalPortfolio: years.length > 0 ? years[years.length - 1].endPortfolio : 0
  }
}

/**
 * Converte l'intero oggetto SimStats nel ValueMode richiesto.
 */
export function transformSimStats(
  stats: SimStats,
  startYear: number,
  inflationRate: number,
  mode: ValueMode
): SimStats {
  if (mode === 'nominal') return stats

  const bands = stats.bands.map((b) => deflateYearBand(b, startYear, inflationRate))
  const lastBand = bands[bands.length - 1]

  const finalPercentiles = lastBand
    ? {
        p10: lastBand.p10,
        p25: lastBand.p25,
        p50: lastBand.p50,
        p75: lastBand.p75,
        p90: lastBand.p90
      }
    : stats.finalPercentiles

  const percentileRuns: PercentileRuns = {
    p10: deflateSimResult(stats.percentileRuns.p10, startYear, inflationRate),
    p25: deflateSimResult(stats.percentileRuns.p25, startYear, inflationRate),
    p50: deflateSimResult(stats.percentileRuns.p50, startYear, inflationRate),
    p75: deflateSimResult(stats.percentileRuns.p75, startYear, inflationRate),
    p90: deflateSimResult(stats.percentileRuns.p90, startYear, inflationRate)
  }

  const medianRun =
    percentileRuns.p50 ?? deflateSimResult(stats.medianRun, startYear, inflationRate)

  return {
    ...stats,
    bands,
    finalPercentiles,
    medianRun,
    percentileRuns
  }
}

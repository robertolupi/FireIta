import type { Plan, SimResult } from './types'
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

export function runMonteCarlo(plan: Plan): SimResult[] {
  const rng = mulberry32(plan.seed)
  const horizon = horizonYears(plan)
  const results: SimResult[] = []

  for (let run = 0; run < Math.max(0, plan.runs); run++) {
    const returns = Array.from({ length: horizon }, () =>
      sampleAnnualReturn(rng, plan.meanReturn, plan.returnStdDev)
    )
    const years = runProjection(plan, returns)
    const depletedState = years.find((y) => y.depleted)
    results.push({
      run,
      years,
      finalPortfolio: years.length > 0 ? years[years.length - 1].endPortfolio : plan.initialPortfolio,
      depletionYear: depletedState ? depletedState.year : null,
      success: !depletedState
    })
  }

  return results
}

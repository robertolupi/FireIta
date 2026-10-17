import { runMonteCarlo } from '../engine/montecarlo'
import { computeStats, type SimStats } from '../engine/stats'
import { transformSimStats, type ValueMode } from '../engine/deflate'
import type { Plan, SimResult } from '../engine/types'

function createPlanStore() {
  const plan = $state<Plan>({
    startYear: new Date().getFullYear(),
    birthYear: 1977,
    retirementAge: 67,
    lifeExpectancyAge: 95,
    initialPortfolio: 100_000,
    initialCostBasis: 80_000,
    annualIncome: 40_000,
    incomeGrowthRate: 0.02,
    annualExpenses: 25_000,
    inflationRate: 0.02,
    meanReturn: 0.05,
    returnStdDev: 0.15,
    runs: 1_000,
    seed: 42,
    taxRate: 0.26,
    stampDutyRate: 0.002,
    whitelistAllocation: 0,
    withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
    events: []
  })

  let valueMode = $state<ValueMode>('real')

  const results: SimResult[] = $derived(runMonteCarlo(plan))
  const rawStats: SimStats = $derived(computeStats(results))
  const displayStats: SimStats = $derived(
    transformSimStats(rawStats, plan.startYear, plan.inflationRate, valueMode)
  )

  return {
    plan,
    get valueMode() {
      return valueMode
    },
    set valueMode(v: ValueMode) {
      valueMode = v
    },
    get results() {
      return results
    },
    get stats() {
      return displayStats
    },
    get rawStats() {
      return rawStats
    }
  }
}

export const planStore = createPlanStore()

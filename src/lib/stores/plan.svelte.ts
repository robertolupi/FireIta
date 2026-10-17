import { runMonteCarlo } from '../engine/montecarlo'
import { computeStats, type SimStats } from '../engine/stats'
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

  const results: SimResult[] = $derived(runMonteCarlo(plan))
  const stats: SimStats = $derived(computeStats(results))

  return {
    plan,
    get results() {
      return results
    },
    get stats() {
      return stats
    }
  }
}

export const planStore = createPlanStore()

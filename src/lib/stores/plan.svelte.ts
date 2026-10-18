import { runMonteCarlo } from '../engine/montecarlo'
import { computeStats, type SimStats } from '../engine/stats'
import { transformSimStats, type ValueMode } from '../engine/deflate'
import type { Plan, SimResult } from '../engine/types'
import {
  BASELINE_STORAGE_KEY,
  STORAGE_KEY,
  createDefaultPlan,
  decodePlanFromUrlParam,
  sanitizePlan
} from '../persistence'

function loadInitialPlan(): Plan {
  if (typeof window === 'undefined') return createDefaultPlan()
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('plan')
    if (fromUrl) {
      const decoded = decodePlanFromUrlParam(fromUrl)
      if (decoded) return decoded
    }
  } catch {
    // Ignora errori URL
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved) return sanitizePlan(JSON.parse(saved))
  } catch {
    // Fallback al piano di default
  }
  return createDefaultPlan()
}

function loadInitialBaseline(): Plan | null {
  if (typeof window === 'undefined') return null
  try {
    const saved = window.localStorage.getItem(BASELINE_STORAGE_KEY)
    if (saved) return sanitizePlan(JSON.parse(saved))
  } catch {
    // Ignora errori storage
  }
  return null
}

function createPlanStore() {
  const plan = $state<Plan>(loadInitialPlan())
  let baselinePlan = $state<Plan | null>(loadInitialBaseline())
  let valueMode = $state<ValueMode>('real')

  const results: SimResult[] = $derived(runMonteCarlo(plan))
  const rawStats: SimStats = $derived(computeStats(results))
  const displayStats: SimStats = $derived(
    transformSimStats(rawStats, plan.startYear, plan.inflationRate, valueMode)
  )

  const baselineResults: SimResult[] | null = $derived(
    baselinePlan ? runMonteCarlo(baselinePlan) : null
  )
  const rawBaselineStats: SimStats | null = $derived(
    baselineResults ? computeStats(baselineResults) : null
  )
  const displayBaselineStats: SimStats | null = $derived(
    rawBaselineStats && baselinePlan
      ? transformSimStats(
          rawBaselineStats,
          baselinePlan.startYear,
          baselinePlan.inflationRate,
          valueMode
        )
      : null
  )

  function replacePlan(next: Plan) {
    const clean = sanitizePlan(next)
    Object.assign(plan, clean)
    if (clean.pensionFund === undefined) {
      plan.pensionFund = undefined
    }
    if (clean.stampDutyRate === undefined) {
      plan.stampDutyRate = undefined
    }
    if (clean.whitelistAllocation === undefined) {
      plan.whitelistAllocation = undefined
    }
  }

  function pinBaseline() {
    baselinePlan = structuredClone($state.snapshot(plan))
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baselinePlan))
      } catch {
        // Ignora errori storage
      }
    }
  }

  function clearBaseline() {
    baselinePlan = null
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(BASELINE_STORAGE_KEY)
      } catch {
        // Ignora errori storage
      }
    }
  }

  function swapWithBaseline() {
    if (!baselinePlan) return
    const currentSnapshot = structuredClone($state.snapshot(plan))
    replacePlan(baselinePlan)
    baselinePlan = currentSnapshot
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baselinePlan))
      } catch {
        // Ignora errori storage
      }
    }
  }

  function resetToDefault() {
    replacePlan(createDefaultPlan())
  }

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
    },
    get baselinePlan() {
      return baselinePlan
    },
    get baselineStats() {
      return displayBaselineStats
    },
    get rawBaselineStats() {
      return rawBaselineStats
    },
    replacePlan,
    pinBaseline,
    clearBaseline,
    swapWithBaseline,
    resetToDefault
  }
}

export const planStore = createPlanStore()

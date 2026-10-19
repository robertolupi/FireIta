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
import {
  solveGoalSeek,
  type GoalSeekRequest,
  type GoalSeekResult,
  type GoalSeekTargetParam
} from '../engine/goalSeek'

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

import type { WorkerResponse, WorkerRequest } from '../engine/worker'

const DEBOUNCE_MS = 300

function createPlanStore() {
  const initial = loadInitialPlan()
  const initialBaseline = loadInitialBaseline()

  const plan = $state<Plan>(initial)
  let committedPlan = $state<Plan>(structuredClone(initial))
  let lastCommittedJson = JSON.stringify(initial)

  let isPending = $state(false)
  let isCalculating = $state(false)
  let remainingMs = $state(0)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let countdownInterval: ReturnType<typeof setInterval> | null = null

  let baselinePlan = $state<Plan | null>(initialBaseline)
  let valueMode = $state<ValueMode>('real')

  // Computazione iniziale sincrona (per SSR, primo render istantaneo e Vitest)
  const initialResults = runMonteCarlo(initial)
  const initialStats = computeStats(initialResults)
  let results = $state<SimResult[]>(initialResults)
  let rawStats = $state<SimStats>(initialStats)

  const initialBaselineResults = initialBaseline ? runMonteCarlo(initialBaseline) : null
  const initialBaselineStats = initialBaselineResults ? computeStats(initialBaselineResults) : null
  let baselineResults = $state<SimResult[] | null>(initialBaselineResults)
  let rawBaselineStats = $state<SimStats | null>(initialBaselineStats)

  let worker: Worker | null = null
  let latestRequestId = 0

  function getWorker(): Worker | null {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return null
    if (!worker) {
      try {
        worker = new Worker(new URL('../engine/worker.ts', import.meta.url), {
          type: 'module'
        })
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data
          if (!msg) return
          if (msg.type === 'SIMULATE_DONE') {
            if (msg.requestId === latestRequestId) {
              rawStats = msg.stats
              results = msg.results
              isCalculating = false
            }
          } else if (msg.type === 'ERROR') {
            console.error('Worker error:', msg.message)
            if (msg.requestId === latestRequestId) {
              isCalculating = false
            }
          }
        }
        worker.onerror = (e) => {
          console.error('Worker error:', e)
          isCalculating = false
        }
      } catch (e) {
        console.warn('Worker creation failed, falling back to sync:', e)
        worker = null
      }
    }
    return worker
  }

  function triggerSimulation(targetPlan: Plan) {
    const w = getWorker()
    if (w) {
      isCalculating = true
      const reqId = ++latestRequestId
      const req: WorkerRequest = {
        type: 'SIMULATE',
        requestId: reqId,
        plan: targetPlan,
        includeAllRuns: true
      }
      w.postMessage(req)
    } else {
      isCalculating = false
      const res = runMonteCarlo(targetPlan)
      results = res
      rawStats = computeStats(res)
    }
  }

  const displayStats: SimStats = $derived(
    transformSimStats(rawStats, committedPlan.startYear, committedPlan.inflationRate, valueMode)
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

  function clearTimers() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (countdownInterval) {
      clearInterval(countdownInterval)
      countdownInterval = null
    }
  }

  function commitNow() {
    clearTimers()
    const snap = structuredClone($state.snapshot(plan))
    lastCommittedJson = JSON.stringify(snap)
    committedPlan = snap
    isPending = false
    remainingMs = 0
    triggerSimulation(snap)
  }

  function notifyPlanChanged(snapshotJson: string) {
    if (snapshotJson === lastCommittedJson) {
      clearTimers()
      isPending = false
      remainingMs = 0
      return
    }
    clearTimers()
    isPending = true
    remainingMs = DEBOUNCE_MS
    const deadline = Date.now() + DEBOUNCE_MS
    countdownInterval = setInterval(() => {
      remainingMs = Math.max(0, deadline - Date.now())
    }, 50)
    debounceTimer = setTimeout(() => {
      commitNow()
    }, DEBOUNCE_MS)
  }

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
    if (clean.cashflowTiming === undefined) {
      plan.cashflowTiming = undefined
    }
    if (clean.cashBuffer === undefined) {
      plan.cashBuffer = undefined
    }
    commitNow()
  }

  function pinBaseline() {
    commitNow()
    baselinePlan = structuredClone($state.snapshot(committedPlan))
    rawBaselineStats = structuredClone($state.snapshot(rawStats))
    baselineResults = structuredClone($state.snapshot(results))
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
    rawBaselineStats = null
    baselineResults = null
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
    const prevBaseline = structuredClone($state.snapshot(baselinePlan))
    const prevBaselineStats = rawBaselineStats
      ? structuredClone($state.snapshot(rawBaselineStats))
      : null
    const prevBaselineResults = baselineResults
      ? structuredClone($state.snapshot(baselineResults))
      : null

    replacePlan(prevBaseline)
    baselinePlan = currentSnapshot
    rawBaselineStats = prevBaselineStats
    baselineResults = prevBaselineResults

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

  async function runGoalSeek(
    param: GoalSeekTargetParam,
    targetSuccessRate = 0.9,
    options?: Partial<Omit<GoalSeekRequest, 'plan' | 'param' | 'targetSuccessRate'>>
  ): Promise<GoalSeekResult> {
    const currentPlan = structuredClone($state.snapshot(committedPlan))
    const request: GoalSeekRequest = {
      plan: currentPlan,
      param,
      targetSuccessRate,
      ...options
    }

    const w = getWorker()
    if (w) {
      isCalculating = true
      return new Promise<GoalSeekResult>((resolve, reject) => {
        const reqId = ++latestRequestId
        const handler = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data
          if (msg && msg.requestId === reqId) {
            w.removeEventListener('message', handler)
            isCalculating = false
            if (msg.type === 'GOAL_SEEK_DONE') {
              resolve(msg.result)
            } else if (msg.type === 'ERROR') {
              reject(new Error(msg.message))
            }
          }
        }
        w.addEventListener('message', handler)
        w.postMessage({
          type: 'GOAL_SEEK',
          requestId: reqId,
          payload: request
        })
      })
    } else {
      return solveGoalSeek(request)
    }
  }

  return {
    plan,
    get committedPlan() {
      return committedPlan
    },
    get isPending() {
      return isPending
    },
    get isCalculating() {
      return isCalculating
    },
    get remainingSeconds() {
      return Math.ceil(remainingMs / 1000)
    },
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
    notifyPlanChanged,
    commitNow,
    replacePlan,
    pinBaseline,
    clearBaseline,
    swapWithBaseline,
    resetToDefault,
    runGoalSeek
  }
}

export const planStore = createPlanStore()

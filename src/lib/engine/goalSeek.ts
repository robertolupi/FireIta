import type { Plan } from './types'
import { runMonteCarlo } from './montecarlo'

export type GoalSeekTargetParam =
  | 'retirementAge'
  | 'annualExpenses'
  | 'annualIncome'
  | 'initialPortfolio'

export interface GoalSeekRequest {
  plan: Plan
  param: GoalSeekTargetParam
  targetSuccessRate: number // es. 0.90
  minBound?: number
  maxBound?: number
  tolerance?: number // default: 1 per retirementAge, 100 (€) per importi monetari
  maxIterations?: number // default: 25
}

export interface GoalSeekResult {
  status: 'converged' | 'unreachable' | 'alreadyMet'
  param: GoalSeekTargetParam
  optimalValue: number
  achievedSuccessRate: number
  iterations: number
}

/**
 * Valuta il tasso di successo empirico riutilizzando Common Random Numbers (CRN)
 * con il seed specificato in plan.seed.
 */
export function evaluateSuccessRate(plan: Plan): number {
  const results = runMonteCarlo(plan)
  if (results.length === 0) return 0
  let successes = 0
  for (let i = 0; i < results.length; i++) {
    if (results[i].success) successes++
  }
  return successes / results.length
}

function clonePlanWithParam(basePlan: Plan, param: GoalSeekTargetParam, value: number): Plan {
  const p = structuredClone(basePlan)
  if (param === 'retirementAge') {
    p.retirementAge = Math.round(value)
  } else if (param === 'annualExpenses') {
    p.annualExpenses = Math.max(0, value)
  } else if (param === 'annualIncome') {
    p.annualIncome = Math.max(0, value)
  } else if (param === 'initialPortfolio') {
    p.initialPortfolio = Math.max(0, value)
    p.initialCostBasis = Math.min(p.initialCostBasis, p.initialPortfolio)
  }
  return p
}

export function solveGoalSeek(req: GoalSeekRequest): GoalSeekResult {
  const { plan, param, targetSuccessRate, maxIterations = 25 } = req
  const currentAge = plan.startYear - plan.birthYear

  // 1. Risolutore discreto per retirementAge (variabile intera)
  if (param === 'retirementAge') {
    const minBound = Math.max(
      currentAge,
      req.minBound !== undefined ? Math.round(req.minBound) : currentAge
    )
    const maxBound = Math.max(
      minBound,
      req.maxBound !== undefined ? Math.round(req.maxBound) : plan.lifeExpectancyAge - 1
    )

    let iterations = 0

    // Verifica estremo inferiore (già raggiunto all'età minima / attuale?)
    iterations++
    const rateAtMin = evaluateSuccessRate(clonePlanWithParam(plan, param, minBound))
    if (rateAtMin >= targetSuccessRate) {
      return {
        status: 'alreadyMet',
        param,
        optimalValue: minBound,
        achievedSuccessRate: rateAtMin,
        iterations
      }
    }

    // Verifica estremo superiore (irraggiungibile anche ritirandosi all'età massima?)
    iterations++
    const rateAtMax = evaluateSuccessRate(clonePlanWithParam(plan, param, maxBound))
    if (rateAtMax < targetSuccessRate) {
      return {
        status: 'unreachable',
        param,
        optimalValue: maxBound,
        achievedSuccessRate: rateAtMax,
        iterations
      }
    }

    // Ricerca binaria intera: invariante S(low) < target <= S(high)
    let low = minBound
    let high = maxBound
    let highRate = rateAtMax

    while (low + 1 < high && iterations < maxIterations) {
      iterations++
      const mid = Math.floor((low + high) / 2)
      const midRate = evaluateSuccessRate(clonePlanWithParam(plan, param, mid))
      if (midRate >= targetSuccessRate) {
        high = mid
        highRate = midRate
      } else {
        low = mid
      }
    }

    return {
      status: 'converged',
      param,
      optimalValue: high,
      achievedSuccessRate: highRate,
      iterations
    }
  }

  // 2. Risolutore continuo per parametri monetari: annualExpenses, annualIncome, initialPortfolio
  const isExpenses = param === 'annualExpenses'
  const tolerance = req.tolerance !== undefined && req.tolerance > 0 ? req.tolerance : 100

  // Calcolo dei bound di default se non specificati
  let minBound = req.minBound !== undefined ? Math.max(0, req.minBound) : 0
  let maxBound: number
  if (req.maxBound !== undefined) {
    maxBound = Math.max(minBound + tolerance, req.maxBound)
  } else if (isExpenses) {
    maxBound = Math.max(plan.annualExpenses * 3, plan.initialPortfolio * 0.25 + plan.annualIncome, 100_000)
  } else if (param === 'annualIncome') {
    maxBound = Math.max(plan.annualIncome * 4, plan.annualExpenses * 3, 200_000)
  } else {
    // initialPortfolio
    maxBound = Math.max(plan.initialPortfolio * 4, plan.annualExpenses * 40, 2_000_000)
  }

  let iterations = 0

  if (isExpenses) {
    // annualExpenses: S(theta) decresce con theta (più spendo, meno probabilità ho)
    // worst bound = maxBound (spesa massima, probabilità minima)
    // best bound = minBound (spesa minima 0, probabilità massima)

    // Se a maxBound il tasso è già >= target, il target è già soddisfatto
    iterations++
    const rateAtMax = evaluateSuccessRate(clonePlanWithParam(plan, param, maxBound))
    if (rateAtMax >= targetSuccessRate) {
      return {
        status: 'alreadyMet',
        param,
        optimalValue: maxBound,
        achievedSuccessRate: rateAtMax,
        iterations
      }
    }

    // Se a minBound (es. 0 spese) il tasso è < target, il target è irraggiungibile
    iterations++
    const rateAtMin = evaluateSuccessRate(clonePlanWithParam(plan, param, minBound))
    if (rateAtMin < targetSuccessRate) {
      return {
        status: 'unreachable',
        param,
        optimalValue: minBound,
        achievedSuccessRate: rateAtMin,
        iterations
      }
    }

    // Invariante: S(a) >= target, S(b) < target
    let a = minBound
    let b = maxBound
    let rateA = rateAtMin

    while (b - a > tolerance && iterations < maxIterations) {
      iterations++
      const m = (a + b) / 2
      const rateM = evaluateSuccessRate(clonePlanWithParam(plan, param, m))
      if (rateM >= targetSuccessRate) {
        a = m
        rateA = rateM
      } else {
        b = m
      }
    }

    // Restituiamo il valore conservativo a (che garantisce S(a) >= target)
    // Arrotondato al passo di tolleranza per leggibilità se compatibile
    let optVal = Math.floor(a / tolerance) * tolerance
    if (optVal < minBound) optVal = a
    let achievedRate = rateA
    if (optVal !== a) {
      iterations++
      achievedRate = evaluateSuccessRate(clonePlanWithParam(plan, param, optVal))
      if (achievedRate < targetSuccessRate) {
        optVal = a
        achievedRate = rateA
      }
    }

    return {
      status: 'converged',
      param,
      optimalValue: Math.round(optVal * 100) / 100,
      achievedSuccessRate: achievedRate,
      iterations
    }
  } else {
    // annualIncome o initialPortfolio: S(theta) cresce con theta (più ho, più ho successo)
    // worst bound = minBound (0 entrate / 0 capitale, successo minimo)
    // best bound = maxBound (successo massimo)

    // Se al minimo sforzo il tasso è già >= target
    iterations++
    const rateAtMin = evaluateSuccessRate(clonePlanWithParam(plan, param, minBound))
    if (rateAtMin >= targetSuccessRate) {
      return {
        status: 'alreadyMet',
        param,
        optimalValue: minBound,
        achievedSuccessRate: rateAtMin,
        iterations
      }
    }

    // Se a maxBound il tasso è ancora < target, prova a espandere maxBound se non impostato esplicitamente
    iterations++
    let rateAtMax = evaluateSuccessRate(clonePlanWithParam(plan, param, maxBound))
    if (req.maxBound === undefined) {
      while (rateAtMax < targetSuccessRate && maxBound < 20_000_000 && iterations < maxIterations) {
        maxBound *= 2
        iterations++
        rateAtMax = evaluateSuccessRate(clonePlanWithParam(plan, param, maxBound))
      }
    }

    if (rateAtMax < targetSuccessRate) {
      return {
        status: 'unreachable',
        param,
        optimalValue: maxBound,
        achievedSuccessRate: rateAtMax,
        iterations
      }
    }

    // Invariante: S(a) < target, S(b) >= target
    let a = minBound
    let b = maxBound
    let rateB = rateAtMax

    while (b - a > tolerance && iterations < maxIterations) {
      iterations++
      const m = (a + b) / 2
      const rateM = evaluateSuccessRate(clonePlanWithParam(plan, param, m))
      if (rateM >= targetSuccessRate) {
        b = m
        rateB = rateM
      } else {
        a = m
      }
    }

    // Restituiamo il valore conservativo b (che garantisce S(b) >= target)
    let optVal = Math.ceil(b / tolerance) * tolerance
    let achievedRate = rateB
    if (optVal !== b) {
      iterations++
      achievedRate = evaluateSuccessRate(clonePlanWithParam(plan, param, optVal))
      if (achievedRate < targetSuccessRate) {
        optVal = b
        achievedRate = rateB
      }
    }

    return {
      status: 'converged',
      param,
      optimalValue: Math.round(optVal * 100) / 100,
      achievedSuccessRate: achievedRate,
      iterations
    }
  }
}

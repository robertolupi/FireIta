import type {
  AssetBuckets,
  AssetClassId,
  AssetWeights,
  GlidepathConfig,
  RebalanceStrategy
} from './types'
import { sellWithTax } from './tax'

export const ASSET_CLASS_IDS: AssetClassId[] = ['equity', 'bonds', 'cash']

export function emptyBuckets(): AssetBuckets {
  return {
    equity: { value: 0, costBasis: 0 },
    bonds: { value: 0, costBasis: 0 },
    cash: { value: 0, costBasis: 0 }
  }
}

export function cloneBuckets(buckets: AssetBuckets): AssetBuckets {
  return {
    equity: { ...buckets.equity },
    bonds: { ...buckets.bonds },
    cash: { ...buckets.cash }
  }
}

export function totalValue(buckets: AssetBuckets): number {
  return buckets.equity.value + buckets.bonds.value + buckets.cash.value
}

export function totalCostBasis(buckets: AssetBuckets): number {
  return buckets.equity.costBasis + buckets.bonds.costBasis + buckets.cash.costBasis
}

export function normalizeWeights(weights: AssetWeights): AssetWeights {
  const equity = Math.max(0, weights.equity)
  const bonds = Math.max(0, weights.bonds)
  const cash = Math.max(0, weights.cash)
  const sum = equity + bonds + cash
  if (sum <= 0) return { equity: 1, bonds: 0, cash: 0 }
  return { equity: equity / sum, bonds: bonds / sum, cash: cash / sum }
}

function lerpWeights(a: AssetWeights, b: AssetWeights, t: number): AssetWeights {
  return {
    equity: a.equity + t * (b.equity - a.equity),
    bonds: a.bonds + t * (b.bonds - a.bonds),
    cash: a.cash + t * (b.cash - a.cash)
  }
}

/**
 * Pesi target del glidepath per l'anno `year` (indice 0-based del piano), dato
 * `stopYear` = indice dell'anno di pensionamento. Interpolazione lineare a tratti:
 * accumulo → salita tenda → picco in stopYear → discesa (rising equity) → regime post.
 */
export function computeTargetWeights(
  glidepath: GlidepathConfig,
  year: number,
  stopYear: number
): AssetWeights {
  if (glidepath.type === 'static') return normalizeWeights(glidepath.weights)

  const acc = normalizeWeights(glidepath.accumulationWeights)
  const peak = normalizeWeights(glidepath.peakWeights)
  const post = normalizeWeights(glidepath.postTentWeights)
  const start = stopYear - Math.max(0, glidepath.yearsBeforeRetirement)
  const end = stopYear + Math.max(0, glidepath.yearsAfterRetirement)

  if (year < start) return acc
  if (year < stopYear) {
    return normalizeWeights(lerpWeights(acc, peak, (year - start) / (stopYear - start)))
  }
  if (year === stopYear) return peak
  if (year < end) {
    return normalizeWeights(lerpWeights(peak, post, (year - stopYear) / (end - stopYear)))
  }
  return post
}

/** Ripartisce value/costBasis iniziali sui bucket secondo i pesi target. */
export function allocateProportionally(
  weights: AssetWeights,
  value: number,
  costBasis: number
): AssetBuckets {
  const w = normalizeWeights(weights)
  return {
    equity: { value: value * w.equity, costBasis: costBasis * w.equity },
    bonds: { value: value * w.bonds, costBasis: costBasis * w.bonds },
    cash: { value: value * w.cash, costBasis: costBasis * w.cash }
  }
}

export function blendedReturn(
  buckets: AssetBuckets,
  returns: Record<AssetClassId, number>
): number {
  const total = totalValue(buckets)
  if (total <= 0) return 0
  return (
    (buckets.equity.value * returns.equity +
      buckets.bonds.value * returns.bonds +
      buckets.cash.value * returns.cash) /
    total
  )
}

/**
 * Versamento orientato ai bucket sottopesati (soft rebalancing): il contributo
 * viene ripartito proporzionalmente ai deficit rispetto ai pesi target, senza
 * alcuna vendita (zero imposte).
 */
export function contributeToBuckets(
  buckets: AssetBuckets,
  amount: number,
  target: AssetWeights
): void {
  if (amount <= 0) return
  const w = normalizeWeights(target)
  const totalAfter = totalValue(buckets) + amount

  const deficits: Record<AssetClassId, number> = {
    equity: Math.max(0, w.equity * totalAfter - buckets.equity.value),
    bonds: Math.max(0, w.bonds * totalAfter - buckets.bonds.value),
    cash: Math.max(0, w.cash * totalAfter - buckets.cash.value)
  }
  const totalDeficit = deficits.equity + deficits.bonds + deficits.cash

  for (const id of ASSET_CLASS_IDS) {
    const share = totalDeficit > 0 ? amount * (deficits[id] / totalDeficit) : amount * w[id]
    buckets[id].value += share
    buckets[id].costBasis += share
  }
}

export interface BucketSellResult {
  netProceeds: number
  grossSale: number
  taxPaid: number
  depleted: boolean
}

function marginalTaxDrag(bucket: { value: number; costBasis: number }, taxRate: number): number {
  if (bucket.value <= 0) return 0
  return taxRate * Math.max(0, (bucket.value - bucket.costBasis) / bucket.value)
}

/**
 * Prelievo fiscalmente efficiente: vende prioritariamente dagli asset sovrappesati
 * rispetto al target post-prelievo; l'eventuale residuo viene prelevato dagli altri
 * bucket in ordine di carico fiscale marginale crescente.
 */
export function withdrawFromBuckets(
  buckets: AssetBuckets,
  netNeeded: number,
  target: AssetWeights,
  taxRates: Record<AssetClassId, number>
): BucketSellResult {
  const result: BucketSellResult = { netProceeds: 0, grossSale: 0, taxPaid: 0, depleted: false }
  if (netNeeded <= 0) return result

  const w = normalizeWeights(target)
  let remaining = netNeeded

  // Fast path mono-asset: un solo bucket con valore → vendita diretta, aritmetica
  // identica al percorso legacy (equivalenza bit-a-bit con sellWithTax scalare)
  const nonEmpty = ASSET_CLASS_IDS.filter((id) => buckets[id].value > 1e-9)
  if (nonEmpty.length === 1) {
    const id = nonEmpty[0]
    const bucket = buckets[id]
    const r = sellWithTax(bucket.value, bucket.costBasis, netNeeded, taxRates[id])
    bucket.value = r.remainingPortfolio
    bucket.costBasis = r.remainingCostBasis
    return {
      netProceeds: r.netProceeds,
      grossSale: r.grossSale,
      taxPaid: r.tax,
      depleted: r.depleted
    }
  }

  const sellFrom = (id: AssetClassId, netTarget: number, capGross?: number): void => {
    if (netTarget <= 1e-9) return
    const bucket = buckets[id]
    if (bucket.value <= 0) return
    const before = bucket.value
    const r = sellWithTax(bucket.value, bucket.costBasis, netTarget, taxRates[id])
    if (capGross !== undefined && r.grossSale > capGross) {
      // limita la vendita alla quota eccedente richiesta
      const gainFraction = Math.max(0, Math.min(1, (before - bucket.costBasis) / before))
      const grossCap = Math.max(0, Math.min(capGross, before))
      const tax = taxRates[id] * gainFraction * grossCap
      bucket.value = before - grossCap
      bucket.costBasis = before > 0 ? bucket.costBasis * (bucket.value / before) : 0
      result.grossSale += grossCap
      result.taxPaid += tax
      result.netProceeds += grossCap - tax
      remaining -= grossCap - tax
      return
    }
    bucket.value = r.remainingPortfolio
    bucket.costBasis = r.remainingCostBasis
    result.grossSale += r.grossSale
    result.taxPaid += r.tax
    result.netProceeds += r.netProceeds
    remaining -= r.netProceeds
  }

  // Fase 1: asset sovrappesati rispetto al target post-prelievo
  const totalAfter = totalValue(buckets) - netNeeded
  for (const id of ASSET_CLASS_IDS) {
    if (remaining <= 1e-9) break
    const surplus = Math.max(0, buckets[id].value - w[id] * Math.max(0, totalAfter))
    if (surplus > 1e-9) {
      sellFrom(id, remaining, surplus)
    }
  }

  // Fase 2: residuo dagli altri bucket, per TaxDrag crescente
  if (remaining > 1e-9) {
    const order = [...ASSET_CLASS_IDS].sort(
      (a, b) => marginalTaxDrag(buckets[a], taxRates[a]) - marginalTaxDrag(buckets[b], taxRates[b])
    )
    for (const id of order) {
      if (remaining <= 1e-9) break
      sellFrom(id, remaining)
    }
  }

  if (remaining > 1e-9 && totalValue(buckets) <= 1e-9) {
    result.depleted = true
  }
  return result
}

/**
 * Hard rebalancing a fine anno: se la strategia è 'annual' (sempre) o 'threshold'
 * (solo quando un peso devia oltre la banda), vende l'eccedenza dai bucket sopra
 * target pagando il capital gain e reinveste il netto nei bucket sottopesati.
 */
export function rebalanceBuckets(
  buckets: AssetBuckets,
  target: AssetWeights,
  strategy: RebalanceStrategy,
  taxRates: Record<AssetClassId, number>
): { taxPaid: number; grossSale: number } {
  const outcome = { taxPaid: 0, grossSale: 0 }
  if (strategy.mode === 'cashflowOnly') return outcome

  const w = normalizeWeights(target)
  const total = totalValue(buckets)
  if (total <= 0) return outcome

  if (strategy.mode === 'threshold') {
    const maxDeviation = Math.max(
      Math.abs(buckets.equity.value / total - w.equity),
      Math.abs(buckets.bonds.value / total - w.bonds),
      Math.abs(buckets.cash.value / total - w.cash)
    )
    if (maxDeviation <= strategy.band) return outcome
  }

  // Vendite dai bucket sopra target, ricavato netto reinvestito nei sottopesati
  let cashToRedeploy = 0
  for (const id of ASSET_CLASS_IDS) {
    const excess = buckets[id].value - w[id] * total
    if (excess > 1e-9) {
      const bucket = buckets[id]
      const gainFraction =
        bucket.value > 0 ? Math.max(0, Math.min(1, (bucket.value - bucket.costBasis) / bucket.value)) : 0
      const tax = taxRates[id] * gainFraction * excess
      bucket.value -= excess
      bucket.costBasis = total > 0 ? bucket.costBasis * (bucket.value / (bucket.value + excess)) : 0
      cashToRedeploy += excess - tax
      outcome.grossSale += excess
      outcome.taxPaid += tax
    }
  }

  // Reinvestimento proporzionale ai deficit
  const deficits: Record<AssetClassId, number> = {
    equity: Math.max(0, w.equity * total - buckets.equity.value),
    bonds: Math.max(0, w.bonds * total - buckets.bonds.value),
    cash: Math.max(0, w.cash * total - buckets.cash.value)
  }
  const totalDeficit = deficits.equity + deficits.bonds + deficits.cash
  if (cashToRedeploy > 0 && totalDeficit > 0) {
    for (const id of ASSET_CLASS_IDS) {
      const share = cashToRedeploy * (deficits[id] / totalDeficit)
      buckets[id].value += share
      buckets[id].costBasis += share
    }
  }

  return outcome
}

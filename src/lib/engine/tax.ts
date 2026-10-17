export interface SellResult {
  grossSale: number
  tax: number
  netProceeds: number
  remainingPortfolio: number
  remainingCostBasis: number
  depleted: boolean
}

export function sellWithTax(
  portfolio: number,
  costBasis: number,
  netNeeded: number,
  taxRate: number
): SellResult {
  if (portfolio <= 0) {
    return {
      grossSale: 0,
      tax: 0,
      netProceeds: 0,
      remainingPortfolio: 0,
      remainingCostBasis: 0,
      depleted: netNeeded > 0
    }
  }

  const gainFraction = Math.max(0, Math.min(1, (portfolio - costBasis) / portfolio))
  const denominator = 1 - taxRate * gainFraction
  let grossSale = denominator > 0 ? netNeeded / denominator : portfolio

  if (grossSale >= portfolio) {
    grossSale = portfolio
    const tax = taxRate * Math.max(0, portfolio - costBasis)
    const netProceeds = portfolio - tax
    return {
      grossSale,
      tax,
      netProceeds,
      remainingPortfolio: 0,
      remainingCostBasis: 0,
      depleted: netProceeds < netNeeded - 1e-9
    }
  }

  const tax = taxRate * gainFraction * grossSale
  const remainingPortfolio = portfolio - grossSale
  const remainingCostBasis = costBasis * (remainingPortfolio / portfolio)
  return {
    grossSale,
    tax,
    netProceeds: grossSale - tax,
    remainingPortfolio,
    remainingCostBasis,
    depleted: false
  }
}

export const WHITELIST_TAX_RATE = 0.125

/**
 * Calcola l'aliquota effettiva sul capital gain combinando l'aliquota ordinaria (es. 26%)
 * e l'aliquota agevolata White List (12,5%) in base a whitelistAllocation.
 */
export function effectiveCapitalGainsTaxRate(
  taxRate: number,
  whitelistAllocation = 0
): number {
  const wl = Math.max(0, Math.min(1, whitelistAllocation))
  return (1 - wl) * taxRate + wl * WHITELIST_TAX_RATE
}

/**
 * Applica l'imposta di bollo patrimoniale a fine anno (es. 0,20%) sul portafoglio,
 * riducendo proporzionalmente il costBasis per mantenere invariata la frazione di plusvalenza.
 */
export function applyStampDuty(
  portfolio: number,
  costBasis: number,
  stampDutyRate = 0
): { remainingPortfolio: number; remainingCostBasis: number; stampDuty: number } {
  if (portfolio <= 0 || stampDutyRate <= 0) {
    return { remainingPortfolio: portfolio, remainingCostBasis: costBasis, stampDuty: 0 }
  }
  const rate = Math.max(0, Math.min(1, stampDutyRate))
  const stampDuty = portfolio * rate
  const remainingPortfolio = portfolio - stampDuty
  const remainingCostBasis = costBasis * (1 - rate)
  return { remainingPortfolio, remainingCostBasis, stampDuty }
}

/**
 * Calcola l'aliquota sostitutiva finale del Fondo Pensione / RITA (dal 15% al 9%
 * con riduzione di 0,30% per ogni anno di partecipazione oltre il 15°).
 */
export function pensionFundTaxRate(seniorityYears: number): number {
  const extraYears = Math.max(0, Math.floor(seniorityYears) - 15)
  return Math.max(0.09, 0.15 - 0.003 * extraYears)
}


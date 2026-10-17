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

import type { LifeEvent, Plan, YearState } from './types'
import { sellWithTax } from './tax'

export function currentAge(plan: Plan): number {
  return plan.startYear - plan.birthYear
}

export function horizonYears(plan: Plan): number {
  return Math.max(1, plan.birthYear + plan.lifeExpectancyAge - plan.startYear)
}

export function effectiveStopYear(plan: Plan): number {
  let stop = Math.max(0, plan.birthYear + plan.retirementAge - plan.startYear)
  for (const event of plan.events) {
    if (event.kind === 'stopWorking') {
      stop = Math.min(stop, Math.max(0, event.atYear - plan.startYear))
    }
  }
  return stop
}

export function computeVpwRate(
  remainingYears: number,
  realReturnRate: number,
  legacyFraction = 0,
  minRate = 0,
  maxRate = 1
): number {
  const n = Math.max(1, Math.floor(remainingYears))
  const f = Math.max(0, Math.min(1, legacyFraction))
  let rate: number
  if (n === 1) {
    rate = 1 - f
  } else if (Math.abs(realReturnRate) < 1e-7) {
    rate = (1 - f) / n
  } else {
    const r = realReturnRate
    const discountN = Math.pow(1 + r, -n)
    rate = (r * (1 - f * discountN)) / ((1 + r) * (1 - discountN))
  }
  return Math.max(minRate, Math.min(maxRate, rate))
}

export function runProjection(plan: Plan, returns: number[]): YearState[] {
  const horizon = horizonYears(plan)
  const stop = effectiveStopYear(plan)
  const expenseChanges = plan.events
    .filter((e): e is Extract<LifeEvent, { kind: 'setExpenses' }> => e.kind === 'setExpenses')
    .sort((a, b) => a.fromYear - b.fromYear)

  let portfolio = plan.initialPortfolio
  let costBasis = Math.min(plan.initialCostBasis, plan.initialPortfolio)
  let expensesBase = plan.annualExpenses
  let expensesBaseYear = 0
  let retirementBase = 0
  let currentWithdrawal = 0
  let depleted = portfolio <= 0
  const states: YearState[] = []

  for (let year = 0; year < horizon; year++) {
    const startPortfolio = portfolio
    const age = currentAge(plan) + year
    const calendarYear = plan.startYear + year

    if (depleted) {
      states.push({
        year,
        age,
        calendarYear,
        phase: year >= stop ? 'retirement' : 'accumulation',
        income: 0,
        expenses: 0,
        contribution: 0,
        withdrawal: 0,
        grossSale: 0,
        taxPaid: 0,
        returnRate: returns[year] ?? 0,
        investmentReturn: 0,
        startPortfolio: 0,
        endPortfolio: 0,
        endCostBasis: 0,
        expensesNotCovered: true,
        depleted: true
      })
      continue
    }

    for (const change of expenseChanges) {
      if (change.fromYear - plan.startYear <= year) {
        expensesBase = change.amount
        expensesBaseYear = change.fromYear - plan.startYear
      }
    }

    const retired = year >= stop
    const income = retired ? 0 : plan.annualIncome * Math.pow(1 + plan.incomeGrowthRate, year)
    const expenses = expensesBase * Math.pow(1 + plan.inflationRate, year - expensesBaseYear)

    let contribution = 0
    let withdrawal = 0
    let grossSale = 0
    let taxPaid = 0
    let expensesNotCovered = false

    const sell = (netNeeded: number): number => {
      if (netNeeded <= 0) return 0
      if (portfolio <= 0) {
        depleted = true
        return 0
      }
      const result = sellWithTax(portfolio, costBasis, netNeeded, plan.taxRate)
      grossSale += result.grossSale
      taxPaid += result.tax
      withdrawal += result.netProceeds
      portfolio = result.remainingPortfolio
      costBasis = result.remainingCostBasis
      if (result.depleted) depleted = true
      return result.netProceeds
    }

    if (!retired) {
      const net = income - expenses
      contribution = net
      if (net > 0) {
        portfolio += net
        costBasis += net
      } else if (net < 0) {
        if (sell(-net) < -net - 1e-9) expensesNotCovered = true
      }
      for (const event of plan.events) {
        if (event.kind === 'oneTimeExpense' && event.atYear - plan.startYear === year) {
          if (sell(event.amount) < event.amount - 1e-9) expensesNotCovered = true
        }
      }
    }

    const returnRate = returns[year] ?? 0
    const investmentReturn = portfolio * returnRate
    portfolio = Math.max(0, portfolio + investmentReturn)

    if (retired) {
      let oneTimeExpenses = 0
      for (const event of plan.events) {
        if (event.kind === 'oneTimeExpense' && event.atYear - plan.startYear === year) {
          oneTimeExpenses += event.amount
        }
      }

      const strategy = plan.withdrawalStrategy

      if (strategy.type === 'percentCap') {
        if (year === stop) retirementBase = startPortfolio * strategy.rate
        const cap = retirementBase * Math.pow(1 + plan.inflationRate, year - stop)
        const needed = expenses + oneTimeExpenses
        const obtained = sell(Math.min(needed, cap))
        if (obtained < needed - 1e-9) expensesNotCovered = true
      } else if (strategy.type === 'spendExpenses') {
        const needed = expenses + oneTimeExpenses
        const obtained = sell(needed)
        if (obtained < needed - 1e-9) expensesNotCovered = true
      } else if (strategy.type === 'constantDollar') {
        if (year === stop) retirementBase = startPortfolio * strategy.rate
        const targetWithdrawal = retirementBase * Math.pow(1 + plan.inflationRate, year - stop)
        const obtained = sell(targetWithdrawal)
        const oneTimeObtained = oneTimeExpenses > 0 ? sell(oneTimeExpenses) : 0
        if (obtained < expenses - 1e-9 || oneTimeObtained < oneTimeExpenses - 1e-9) {
          expensesNotCovered = true
        }
      } else if (strategy.type === 'vpw') {
        const remainingYears = Math.max(1, horizon - year)
        const defaultRealReturn = (1 + plan.meanReturn) / (1 + plan.inflationRate) - 1
        const rReal = strategy.realReturnRate ?? defaultRealReturn
        const vpwRate = computeVpwRate(
          remainingYears,
          rReal,
          strategy.legacyFraction ?? 0,
          strategy.minRate ?? 0,
          strategy.maxRate ?? 1
        )
        const targetWithdrawal = portfolio * vpwRate
        const obtained = sell(targetWithdrawal)
        const oneTimeObtained = oneTimeExpenses > 0 ? sell(oneTimeExpenses) : 0
        if (obtained < expenses - 1e-9 || oneTimeObtained < oneTimeExpenses - 1e-9) {
          expensesNotCovered = true
        }
      } else if (strategy.type === 'guardrails') {
        if (year === stop) {
          currentWithdrawal = strategy.initialRate * startPortfolio
        } else if (portfolio > 0) {
          const prevReturn = returns[year - 1] ?? 0
          const skipInflation =
            Boolean(strategy.skipInflationAfterNegativeReturn) &&
            prevReturn < 0 &&
            plan.inflationRate > 0
          if (!skipInflation) {
            currentWithdrawal *= 1 + plan.inflationRate
          }
          const effectiveRate = currentWithdrawal / portfolio
          if (effectiveRate < strategy.lowerGuardrail) {
            currentWithdrawal *= 1 + strategy.increasePct
          } else if (effectiveRate > strategy.upperGuardrail) {
            currentWithdrawal *= 1 - strategy.decreasePct
          }
        }
        const obtained = sell(currentWithdrawal)
        // le spese una tantum sono vendite extra sopra il prelievo guardrails:
        // non modificano currentWithdrawal né i futuri aggiustamenti
        const oneTimeObtained = oneTimeExpenses > 0 ? sell(oneTimeExpenses) : 0
        if (obtained < expenses - 1e-9 || oneTimeObtained < oneTimeExpenses - 1e-9) {
          expensesNotCovered = true
        }
      }
    }

    if (portfolio <= 1e-9) {
      portfolio = 0
      costBasis = 0
      depleted = true
    }

    states.push({
      year,
      age,
      calendarYear,
      phase: retired ? 'retirement' : 'accumulation',
      income,
      expenses,
      contribution,
      withdrawal,
      grossSale,
      taxPaid,
      returnRate,
      investmentReturn,
      startPortfolio,
      endPortfolio: portfolio,
      endCostBasis: costBasis,
      expensesNotCovered,
      depleted
    })
  }

  return states
}

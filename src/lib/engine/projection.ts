import type { LifeEvent, Plan, YearState } from './types'
import {
  applyStampDuty,
  effectiveCapitalGainsTaxRate,
  pensionFundTaxRate,
  sellWithTax,
  WHITELIST_TAX_RATE
} from './tax'

const PENSION_FUND_DEDUCTION_CAP = 5164.57

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

function computeRecurringIncome(plan: Plan, year: number, calendarYear: number): number {
  let sum = 0
  for (const event of plan.events) {
    if (
      event.kind === 'recurringIncome' &&
      calendarYear >= event.fromYear &&
      (event.toYear === undefined || calendarYear <= event.toYear)
    ) {
      const factor = event.inflationAdjusted !== false ? Math.pow(1 + plan.inflationRate, year) : 1
      sum += event.amount * factor
    }
  }
  return sum
}

export function runProjection(plan: Plan, returns: number[]): YearState[] {
  const horizon = horizonYears(plan)
  const stop = effectiveStopYear(plan)
  const effectiveTaxRate = effectiveCapitalGainsTaxRate(plan.taxRate, plan.whitelistAllocation ?? 0)
  const expenseChanges = plan.events
    .filter((e): e is Extract<LifeEvent, { kind: 'setExpenses' }> => e.kind === 'setExpenses')
    .sort((a, b) => a.fromYear - b.fromYear)

  let portfolio = plan.initialPortfolio
  let costBasis = Math.min(plan.initialCostBasis, plan.initialPortfolio)
  let expensesBase = plan.annualExpenses
  let retirementBase = 0
  let currentWithdrawal = 0
  let depleted = portfolio <= 0

  const pf = plan.pensionFund
  let pfBalance = pf ? Math.max(0, pf.initialBalance) : 0
  let pfTaxableBase = pf
    ? Math.max(0, Math.min(pfBalance, pf.initialTaxableBase ?? pfBalance))
    : 0

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
        stampDutyPaid: 0,
        ...(pf ? { pensionFundBalance: pfBalance } : {}),
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
      }
    }

    const retired = year >= stop
    const returnRate = returns[year] ?? 0
    const expenses = expensesBase * Math.pow(1 + plan.inflationRate, year)

    let contribution = 0
    let withdrawal = 0
    let grossSale = 0
    let taxPaid = 0
    let expensesNotCovered = false

    // Gestione Fondo Pensione Complementare / RITA
    let pfNetOutflow = 0
    let ritaNetIncome = 0
    if (pf) {
      if (!retired && pf.annualContribution > 0) {
        const contrib = pf.annualContribution
        const deductible = Math.min(contrib, PENSION_FUND_DEDUCTION_CAP)
        const irpefRefund = deductible * Math.max(0, Math.min(1, pf.irpefMarginalRate))
        pfNetOutflow = contrib - irpefRefund
        pfBalance += contrib
        pfTaxableBase += deductible
      }

      const pfReturnRate = returnRate + (pf.returnRateOffset ?? 0)
      const pfGrossReturn = pfBalance * pfReturnRate
      if (pfGrossReturn > 0) {
        const wl = Math.max(0, Math.min(1, plan.whitelistAllocation ?? 0))
        const pfReturnTaxRate = (1 - wl) * 0.2 + wl * WHITELIST_TAX_RATE
        pfBalance += pfGrossReturn * (1 - pfReturnTaxRate)
      } else {
        pfBalance = Math.max(0, pfBalance + pfGrossReturn)
        pfTaxableBase = Math.min(pfTaxableBase, pfBalance)
      }

      if (age >= pf.ritaStartAge && age <= pf.ritaEndAge && pfBalance > 0) {
        const remainingRitaYears = Math.max(1, pf.ritaEndAge - age + 1)
        const grossInstallment = pfBalance / remainingRitaYears
        const taxableFraction =
          pfBalance > 0 ? Math.max(0, Math.min(1, pfTaxableBase / pfBalance)) : 0
        const finalTaxRate = pensionFundTaxRate(pf.initialSeniorityYears + year)
        const ritaTax = grossInstallment * taxableFraction * finalTaxRate
        ritaNetIncome = grossInstallment - ritaTax
        taxPaid += ritaTax
        pfBalance = Math.max(0, pfBalance - grossInstallment)
        pfTaxableBase = Math.max(0, pfTaxableBase * (1 - 1 / remainingRitaYears))
      }
    }

    const recurringInc = computeRecurringIncome(plan, year, calendarYear)
    const workIncome = retired ? 0 : plan.annualIncome * Math.pow(1 + plan.incomeGrowthRate, year)
    const income = workIncome + recurringInc + ritaNetIncome

    const sell = (netNeeded: number): number => {
      if (netNeeded <= 0) return 0
      if (portfolio <= 0) {
        depleted = true
        return 0
      }
      const result = sellWithTax(portfolio, costBasis, netNeeded, effectiveTaxRate)
      grossSale += result.grossSale
      taxPaid += result.tax
      withdrawal += result.netProceeds
      portfolio = result.remainingPortfolio
      costBasis = result.remainingCostBasis
      if (result.depleted) depleted = true
      return result.netProceeds
    }

    if (!retired) {
      const net = income - expenses - pfNetOutflow
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

    const investmentReturn = portfolio * returnRate
    portfolio = Math.max(0, portfolio + investmentReturn)

    if (retired) {
      let oneTimeExpenses = 0
      for (const event of plan.events) {
        if (event.kind === 'oneTimeExpense' && event.atYear - plan.startYear === year) {
          oneTimeExpenses += event.amount
        }
      }

      const totalNeeded = expenses + oneTimeExpenses
      const strategy = plan.withdrawalStrategy

      if (strategy.type === 'percentCap') {
        if (year === stop) retirementBase = startPortfolio * strategy.rate
        const cap = retirementBase * Math.pow(1 + plan.inflationRate, year - stop)
        if (income > totalNeeded) {
          const surplus = income - totalNeeded
          contribution = surplus
          portfolio += surplus
          costBasis += surplus
        } else {
          const netNeeded = totalNeeded - income
          const obtained = sell(Math.min(netNeeded, cap))
          if (income + obtained < totalNeeded - 1e-9) expensesNotCovered = true
        }
      } else if (strategy.type === 'spendExpenses') {
        if (income > totalNeeded) {
          const surplus = income - totalNeeded
          contribution = surplus
          portfolio += surplus
          costBasis += surplus
        } else {
          const netNeeded = totalNeeded - income
          const obtained = sell(netNeeded)
          if (income + obtained < totalNeeded - 1e-9) expensesNotCovered = true
        }
      } else if (strategy.type === 'constantDollar') {
        if (year === stop) retirementBase = startPortfolio * strategy.rate
        const targetWithdrawal = Math.max(
          retirementBase * Math.pow(1 + plan.inflationRate, year - stop),
          expenses
        )
        if (income > targetWithdrawal + oneTimeExpenses) {
          const surplus = income - totalNeeded
          contribution = surplus
          portfolio += surplus
          costBasis += surplus
        } else {
          const incomeForBase = Math.min(income, targetWithdrawal)
          const remIncome = Math.max(0, income - incomeForBase)
          const netTarget = Math.max(0, targetWithdrawal - income)
          const netOneTime = Math.max(0, oneTimeExpenses - remIncome)
          const obtained = sell(netTarget)
          const oneTimeObtained = netOneTime > 0 ? sell(netOneTime) : 0
          if (
            incomeForBase + obtained < expenses - 1e-9 ||
            remIncome + oneTimeObtained < oneTimeExpenses - 1e-9
          ) {
            expensesNotCovered = true
            depleted = true
          }
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
        const targetWithdrawal = Math.max(portfolio * vpwRate, expenses)
        if (income > targetWithdrawal + oneTimeExpenses) {
          const surplus = income - totalNeeded
          contribution = surplus
          portfolio += surplus
          costBasis += surplus
        } else {
          const incomeForBase = Math.min(income, targetWithdrawal)
          const remIncome = Math.max(0, income - incomeForBase)
          const netTarget = Math.max(0, targetWithdrawal - income)
          const netOneTime = Math.max(0, oneTimeExpenses - remIncome)
          const obtained = sell(targetWithdrawal > 0 ? netTarget : 0)
          const oneTimeObtained = netOneTime > 0 ? sell(netOneTime) : 0
          if (
            incomeForBase + obtained < expenses - 1e-9 ||
            remIncome + oneTimeObtained < oneTimeExpenses - 1e-9
          ) {
            expensesNotCovered = true
            depleted = true
          }
        }
      } else if (strategy.type === 'guardrails') {
        if (year === stop) {
          currentWithdrawal = Math.max(strategy.initialRate * startPortfolio, expenses)
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
          currentWithdrawal = Math.max(currentWithdrawal, expenses)
        }
        if (income > currentWithdrawal + oneTimeExpenses) {
          const surplus = income - totalNeeded
          contribution = surplus
          portfolio += surplus
          costBasis += surplus
        } else {
          const incomeForBase = Math.min(income, currentWithdrawal)
          const remIncome = Math.max(0, income - incomeForBase)
          const netTarget = Math.max(0, currentWithdrawal - income)
          const netOneTime = Math.max(0, oneTimeExpenses - remIncome)
          const obtained = sell(netTarget)
          // le spese una tantum sono vendite extra sopra il prelievo guardrails:
          // non modificano currentWithdrawal né i futuri aggiustamenti
          const oneTimeObtained = netOneTime > 0 ? sell(netOneTime) : 0
          if (
            incomeForBase + obtained < expenses - 1e-9 ||
            remIncome + oneTimeObtained < oneTimeExpenses - 1e-9
          ) {
            expensesNotCovered = true
            depleted = true
          }
        }
      }
    }

    const {
      remainingPortfolio: postStampPortfolio,
      remainingCostBasis: postStampCostBasis,
      stampDuty
    } = applyStampDuty(portfolio, costBasis, plan.stampDutyRate ?? 0)
    portfolio = postStampPortfolio
    costBasis = postStampCostBasis
    taxPaid += stampDuty
    const stampDutyPaid = stampDuty

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
      stampDutyPaid,
      ...(pf ? { pensionFundBalance: pfBalance } : {}),
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

import type { CashflowTiming, LifeEvent, Plan, YearState } from './types'
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
  const timing: CashflowTiming = plan.cashflowTiming ?? 'legacy'
  const cb = plan.cashBuffer?.enabled ? plan.cashBuffer : undefined
  const effectiveTaxRate = effectiveCapitalGainsTaxRate(plan.taxRate, plan.whitelistAllocation ?? 0)
  const expenseChanges = plan.events
    .filter((e): e is Extract<LifeEvent, { kind: 'setExpenses' }> => e.kind === 'setExpenses')
    .sort((a, b) => a.fromYear - b.fromYear)

  let portfolio = plan.initialPortfolio
  let costBasis = Math.min(plan.initialCostBasis, plan.initialPortfolio)
  let cashBuffer = 0
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
        ...(cb
          ? {
              cashBufferStart: 0,
              cashBufferEnd: 0,
              bufferWithdrawal: 0,
              bufferRefill: 0,
              cashBufferBalance: 0,
              cashBufferMovement: 0
            }
          : {}),
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

    // Inizializzazione del Cash Buffer al primo anno di pensionamento (scorporo proporzionale)
    if (cb && year === stop && cashBuffer === 0 && portfolio > 0) {
      const targetInitBuffer = Math.max(0, cb.yearsOfExpenses) * expenses
      const initAllocation = Math.min(portfolio, targetInitBuffer)
      if (initAllocation > 0) {
        const remainingRatio = (portfolio - initAllocation) / portfolio
        portfolio -= initAllocation
        costBasis *= remainingRatio
        cashBuffer = initAllocation
      }
    }

    const cashBufferStart = cashBuffer
    const startPortfolio = portfolio + cashBuffer

    let contribution = 0
    let withdrawal = 0
    let grossSale = 0
    let taxPaid = 0
    let bufferWithdrawal = 0
    let bufferRefill = 0
    let expensesNotCovered = false

    const isMarketStressed = Boolean(cb && returnRate < (cb.drawdownThreshold ?? 0))

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
        if (cashBuffer <= 0) depleted = true
        return 0
      }
      const result = sellWithTax(portfolio, costBasis, netNeeded, effectiveTaxRate)
      grossSale += result.grossSale
      taxPaid += result.tax
      withdrawal += result.netProceeds
      portfolio = result.remainingPortfolio
      costBasis = result.remainingCostBasis
      if (result.depleted && cashBuffer <= 0) depleted = true
      return result.netProceeds
    }

    const spendNeed = (netNeeded: number): number => {
      if (netNeeded <= 0) return 0
      let rem = netNeeded
      let obtained = 0

      if (cb && retired && isMarketStressed && cashBuffer > 0) {
        const fromBuf = Math.min(cashBuffer, rem)
        cashBuffer -= fromBuf
        bufferWithdrawal += fromBuf
        withdrawal += fromBuf
        obtained += fromBuf
        rem -= fromBuf
      }

      if (rem > 0 && portfolio > 0) {
        const fromPort = sell(rem)
        obtained += fromPort
        rem = Math.max(0, rem - fromPort)
      }

      if (cb && retired && rem > 1e-9 && cashBuffer > 0) {
        const fromBuf = Math.min(cashBuffer, rem)
        cashBuffer -= fromBuf
        bufferWithdrawal += fromBuf
        withdrawal += fromBuf
        obtained += fromBuf
        rem -= fromBuf
      }

      if (rem > 1e-9 && portfolio <= 1e-9 && cashBuffer <= 1e-9) {
        depleted = true
      }

      return obtained
    }

    const executeRetirementCashflow = () => {
      let oneTimeExpenses = 0
      for (const event of plan.events) {
        if (event.kind === 'oneTimeExpense' && event.atYear - plan.startYear === year) {
          oneTimeExpenses += event.amount
        }
      }

      const totalNeeded = expenses + oneTimeExpenses
      const strategy = plan.withdrawalStrategy
      const totalCurrentWealth = portfolio + cashBuffer

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
          const obtained = spendNeed(Math.min(netNeeded, cap))
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
          const obtained = spendNeed(netNeeded)
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
          const obtained = spendNeed(netTarget)
          const oneTimeObtained = netOneTime > 0 ? spendNeed(netOneTime) : 0
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
        const targetWithdrawal = Math.max(totalCurrentWealth * vpwRate, expenses)
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
          const obtained = spendNeed(targetWithdrawal > 0 ? netTarget : 0)
          const oneTimeObtained = netOneTime > 0 ? spendNeed(netOneTime) : 0
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
        } else if (totalCurrentWealth > 0) {
          const prevReturn = returns[year - 1] ?? 0
          const skipInflation =
            Boolean(strategy.skipInflationAfterNegativeReturn) &&
            prevReturn < 0 &&
            plan.inflationRate > 0
          if (!skipInflation) {
            currentWithdrawal *= 1 + plan.inflationRate
          }
          const effectiveRate = currentWithdrawal / totalCurrentWealth
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
          const obtained = spendNeed(netTarget)
          // le spese una tantum sono vendite extra sopra il prelievo guardrails:
          // non modificano currentWithdrawal né i futuri aggiustamenti
          const oneTimeObtained = netOneTime > 0 ? spendNeed(netOneTime) : 0
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

    let investmentReturn = 0

    if (!retired) {
      const investedBeforeCf = portfolio
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

      if (timing === 'midYear') {
        const effectiveBase = Math.max(
          0,
          investedBeforeCf + 0.5 * Math.max(0, contribution) - 0.5 * grossSale
        )
        investmentReturn = effectiveBase * returnRate
      } else {
        investmentReturn = portfolio * returnRate
      }
      portfolio = Math.max(0, portfolio + investmentReturn)
    } else if (timing === 'legacy') {
      investmentReturn = portfolio * returnRate
      portfolio = Math.max(0, portfolio + investmentReturn)
      executeRetirementCashflow()
    } else if (timing === 'startOfYear') {
      executeRetirementCashflow()
      investmentReturn = portfolio * returnRate
      portfolio = Math.max(0, portfolio + investmentReturn)
    } else {
      // timing === 'midYear'
      const investedBeforeCf = portfolio
      executeRetirementCashflow()
      const effectiveBase = Math.max(
        0,
        investedBeforeCf + 0.5 * Math.max(0, contribution) - 0.5 * grossSale
      )
      investmentReturn = effectiveBase * returnRate
      portfolio = Math.max(0, portfolio + investmentReturn)
    }

    // Rendimento e ricostituzione (Refill) del Cash Buffer in fase di pensionamento
    if (cb && retired) {
      if (cashBuffer > 0 && cb.cashReturnRate) {
        cashBuffer = Math.max(0, cashBuffer * (1 + cb.cashReturnRate))
      }
      const targetBuffer = Math.max(0, cb.yearsOfExpenses) * expenses
      if (!isMarketStressed && cashBuffer < targetBuffer && portfolio > 0) {
        const deficit = targetBuffer - cashBuffer
        const excessReturn = Math.max(0, investmentReturn - withdrawal)
        const refillTarget = Math.min(deficit, excessReturn)
        if (refillTarget > 0) {
          const refillSale = sellWithTax(portfolio, costBasis, refillTarget, effectiveTaxRate)
          grossSale += refillSale.grossSale
          taxPaid += refillSale.tax
          portfolio = refillSale.remainingPortfolio
          costBasis = refillSale.remainingCostBasis
          bufferRefill = refillSale.netProceeds
          cashBuffer += refillSale.netProceeds
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
    }
    if (cashBuffer <= 1e-9) {
      cashBuffer = 0
    }

    const endPortfolio = portfolio + cashBuffer
    if (endPortfolio <= 1e-9) {
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
      ...(cb
        ? {
            cashBufferStart,
            cashBufferEnd: cashBuffer,
            bufferWithdrawal,
            bufferRefill,
            cashBufferBalance: cashBuffer,
            cashBufferMovement: bufferRefill - bufferWithdrawal
          }
        : {}),
      returnRate,
      investmentReturn,
      startPortfolio,
      endPortfolio,
      endCostBasis: costBasis,
      expensesNotCovered,
      depleted
    })
  }

  return states
}

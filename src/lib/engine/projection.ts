import type {
  AssetBuckets,
  AssetClassId,
  AssetWeights,
  AssetYearReturns,
  CashflowTiming,
  LifeEvent,
  Plan,
  ProjectionReturns,
  YearState
} from './types'
import {
  applyStampDuty,
  effectiveCapitalGainsTaxRate,
  pensionFundTaxRate,
  sellWithTax,
  WHITELIST_TAX_RATE
} from './tax'
import {
  allocateProportionally,
  ASSET_CLASS_IDS,
  blendedReturn,
  cloneBuckets,
  computeTargetWeights,
  contributeToBuckets,
  emptyBuckets,
  rebalanceBuckets,
  totalCostBasis,
  totalValue,
  withdrawFromBuckets
} from './allocation'

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

function computeRecurringIncome(
  plan: Plan,
  year: number,
  calendarYear: number,
  cumulativeInflation: number
): number {
  let sum = 0
  for (const event of plan.events) {
    if (
      event.kind === 'recurringIncome' &&
      calendarYear >= event.fromYear &&
      (event.toYear === undefined || calendarYear <= event.toYear)
    ) {
      const factor = event.inflationAdjusted !== false ? cumulativeInflation : 1
      sum += event.amount * factor
    }
  }
  return sum
}

export function runProjection(
  plan: Plan,
  returns: ProjectionReturns,
  inflations?: number[]
): YearState[] {
  const horizon = horizonYears(plan)
  const stop = effectiveStopYear(plan)
  const timing: CashflowTiming = plan.cashflowTiming ?? 'legacy'
  const cb = plan.cashBuffer?.enabled ? plan.cashBuffer : undefined
  const effectiveTaxRate = effectiveCapitalGainsTaxRate(plan.taxRate, plan.whitelistAllocation ?? 0)
  const expenseChanges = plan.events
    .filter((e): e is Extract<LifeEvent, { kind: 'setExpenses' }> => e.kind === 'setExpenses')
    .sort((a, b) => a.fromYear - b.fromYear)

  // Indice cumulativo dei prezzi: priceIndex[0] = 1, priceIndex[t] = priceIndex[t-1] * (1 + pi_{t-1})
  // Con inflations omesso (o costante) coincide con Math.pow(1 + plan.inflationRate, t)
  const priceIndex: number[] = new Array(horizon + 1)
  priceIndex[0] = 1
  for (let y = 0; y < horizon; y++) {
    priceIndex[y + 1] = priceIndex[y] * (1 + (inflations?.[y] ?? plan.inflationRate))
  }
  const inflationFactor = (fromYearIdx: number, toYearIdx: number): number => {
    if (toYearIdx <= fromYearIdx) return 1
    return priceIndex[toYearIdx] / priceIndex[fromYearIdx]
  }
  const inflationForYear = (y: number): number => inflations?.[y] ?? plan.inflationRate

  let portfolio = plan.initialPortfolio
  let costBasis = Math.min(plan.initialCostBasis, plan.initialPortfolio)
  let cashBuffer = 0
  let expensesBase = plan.annualExpenses
  let retirementBase = 0
  let currentWithdrawal = 0
  let depleted = portfolio <= 0

  // Portafoglio multi-asset: i bucket sono la fonte di verità, portfolio/costBasis
  // restano mirror scalari riallineati dopo ogni operazione
  const ma = plan.multiAsset
  const assetTaxRates: Record<AssetClassId, number> | null = ma
    ? {
        equity: ma.assets.equity.taxRate,
        bonds: ma.assets.bonds.taxRate,
        cash: ma.assets.cash.taxRate
      }
    : null
  let buckets: AssetBuckets | null = null
  if (ma) {
    buckets = allocateProportionally(
      computeTargetWeights(ma.glidepath, 0, stop),
      plan.initialPortfolio,
      Math.min(plan.initialCostBasis, plan.initialPortfolio)
    )
    portfolio = totalValue(buckets)
    costBasis = totalCostBasis(buckets)
  }
  const syncFromBuckets = () => {
    if (buckets) {
      portfolio = totalValue(buckets)
      costBasis = totalCostBasis(buckets)
    }
  }
  let prevYearReturn = 0

  const pf = plan.pensionFund
  let pfBalance = pf ? Math.max(0, pf.initialBalance) : 0
  let pfTaxableBase = pf
    ? Math.max(0, Math.min(pfBalance, pf.initialTaxableBase ?? pfBalance))
    : 0

  const states: YearState[] = []

  for (let year = 0; year < horizon; year++) {
    const age = currentAge(plan) + year
    const calendarYear = plan.startYear + year
    const rawReturn = returns[year]
    const scalarReturn = typeof rawReturn === 'number' ? rawReturn : 0

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
        ...(ma
          ? {
              buckets: emptyBuckets(),
              targetWeights: computeTargetWeights(ma.glidepath, year, stop),
              rebalanceTaxPaid: 0
            }
          : {}),
        returnRate: scalarReturn,
        ...(inflations ? { inflationRate: inflationForYear(year) } : {}),
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
    const assetReturns: AssetYearReturns | null = ma
      ? rawReturn !== null && typeof rawReturn === 'object'
        ? rawReturn
        : { equity: scalarReturn, bonds: scalarReturn, cash: scalarReturn }
      : null
    const returnRate =
      buckets && assetReturns
        ? assetReturns.equity === assetReturns.bonds && assetReturns.bonds === assetReturns.cash
          ? assetReturns.equity
          : blendedReturn(buckets, assetReturns)
        : scalarReturn
    const expenses = expensesBase * priceIndex[year]
    const targetWeightsNow: AssetWeights | null = ma
      ? computeTargetWeights(ma.glidepath, year, stop)
      : null

    // Inizializzazione del Cash Buffer al primo anno di pensionamento (scorporo proporzionale)
    if (cb && year === stop && cashBuffer === 0 && portfolio > 0) {
      const targetInitBuffer = Math.max(0, cb.yearsOfExpenses) * expenses
      const initAllocation = Math.min(portfolio, targetInitBuffer)
      if (initAllocation > 0) {
        const remainingRatio = (portfolio - initAllocation) / portfolio
        if (buckets) {
          for (const id of ASSET_CLASS_IDS) {
            buckets[id].value *= remainingRatio
            buckets[id].costBasis *= remainingRatio
          }
          syncFromBuckets()
        } else {
          portfolio -= initAllocation
          costBasis *= remainingRatio
        }
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

    const stressSignal = assetReturns ? assetReturns.equity : returnRate
    const isMarketStressed = Boolean(cb && stressSignal < (cb.drawdownThreshold ?? 0))

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

    const recurringInc = computeRecurringIncome(plan, year, calendarYear, priceIndex[year])
    const workIncome = retired ? 0 : plan.annualIncome * Math.pow(1 + plan.incomeGrowthRate, year)
    const income = workIncome + recurringInc + ritaNetIncome

    const addContribution = (amount: number) => {
      if (amount <= 0) return
      if (buckets && targetWeightsNow) {
        contributeToBuckets(buckets, amount, targetWeightsNow)
        syncFromBuckets()
      } else {
        portfolio += amount
        costBasis += amount
      }
    }

    const sell = (netNeeded: number): number => {
      if (netNeeded <= 0) return 0
      if (portfolio <= 0) {
        if (cashBuffer <= 0) depleted = true
        return 0
      }
      if (buckets && assetTaxRates && targetWeightsNow) {
        const result = withdrawFromBuckets(buckets, netNeeded, targetWeightsNow, assetTaxRates)
        grossSale += result.grossSale
        taxPaid += result.taxPaid
        withdrawal += result.netProceeds
        syncFromBuckets()
        if (result.depleted && cashBuffer <= 0) depleted = true
        return result.netProceeds
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
        const cap = retirementBase * inflationFactor(stop, year)
        if (income > totalNeeded) {
          const surplus = income - totalNeeded
          contribution = surplus
          addContribution(surplus)
        } else {
          const netNeeded = totalNeeded - income
          const obtained = spendNeed(Math.min(netNeeded, cap))
          if (income + obtained < totalNeeded - 1e-9) expensesNotCovered = true
        }
      } else if (strategy.type === 'spendExpenses') {
        if (income > totalNeeded) {
          const surplus = income - totalNeeded
          contribution = surplus
          addContribution(surplus)
        } else {
          const netNeeded = totalNeeded - income
          const obtained = spendNeed(netNeeded)
          if (income + obtained < totalNeeded - 1e-9) expensesNotCovered = true
        }
      } else if (strategy.type === 'constantDollar') {
        if (year === stop) retirementBase = startPortfolio * strategy.rate
        const targetWithdrawal = Math.max(retirementBase * inflationFactor(stop, year), expenses)
        if (income > targetWithdrawal + oneTimeExpenses) {
          const surplus = income - totalNeeded
          contribution = surplus
          addContribution(surplus)
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
        const expectedMeanReturn =
          ma && targetWeightsNow
            ? targetWeightsNow.equity * ma.assets.equity.meanReturn +
              targetWeightsNow.bonds * ma.assets.bonds.meanReturn +
              targetWeightsNow.cash * ma.assets.cash.meanReturn
            : plan.meanReturn
        const defaultRealReturn = (1 + expectedMeanReturn) / (1 + plan.inflationRate) - 1
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
          addContribution(surplus)
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
          const prevReturn = prevYearReturn
          const prevInflation = inflationForYear(year - 1)
          const skipInflation =
            Boolean(strategy.skipInflationAfterNegativeReturn) &&
            prevReturn < 0 &&
            prevInflation > 0
          if (!skipInflation) {
            currentWithdrawal *= 1 + prevInflation
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
          addContribution(surplus)
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

    // Applica il rendimento annuo: per-bucket in modalità multi-asset (con scala
    // proporzionale all'effectiveBase per il timing midYear), scalare altrimenti
    const applyInvestmentReturn = (effectiveBase?: number) => {
      if (buckets && assetReturns) {
        const scale = effectiveBase !== undefined ? (portfolio > 0 ? effectiveBase / portfolio : 0) : 1
        investmentReturn = 0
        for (const id of ASSET_CLASS_IDS) {
          const ir = buckets[id].value * scale * assetReturns[id]
          buckets[id].value = Math.max(0, buckets[id].value + ir)
          investmentReturn += ir
        }
        syncFromBuckets()
      } else {
        const base = effectiveBase ?? portfolio
        investmentReturn = base * returnRate
        portfolio = Math.max(0, portfolio + investmentReturn)
      }
    }

    if (!retired) {
      const investedBeforeCf = portfolio
      const net = income - expenses - pfNetOutflow
      contribution = net
      if (net > 0) {
        addContribution(net)
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
        applyInvestmentReturn(effectiveBase)
      } else {
        applyInvestmentReturn()
      }
    } else if (timing === 'legacy') {
      applyInvestmentReturn()
      executeRetirementCashflow()
    } else if (timing === 'startOfYear') {
      executeRetirementCashflow()
      applyInvestmentReturn()
    } else {
      // timing === 'midYear'
      const investedBeforeCf = portfolio
      executeRetirementCashflow()
      const effectiveBase = Math.max(
        0,
        investedBeforeCf + 0.5 * Math.max(0, contribution) - 0.5 * grossSale
      )
      applyInvestmentReturn(effectiveBase)
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
          if (buckets && assetTaxRates && targetWeightsNow) {
            const refill = withdrawFromBuckets(buckets, refillTarget, targetWeightsNow, assetTaxRates)
            grossSale += refill.grossSale
            taxPaid += refill.taxPaid
            bufferRefill = refill.netProceeds
            cashBuffer += refill.netProceeds
            syncFromBuckets()
          } else {
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
    }

    // Hard rebalancing a fine anno (threshold / annual) prima dell'imposta di bollo
    let rebalanceTaxPaid = 0
    if (buckets && ma && assetTaxRates && targetWeightsNow && !depleted && portfolio > 0) {
      const rb = rebalanceBuckets(buckets, targetWeightsNow, ma.rebalance, assetTaxRates)
      if (rb.grossSale > 0) {
        grossSale += rb.grossSale
        taxPaid += rb.taxPaid
        rebalanceTaxPaid = rb.taxPaid
        syncFromBuckets()
      }
    }

    let stampDuty = 0
    if (buckets) {
      for (const id of ASSET_CLASS_IDS) {
        const r = applyStampDuty(buckets[id].value, buckets[id].costBasis, plan.stampDutyRate ?? 0)
        buckets[id].value = r.remainingPortfolio
        buckets[id].costBasis = r.remainingCostBasis
        stampDuty += r.stampDuty
      }
      syncFromBuckets()
    } else {
      const stamped = applyStampDuty(portfolio, costBasis, plan.stampDutyRate ?? 0)
      portfolio = stamped.remainingPortfolio
      costBasis = stamped.remainingCostBasis
      stampDuty = stamped.stampDuty
    }
    taxPaid += stampDuty
    const stampDutyPaid = stampDuty

    if (portfolio <= 1e-9) {
      portfolio = 0
      costBasis = 0
      if (buckets) {
        for (const id of ASSET_CLASS_IDS) {
          buckets[id].value = 0
          buckets[id].costBasis = 0
        }
      }
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
      ...(buckets && targetWeightsNow
        ? {
            buckets: cloneBuckets(buckets),
            targetWeights: targetWeightsNow,
            rebalanceTaxPaid
          }
        : {}),
      returnRate,
      ...(inflations ? { inflationRate: inflationForYear(year) } : {}),
      investmentReturn,
      startPortfolio,
      endPortfolio,
      endCostBasis: costBasis,
      expensesNotCovered,
      depleted
    })

    prevYearReturn = returnRate
  }

  return states
}

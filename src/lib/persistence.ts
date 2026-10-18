import type { LifeEvent, PensionFundConfig, Plan, WithdrawalStrategy, YearState } from './engine/types'

export const STORAGE_KEY = 'fireita.plan.v1'
export const BASELINE_STORAGE_KEY = 'fireita.baseline.v1'

export function createDefaultPlan(): Plan {
  return {
    startYear: new Date().getFullYear(),
    birthYear: 1977,
    retirementAge: 67,
    lifeExpectancyAge: 95,
    initialPortfolio: 100_000,
    initialCostBasis: 80_000,
    annualIncome: 40_000,
    incomeGrowthRate: 0.02,
    annualExpenses: 25_000,
    inflationRate: 0.02,
    meanReturn: 0.05,
    returnStdDev: 0.15,
    runs: 1_000,
    seed: 42,
    taxRate: 0.26,
    stampDutyRate: 0.002,
    whitelistAllocation: 0,
    withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
    events: []
  }
}

function finiteNumber(raw: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return fallback
  const val = Number(raw)
  return Number.isFinite(val) ? Math.min(max, Math.max(min, val)) : fallback
}

function sanitizeWithdrawalStrategy(
  raw: unknown,
  fallback: WithdrawalStrategy
): WithdrawalStrategy {
  if (!raw || typeof raw !== 'object') return fallback
  const ws = raw as Record<string, unknown>

  if (ws.type === 'percentCap') {
    return {
      type: 'percentCap',
      rate: finiteNumber(ws.rate, 0.04, 0, 1)
    }
  }

  if (ws.type === 'constantDollar') {
    return {
      type: 'constantDollar',
      rate: finiteNumber(ws.rate, 0.04, 0, 1)
    }
  }

  if (ws.type === 'spendExpenses') {
    return { type: 'spendExpenses' }
  }

  if (ws.type === 'guardrails') {
    const strategy: WithdrawalStrategy = {
      type: 'guardrails',
      initialRate: finiteNumber(ws.initialRate, 0.04, 0, 1),
      lowerGuardrail: finiteNumber(ws.lowerGuardrail, 0.03, 0, 1),
      upperGuardrail: finiteNumber(ws.upperGuardrail, 0.05, 0, 1),
      increasePct: finiteNumber(ws.increasePct, 0.1, 0, 10),
      decreasePct: finiteNumber(ws.decreasePct, 0.1, 0, 1)
    }
    if (typeof ws.skipInflationAfterNegativeReturn === 'boolean') {
      strategy.skipInflationAfterNegativeReturn = ws.skipInflationAfterNegativeReturn
    }
    return strategy
  }

  if (ws.type === 'vpw') {
    const strategy: WithdrawalStrategy = { type: 'vpw' }
    if (ws.realReturnRate !== undefined && Number.isFinite(Number(ws.realReturnRate))) {
      strategy.realReturnRate = finiteNumber(ws.realReturnRate, 0.03, -0.5, 1)
    }
    if (ws.legacyFraction !== undefined && Number.isFinite(Number(ws.legacyFraction))) {
      strategy.legacyFraction = finiteNumber(ws.legacyFraction, 0, 0, 1)
    }
    if (ws.minRate !== undefined && Number.isFinite(Number(ws.minRate))) {
      strategy.minRate = finiteNumber(ws.minRate, 0, 0, 1)
    }
    if (ws.maxRate !== undefined && Number.isFinite(Number(ws.maxRate))) {
      strategy.maxRate = finiteNumber(ws.maxRate, 1, 0, 1)
    }
    return strategy
  }

  return fallback
}

function sanitizeEvent(raw: unknown): LifeEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>

  if (e.kind === 'setExpenses') {
    if (typeof e.fromYear !== 'number' || !Number.isFinite(e.fromYear)) return null
    if (typeof e.amount !== 'number' || !Number.isFinite(e.amount)) return null
    return {
      kind: 'setExpenses',
      fromYear: Math.round(e.fromYear),
      amount: Math.max(0, e.amount)
    }
  }

  if (e.kind === 'oneTimeExpense') {
    if (typeof e.atYear !== 'number' || !Number.isFinite(e.atYear)) return null
    if (typeof e.amount !== 'number' || !Number.isFinite(e.amount)) return null
    return {
      kind: 'oneTimeExpense',
      atYear: Math.round(e.atYear),
      amount: Math.max(0, e.amount)
    }
  }

  if (e.kind === 'stopWorking') {
    if (typeof e.atYear !== 'number' || !Number.isFinite(e.atYear)) return null
    return {
      kind: 'stopWorking',
      atYear: Math.round(e.atYear)
    }
  }

  if (e.kind === 'recurringIncome') {
    if (typeof e.fromYear !== 'number' || !Number.isFinite(e.fromYear)) return null
    if (typeof e.amount !== 'number' || !Number.isFinite(e.amount)) return null
    const ev: LifeEvent = {
      kind: 'recurringIncome',
      fromYear: Math.round(e.fromYear),
      amount: Math.max(0, e.amount)
    }
    if (typeof e.toYear === 'number' && Number.isFinite(e.toYear)) {
      ev.toYear = Math.round(e.toYear)
    }
    if (typeof e.inflationAdjusted === 'boolean') {
      ev.inflationAdjusted = e.inflationAdjusted
    }
    return ev
  }

  return null
}

function sanitizePensionFund(raw: unknown): PensionFundConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const pf = raw as Record<string, unknown>
  const config: PensionFundConfig = {
    initialBalance: finiteNumber(pf.initialBalance, 0, 0),
    initialSeniorityYears: Math.round(finiteNumber(pf.initialSeniorityYears, 0, 0, 80)),
    annualContribution: finiteNumber(pf.annualContribution, 0, 0),
    irpefMarginalRate: finiteNumber(pf.irpefMarginalRate, 0.35, 0, 1),
    ritaStartAge: Math.round(finiteNumber(pf.ritaStartAge, 57, 0, 120)),
    ritaEndAge: Math.round(finiteNumber(pf.ritaEndAge, 67, 0, 120))
  }
  if (pf.initialTaxableBase !== undefined && Number.isFinite(Number(pf.initialTaxableBase))) {
    config.initialTaxableBase = finiteNumber(pf.initialTaxableBase, config.initialBalance, 0)
  }
  if (pf.returnRateOffset !== undefined && Number.isFinite(Number(pf.returnRateOffset))) {
    config.returnRateOffset = finiteNumber(pf.returnRateOffset, 0, -0.5, 0.5)
  }
  return config
}

export function sanitizePlan(raw: unknown): Plan {
  const def = createDefaultPlan()
  if (!raw || typeof raw !== 'object') return def
  const obj = raw as Record<string, unknown>

  const num = (key: keyof Plan, fallback: number, min = -Infinity, max = Infinity): number =>
    finiteNumber(obj[key], fallback, min, max)

  const withdrawalStrategy = sanitizeWithdrawalStrategy(
    obj.withdrawalStrategy,
    def.withdrawalStrategy
  )

  const events: LifeEvent[] = Array.isArray(obj.events)
    ? obj.events.map(sanitizeEvent).filter((e): e is LifeEvent => e !== null)
    : []

  const hasCoreFields = 'startYear' in obj || 'birthYear' in obj || 'initialPortfolio' in obj

  const sanitized: Plan = {
    startYear: Math.round(num('startYear', def.startYear, 1900, 2200)),
    birthYear: Math.round(num('birthYear', def.birthYear, 1900, 2200)),
    retirementAge: Math.round(num('retirementAge', def.retirementAge, 18, 120)),
    lifeExpectancyAge: Math.round(num('lifeExpectancyAge', def.lifeExpectancyAge, 19, 130)),
    initialPortfolio: num('initialPortfolio', def.initialPortfolio, 0),
    initialCostBasis: num('initialCostBasis', def.initialCostBasis, 0),
    annualIncome: num('annualIncome', def.annualIncome, 0),
    incomeGrowthRate: num('incomeGrowthRate', def.incomeGrowthRate, -0.5, 1),
    annualExpenses: num('annualExpenses', def.annualExpenses, 0),
    inflationRate: num('inflationRate', def.inflationRate, -0.2, 1),
    meanReturn: num('meanReturn', def.meanReturn, -0.5, 1),
    returnStdDev: num('returnStdDev', def.returnStdDev, 0, 2),
    runs: Math.round(num('runs', def.runs, 10, 10_000)),
    seed: Math.round(num('seed', def.seed)),
    taxRate: num('taxRate', def.taxRate, 0, 1),
    withdrawalStrategy,
    events
  }

  if (obj.stampDutyRate !== undefined || !hasCoreFields) {
    sanitized.stampDutyRate = num('stampDutyRate', def.stampDutyRate ?? 0.002, 0, 1)
  }

  if (obj.whitelistAllocation !== undefined || !hasCoreFields) {
    sanitized.whitelistAllocation = num(
      'whitelistAllocation',
      def.whitelistAllocation ?? 0,
      0,
      1
    )
  }

  const pensionFund = sanitizePensionFund(obj.pensionFund)
  if (pensionFund !== undefined) {
    sanitized.pensionFund = pensionFund
  }

  return sanitized
}

export function encodePlanToUrlParam(plan: Plan): string {
  const json = JSON.stringify(plan)
  return btoa(encodeURIComponent(json))
}

export function decodePlanFromUrlParam(encoded: string): Plan | null {
  try {
    const json = decodeURIComponent(atob(encoded))
    return sanitizePlan(JSON.parse(json))
  } catch {
    return null
  }
}

export function exportYearsToCsv(years: YearState[]): string {
  const headers = [
    'Anno',
    'Eta',
    'Fase',
    'PatrimonioInizio',
    'Reddito',
    'Spese',
    'Risparmio',
    'PrelievoNetto',
    'VenditaLorda',
    'ImpostePagate',
    'RendimentoPct',
    'RendimentoEur',
    'PatrimonioFine',
    'CostoFiscaleFine',
    'SpeseNonCoperte',
    'Esaurito'
  ]
  const rows = years.map((y) =>
    [
      y.calendarYear,
      y.age,
      y.phase,
      y.startPortfolio.toFixed(2),
      y.income.toFixed(2),
      y.expenses.toFixed(2),
      y.contribution.toFixed(2),
      y.withdrawal.toFixed(2),
      y.grossSale.toFixed(2),
      y.taxPaid.toFixed(2),
      (y.returnRate * 100).toFixed(2),
      y.investmentReturn.toFixed(2),
      y.endPortfolio.toFixed(2),
      y.endCostBasis.toFixed(2),
      y.expensesNotCovered ? '1' : '0',
      y.depleted ? '1' : '0'
    ].join(',')
  )
  return [headers.join(','), ...rows].join('\n')
}

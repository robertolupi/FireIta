import type {
  AssetClassId,
  AssetWeights,
  CashBufferConfig,
  CashflowTiming,
  GlidepathConfig,
  LifeEvent,
  MultiAssetConfig,
  PensionFundConfig,
  Plan,
  RebalanceStrategy,
  SimulationMode,
  WithdrawalStrategy,
  YearState
} from './engine/types'

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

function sanitizeCashflowTiming(raw: unknown): CashflowTiming | undefined {
  if (raw === 'legacy' || raw === 'startOfYear' || raw === 'midYear') {
    return raw
  }
  return undefined
}

function sanitizeCashBuffer(raw: unknown): CashBufferConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const cb = raw as Record<string, unknown>
  return {
    enabled: Boolean(cb.enabled),
    yearsOfExpenses: finiteNumber(cb.yearsOfExpenses, 2, 0, 10),
    cashReturnRate: finiteNumber(cb.cashReturnRate, 0.02, -0.5, 1),
    drawdownThreshold: finiteNumber(cb.drawdownThreshold, 0, -1, 1)
  }
}

function sanitizeDatasetId(raw: unknown): 'usa' | 'italia' | undefined {
  return raw === 'usa' || raw === 'italia' ? raw : undefined
}

function sanitizeSimulationMode(raw: unknown): SimulationMode | undefined {  if (!raw || typeof raw !== 'object') return undefined
  const sm = raw as Record<string, unknown>

  if (sm.type === 'parametric') return { type: 'parametric' }

  if (sm.type === 'historicalRolling') {
    const mode: SimulationMode = { type: 'historicalRolling' }
    const datasetId = sanitizeDatasetId(sm.datasetId)
    if (datasetId !== undefined) mode.datasetId = datasetId
    if (sm.stockAllocation !== undefined && Number.isFinite(Number(sm.stockAllocation))) {
      mode.stockAllocation = finiteNumber(sm.stockAllocation, 1, 0, 1)
    }
    return mode
  }

  if (sm.type === 'blockBootstrap') {
    const mode: SimulationMode = { type: 'blockBootstrap' }
    const datasetId = sanitizeDatasetId(sm.datasetId)
    if (datasetId !== undefined) mode.datasetId = datasetId
    if (sm.blockSize !== undefined && Number.isFinite(Number(sm.blockSize))) {
      mode.blockSize = Math.round(finiteNumber(sm.blockSize, 5, 1, 20))
    }
    if (typeof sm.stationary === 'boolean') mode.stationary = sm.stationary
    if (sm.stockAllocation !== undefined && Number.isFinite(Number(sm.stockAllocation))) {
      mode.stockAllocation = finiteNumber(sm.stockAllocation, 1, 0, 1)
    }
    return mode
  }

  return undefined
}

function sanitizeAssetWeights(raw: unknown, fallback: AssetWeights): AssetWeights | undefined {
  if (!raw || typeof raw !== 'object') return fallback
  const w = raw as Record<string, unknown>
  const equity = finiteNumber(w.equity, fallback.equity, 0, 1)
  const bonds = finiteNumber(w.bonds, fallback.bonds, 0, 1)
  const cash = finiteNumber(w.cash, fallback.cash, 0, 1)
  if (equity + bonds + cash <= 0) return undefined
  return { equity, bonds, cash }
}

function sanitizeGlidepath(raw: unknown): GlidepathConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const g = raw as Record<string, unknown>

  if (g.type === 'static') {
    const weights = sanitizeAssetWeights(g.weights, { equity: 1, bonds: 0, cash: 0 })
    if (weights === undefined) return undefined
    return { type: 'static', weights }
  }

  if (g.type === 'bondTent') {
    const accumulationWeights = sanitizeAssetWeights(g.accumulationWeights, {
      equity: 0.8,
      bonds: 0.2,
      cash: 0
    })
    const peakWeights = sanitizeAssetWeights(g.peakWeights, { equity: 0.4, bonds: 0.5, cash: 0.1 })
    const postTentWeights = sanitizeAssetWeights(g.postTentWeights, {
      equity: 0.7,
      bonds: 0.3,
      cash: 0
    })
    if (
      accumulationWeights === undefined ||
      peakWeights === undefined ||
      postTentWeights === undefined
    ) {
      return undefined
    }
    return {
      type: 'bondTent',
      accumulationWeights,
      peakWeights,
      postTentWeights,
      yearsBeforeRetirement: Math.round(finiteNumber(g.yearsBeforeRetirement, 5, 0, 30)),
      yearsAfterRetirement: Math.round(finiteNumber(g.yearsAfterRetirement, 10, 0, 30))
    }
  }

  return undefined
}

function sanitizeRebalanceStrategy(raw: unknown): RebalanceStrategy {
  if (!raw || typeof raw !== 'object') return { mode: 'threshold', band: 0.05 }
  const r = raw as Record<string, unknown>
  if (r.mode === 'cashflowOnly') return { mode: 'cashflowOnly' }
  if (r.mode === 'annual') return { mode: 'annual' }
  if (r.mode === 'threshold') {
    return { mode: 'threshold', band: finiteNumber(r.band, 0.05, 0, 0.5) }
  }
  return { mode: 'threshold', band: 0.05 }
}

function sanitizeMultiAsset(raw: unknown): MultiAssetConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const ma = raw as Record<string, unknown>
  if (!ma.assets || typeof ma.assets !== 'object') return undefined
  const rawAssets = ma.assets as Record<string, unknown>

  const assetIds: AssetClassId[] = ['equity', 'bonds', 'cash']
  const defaults: Record<AssetClassId, { meanReturn: number; returnStdDev: number; taxRate: number }> = {
    equity: { meanReturn: 0.05, returnStdDev: 0.15, taxRate: 0.26 },
    bonds: { meanReturn: 0.02, returnStdDev: 0.06, taxRate: 0.125 },
    cash: { meanReturn: 0.015, returnStdDev: 0.01, taxRate: 0.26 }
  }
  const assets = {} as MultiAssetConfig['assets']
  for (const id of assetIds) {
    const raw = rawAssets[id]
    if (!raw || typeof raw !== 'object') return undefined
    const a = raw as Record<string, unknown>
    assets[id] = {
      id,
      meanReturn: finiteNumber(a.meanReturn, defaults[id].meanReturn, -0.5, 1),
      returnStdDev: finiteNumber(a.returnStdDev, defaults[id].returnStdDev, 0, 2),
      taxRate: finiteNumber(a.taxRate, defaults[id].taxRate, 0, 1)
    }
  }

  const rawCorr = (ma.correlations ?? {}) as Record<string, unknown>
  const correlations = {
    equityBonds: finiteNumber(rawCorr.equityBonds, -0.1, -0.99, 0.99),
    equityCash: finiteNumber(rawCorr.equityCash, 0, -0.99, 0.99),
    bondsCash: finiteNumber(rawCorr.bondsCash, 0.1, -0.99, 0.99)
  }

  const glidepath = sanitizeGlidepath(ma.glidepath)
  if (glidepath === undefined) return undefined

  return { assets, correlations, glidepath, rebalance: sanitizeRebalanceStrategy(ma.rebalance) }
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

  const cashflowTiming = sanitizeCashflowTiming(obj.cashflowTiming)
  if (cashflowTiming !== undefined) {
    sanitized.cashflowTiming = cashflowTiming
  }

  const cashBuffer = sanitizeCashBuffer(obj.cashBuffer)
  if (cashBuffer !== undefined) {
    sanitized.cashBuffer = cashBuffer
  }

  const simulationMode = sanitizeSimulationMode(obj.simulationMode)
  if (simulationMode !== undefined) {
    sanitized.simulationMode = simulationMode
  }

  const multiAsset = sanitizeMultiAsset(obj.multiAsset)
  if (multiAsset !== undefined) {
    sanitized.multiAsset = multiAsset
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
  const hasCashBuffer = years.some((y) => y.cashBufferEnd !== undefined)
  const hasInflation = years.some((y) => y.inflationRate !== undefined)
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
    ...(hasInflation ? ['InflazionePct'] : []),
    'RendimentoEur',
    'PatrimonioFine',
    'CostoFiscaleFine',
    ...(hasCashBuffer ? ['CashBufferFine', 'PrelievoBuffer', 'RefillBuffer'] : []),
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
      ...(hasInflation ? [((y.inflationRate ?? 0) * 100).toFixed(2)] : []),
      y.investmentReturn.toFixed(2),
      y.endPortfolio.toFixed(2),
      y.endCostBasis.toFixed(2),
      ...(hasCashBuffer
        ? [
            (y.cashBufferEnd ?? 0).toFixed(2),
            (y.bufferWithdrawal ?? 0).toFixed(2),
            (y.bufferRefill ?? 0).toFixed(2)
          ]
        : []),
      y.expensesNotCovered ? '1' : '0',
      y.depleted ? '1' : '0'
    ].join(',')
  )
  return [headers.join(','), ...rows].join('\n')
}

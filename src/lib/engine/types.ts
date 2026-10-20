export type WithdrawalStrategy =
  | { type: 'percentCap'; rate: number }
  | { type: 'constantDollar'; rate: number }
  | { type: 'spendExpenses' }
  | {
      type: 'guardrails'
      initialRate: number
      lowerGuardrail: number
      upperGuardrail: number
      increasePct: number
      decreasePct: number
      /** Se true, salta l'adeguamento all'inflazione dopo un anno con rendimento < 0 (Guyton-Klinger Inflation Rule) */
      skipInflationAfterNegativeReturn?: boolean
    }
  | {
      type: 'vpw'
      /** Rendimento reale atteso per la formula PMT (se omesso, usa Fisher su meanReturn e inflationRate) */
      realReturnRate?: number
      /** Frazione del portafoglio da preservare a fine orizzonte (0..1, default 0) */
      legacyFraction?: number
      /** Tasso minimo annuo di prelievo (default 0) */
      minRate?: number
      /** Tasso massimo annuo di prelievo (default 1) */
      maxRate?: number
    }

export type LifeEvent =
  | { kind: 'setExpenses'; fromYear: number; amount: number }
  | { kind: 'oneTimeExpense'; atYear: number; amount: number }
  | { kind: 'stopWorking'; atYear: number }
  | {
      kind: 'recurringIncome'
      fromYear: number
      toYear?: number
      amount: number
      /** Se true (default), l'importo è rivalutato all'inflazione (es. Pensione INPS perequata ISTAT) */
      inflationAdjusted?: boolean
    }

export interface PensionFundConfig {
  /** Montante già presente nel fondo pensione a inizio piano */
  initialBalance: number
  /** Quota del montante soggetta a tassazione finale (contributi dedotti + TFR); default = initialBalance */
  initialTaxableBase?: number
  /** Anni di anzianità pregressa nel fondo pensione a startYear */
  initialSeniorityYears: number
  /** Versamento annuo durante la fase di accumulo (es. 5164.57) */
  annualContribution: number
  /** Aliquota marginale IRPEF per il rimborso da deduzione (es. 0.35 o 0.43) */
  irpefMarginalRate: number
  /** Delta rendimento annuo rispetto al portafoglio principale (default 0) */
  returnRateOffset?: number
  /** Età di avvio erogazione RITA / rendita (es. 57) */
  ritaStartAge: number
  /** Età di termine RITA (es. 67, coincidente con l'avvio pensione INPS) */
  ritaEndAge: number
}

export type CashflowTiming = 'legacy' | 'startOfYear' | 'midYear'

export type AssetClassId = 'equity' | 'bonds' | 'cash'

export interface AssetClassParams {
  id: AssetClassId
  meanReturn: number
  returnStdDev: number
  /** Aliquota capital gains dell'asset (es. 0.26 ETF azionari, 0.125 governativi White List) */
  taxRate: number
}

export interface AssetWeights {
  equity: number
  bonds: number
  cash: number
}

export type AssetYearReturns = Record<AssetClassId, number>

/** Rendimenti annuali accettati da runProjection: scalare (legacy) o per asset class */
export type ProjectionReturns = Array<number | AssetYearReturns>

export type GlidepathConfig =
  | { type: 'static'; weights: AssetWeights }
  | {
      type: 'bondTent'
      accumulationWeights: AssetWeights
      /** Allocazione al picco difensivo nell'anno di pensionamento */
      peakWeights: AssetWeights
      postTentWeights: AssetWeights
      /** Anni prima del pensionamento in cui inizia il de-risking */
      yearsBeforeRetirement: number
      /** Anni dopo il pensionamento in cui termina la risalita azionaria */
      yearsAfterRetirement: number
    }

export type RebalanceStrategy =
  | { mode: 'cashflowOnly' }
  | { mode: 'threshold'; band: number }
  | { mode: 'annual' }

export interface MultiAssetConfig {
  assets: Record<AssetClassId, AssetClassParams>
  correlations: {
    equityBonds: number
    equityCash: number
    bondsCash: number
  }
  glidepath: GlidepathConfig
  rebalance: RebalanceStrategy
}

export interface AssetBuckets {
  equity: { value: number; costBasis: number }
  bonds: { value: number; costBasis: number }
  cash: { value: number; costBasis: number }
}

export interface HistoricalYearData {
  calendarYear: number
  equityReturn: number
  bondReturn: number
  inflationRate: number
}

export type HistoricalDatasetId = 'usa' | 'italia'

export type SimulationMode =
  | { type: 'parametric' }
  | {
      type: 'historicalRolling'
      datasetId?: HistoricalDatasetId
      /** Peso azionario 0..1 (default 1) */
      stockAllocation?: number
      customDataset?: HistoricalYearData[]
    }
  | {
      type: 'blockBootstrap'
      datasetId?: HistoricalDatasetId
      /** Anni contigui per blocco (default 5) */
      blockSize?: number
      /** true: Stationary Bootstrap di Politis-Romano; false (default): Moving Block Bootstrap */
      stationary?: boolean
      /** Peso azionario 0..1 (default 1) */
      stockAllocation?: number
      customDataset?: HistoricalYearData[]
    }

export interface CashBufferConfig {
  enabled: boolean
  /** Numero di anni di spese correnti da mantenere nel buffer (es. 2.0) */
  yearsOfExpenses: number
  /** Rendimento annuo netto della liquidità nel buffer (es. 0.02) */
  cashReturnRate: number
  /** Soglia di rendimento azionario sotto la quale si attinge dal buffer (default: 0) */
  drawdownThreshold: number
}

export interface Plan {
  startYear: number
  birthYear: number
  retirementAge: number
  lifeExpectancyAge: number
  initialPortfolio: number
  initialCostBasis: number
  annualIncome: number
  incomeGrowthRate: number
  annualExpenses: number
  inflationRate: number
  meanReturn: number
  returnStdDev: number
  runs: number
  seed: number
  taxRate: number
  /** Aliquota imposta di bollo annua sul dossier titoli (default 0, tipico Italia: 0.002 = 0,20%) */
  stampDutyRate?: number
  /** Quota di portafoglio in Titoli di Stato White List tassati al 12,5% anziché taxRate (0..1, default 0) */
  whitelistAllocation?: number
  /** Configurazione opzionale Fondo Pensione Complementare / RITA */
  pensionFund?: PensionFundConfig
  /** Convenzione temporale dei flussi di cassa infra-annuali (default 'legacy') */
  cashflowTiming?: CashflowTiming
  /** Configurazione opzionale Cuscinetto di Liquidità (Cash Buffer anti-SRR) */
  cashBuffer?: CashBufferConfig
  /** Modalità di generazione dei rendimenti/inflazione (default: parametrica log-normale) */
  simulationMode?: SimulationMode
  /** Configurazione opzionale portafoglio multi-asset (equity/bonds/cash) con glidepath */
  multiAsset?: MultiAssetConfig
  withdrawalStrategy: WithdrawalStrategy
  events: LifeEvent[]
}

export interface YearState {
  year: number
  age: number
  calendarYear: number
  phase: 'accumulation' | 'retirement'
  income: number
  expenses: number
  contribution: number
  withdrawal: number
  grossSale: number
  taxPaid: number
  /** Di cui imposta di bollo pagata nell'anno */
  stampDutyPaid?: number
  /** Saldo residuo del fondo pensione a fine anno (se pensionFund è attivo) */
  pensionFundBalance?: number
  /** Saldo iniziale del Cash Buffer nell'anno (se cashBuffer è attivo) */
  cashBufferStart?: number
  /** Saldo finale del Cash Buffer nell'anno (se cashBuffer è attivo) */
  cashBufferEnd?: number
  /** Prelievo effettuato dal Cash Buffer nell'anno per coprire spese in mercato negativo */
  bufferWithdrawal?: number
  /** Ricostituzione del Cash Buffer nell'anno da surplus di rendimento */
  bufferRefill?: number
  /** Alias saldo finale Cash Buffer (= cashBufferEnd) */
  cashBufferBalance?: number
  /** Movimento netto sul Cash Buffer nell'anno (= bufferRefill - bufferWithdrawal) */
  cashBufferMovement?: number
  returnRate: number
  /** Tasso di inflazione applicato nell'anno (presente solo con simulazione a inflazione stocastica) */
  inflationRate?: number
  /** Valore e cost basis per asset class a fine anno (presente solo in modalità multi-asset) */
  buckets?: AssetBuckets
  /** Pesi target del glidepath nell'anno (presente solo in modalità multi-asset) */
  targetWeights?: AssetWeights
  /** Imposte pagate nell'anno per hard rebalancing (presente solo in modalità multi-asset) */
  rebalanceTaxPaid?: number
  investmentReturn: number
  startPortfolio: number
  endPortfolio: number
  endCostBasis: number
  expensesNotCovered: boolean
  depleted: boolean
}

export interface SimResult {
  run: number
  years: YearState[]
  finalPortfolio: number
  depletionYear: number | null
  /** true se il patrimonio non si è mai esaurito (depletionYear === null) */
  success: boolean
  /** Primo anno (indice 0-based) in cui expensesNotCovered === true, o null */
  firstShortfallYear: number | null
  /** Numero totale di anni nell'orizzonte con expensesNotCovered === true */
  shortfallYearsCount: number
  /** true se il patrimonio sopravvive E tutte le spese sono sempre state coperte */
  fullCoverage: boolean
}

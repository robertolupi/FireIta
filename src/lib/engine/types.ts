export type WithdrawalStrategy =
  | { type: 'percentCap'; rate: number }
  | {
      type: 'guardrails'
      initialRate: number
      lowerGuardrail: number
      upperGuardrail: number
      increasePct: number
      decreasePct: number
    }

export type LifeEvent =
  | { kind: 'setExpenses'; fromYear: number; amount: number }
  | { kind: 'oneTimeExpense'; atYear: number; amount: number }
  | { kind: 'stopWorking'; atYear: number }

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
  returnRate: number
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
  success: boolean
}

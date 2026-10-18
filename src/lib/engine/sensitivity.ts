import type { Plan } from './types'
import { inflationDivisor, type ValueMode } from './deflate'
import { mulberry32, sampleAnnualReturn } from './montecarlo'
import { currentAge, horizonYears, runProjection } from './projection'
import { percentile } from './stats'

export interface SensitivityCell {
  retirementAge: number
  annualExpenses: number
  isCurrent: boolean
  successRate: number
  fullCoverageRate: number
  medianFinalPortfolio: number
}

export interface SensitivityGrid {
  retirementAges: number[]
  expenseLevels: number[]
  cells: SensitivityCell[][] // [rowIndex (expense)][colIndex (age)]
  runsPerCell: number
}

export interface SensitivityOptions {
  ageStep?: number // default: 2 anni (es. -4, -2, 0, +2, +4)
  expenseStep?: number // default: 2_500 € (es. -5k, -2.5k, 0, +2.5k, +5k)
  gridRuns?: number // default: 400
  valueMode?: ValueMode // default: 'nominal'
}

export function buildAxis(
  center: number,
  step: number,
  count: number,
  min: number,
  max: number
): number[] {
  const half = Math.floor(count / 2)
  const raw: number[] = []
  for (let i = -half; i <= half; i++) {
    raw.push(Math.min(max, Math.max(min, center + i * step)))
  }
  return Array.from(new Set(raw)).sort((a, b) => a - b)
}

export function computeSensitivityGrid(
  plan: Plan,
  options: SensitivityOptions = {}
): SensitivityGrid {
  const ageStep = options.ageStep ?? 2
  const expenseStep = options.expenseStep ?? 2_500
  const runsPerCell = Math.max(10, Math.min(Math.max(10, plan.runs), options.gridRuns ?? 400))
  const valueMode: ValueMode = options.valueMode ?? 'nominal'

  const minAge = Math.max(18, currentAge(plan))
  const maxAge = Math.max(minAge, plan.lifeExpectancyAge - 1)

  const retirementAges = buildAxis(plan.retirementAge, ageStep, 5, minAge, maxAge)
  const expenseLevels = buildAxis(plan.annualExpenses, expenseStep, 5, 1_000, 1_000_000)

  // Pre-genera le traiettorie di rendimento comuni (Common Random Numbers)
  const rng = mulberry32(plan.seed)
  const horizon = horizonYears(plan)
  const returnMatrix: number[][] = Array.from({ length: runsPerCell }, () =>
    Array.from({ length: horizon }, () =>
      sampleAnnualReturn(rng, plan.meanReturn, plan.returnStdDev)
    )
  )

  const finalYearDivisor =
    valueMode === 'real'
      ? inflationDivisor(Math.max(0, horizon - 1), plan.startYear, plan.inflationRate)
      : 1

  const cells: SensitivityCell[][] = expenseLevels.map((annualExpenses) =>
    retirementAges.map((retirementAge) => {
      const cellPlan: Plan = {
        ...plan,
        retirementAge,
        annualExpenses
      }

      let survivedCount = 0
      let fullCoverageCount = 0
      const finals: number[] = []

      for (let r = 0; r < runsPerCell; r++) {
        const years = runProjection(cellPlan, returnMatrix[r])
        const depleted = years.some((y) => y.depleted)
        const shortfall = years.some((y) => y.expensesNotCovered)
        if (!depleted) survivedCount++
        if (!depleted && !shortfall) fullCoverageCount++
        const finalNom =
          years.length > 0 ? years[years.length - 1].endPortfolio : cellPlan.initialPortfolio
        finals.push(finalNom / finalYearDivisor)
      }

      finals.sort((a, b) => a - b)

      return {
        retirementAge,
        annualExpenses,
        isCurrent:
          retirementAge === plan.retirementAge && annualExpenses === plan.annualExpenses,
        successRate: survivedCount / runsPerCell,
        fullCoverageRate: fullCoverageCount / runsPerCell,
        medianFinalPortfolio: percentile(finals, 50)
      }
    })
  )

  return {
    retirementAges,
    expenseLevels,
    cells,
    runsPerCell
  }
}

export const computeSensitivityMatrix = computeSensitivityGrid

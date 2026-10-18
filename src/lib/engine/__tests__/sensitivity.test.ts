import { describe, expect, it } from 'vitest'
import { createDefaultPlan } from '../../persistence'
import { buildAxis, computeSensitivityGrid } from '../sensitivity'
import type { Plan } from '../types'

describe('sensitivity (Proposal 06)', () => {
  it('1. buildAxis generates centered axis and clamps/deduplicates near bounds', () => {
    expect(buildAxis(67, 2, 5, 49, 94)).toEqual([63, 65, 67, 69, 71])

    const clamped = buildAxis(50, 2, 5, 49, 94)
    expect(clamped[0]).toBeGreaterThanOrEqual(49)
    expect(new Set(clamped).size).toBe(clamped.length)
    expect(clamped).toEqual([49, 50, 52, 54])
  })

  it('2. identifies exactly one cell with isCurrent === true matching the active plan', () => {
    const plan: Plan = {
      ...createDefaultPlan(),
      startYear: 2026,
      birthYear: 1977,
      retirementAge: 65,
      annualExpenses: 25_000,
      runs: 100
    }

    const grid = computeSensitivityGrid(plan, { gridRuns: 100 })
    const allCells = grid.cells.flat()
    const currentCells = allCells.filter((c) => c.isCurrent)

    expect(currentCells).toHaveLength(1)
    expect(currentCells[0].retirementAge).toBe(plan.retirementAge)
    expect(currentCells[0].annualExpenses).toBe(plan.annualExpenses)
  })

  it('3. satisfies economic monotonicity across retirementAge and annualExpenses via CRN', () => {
    const plan: Plan = {
      ...createDefaultPlan(),
      startYear: 2026,
      birthYear: 1980,
      retirementAge: 62,
      lifeExpectancyAge: 90,
      initialPortfolio: 200_000,
      initialCostBasis: 150_000,
      annualIncome: 45_000,
      annualExpenses: 25_000,
      runs: 150,
      seed: 42
    }

    const grid = computeSensitivityGrid(plan, {
      ageStep: 2,
      expenseStep: 2_500,
      gridRuns: 150
    })

    // A parità di riga (spese fisse), ritirarsi più tardi non peggiora mai successRate né p50
    for (let r = 0; r < grid.cells.length; r++) {
      for (let c = 0; c < grid.cells[r].length - 1; c++) {
        expect(grid.cells[r][c].successRate).toBeLessThanOrEqual(
          grid.cells[r][c + 1].successRate + 1e-9
        )
        expect(grid.cells[r][c].medianFinalPortfolio).toBeLessThanOrEqual(
          grid.cells[r][c + 1].medianFinalPortfolio + 1e-6
        )
      }
    }

    // A parità di colonna (età ritiro fissa), spendere di più non migliora mai successRate né p50
    for (let c = 0; c < grid.retirementAges.length; c++) {
      for (let r = 0; r < grid.cells.length - 1; r++) {
        expect(grid.cells[r][c].successRate + 1e-9).toBeGreaterThanOrEqual(
          grid.cells[r + 1][c].successRate
        )
        expect(grid.cells[r][c].medianFinalPortfolio + 1e-6).toBeGreaterThanOrEqual(
          grid.cells[r + 1][c].medianFinalPortfolio
        )
      }
    }
  })

  it('4. deflates medianFinalPortfolio when valueMode is real', () => {
    const plan: Plan = {
      ...createDefaultPlan(),
      startYear: 2026,
      birthYear: 1986,
      retirementAge: 65,
      lifeExpectancyAge: 76, // horizon = 36 years (t = 35 at final year)
      inflationRate: 0.02,
      runs: 50
    }

    const nomGrid = computeSensitivityGrid(plan, { gridRuns: 50, valueMode: 'nominal' })
    const realGrid = computeSensitivityGrid(plan, { gridRuns: 50, valueMode: 'real' })

    const nomCenter = nomGrid.cells.flat().find((c) => c.isCurrent)!
    const realCenter = realGrid.cells.flat().find((c) => c.isCurrent)!
    const divisor = Math.pow(1.02, 35)

    expect(realCenter.medianFinalPortfolio).toBeCloseTo(
      nomCenter.medianFinalPortfolio / divisor,
      2
    )
  })
})

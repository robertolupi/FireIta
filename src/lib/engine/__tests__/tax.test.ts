import { describe, expect, it } from 'vitest'
import { sellWithTax } from '../tax'

describe('sellWithTax', () => {
  it('vende solo plusvalenza (cost basis zero)', () => {
    const r = sellWithTax(100, 0, 37, 0.26)
    expect(r.grossSale).toBeCloseTo(50)
    expect(r.tax).toBeCloseTo(13)
    expect(r.netProceeds).toBeCloseTo(37)
    expect(r.remainingPortfolio).toBeCloseTo(50)
    expect(r.remainingCostBasis).toBeCloseTo(0)
    expect(r.depleted).toBe(false)
  })

  it('vende solo capitale (cost basis = valore, nessuna tassa)', () => {
    const r = sellWithTax(100, 100, 50, 0.26)
    expect(r.grossSale).toBeCloseTo(50)
    expect(r.tax).toBeCloseTo(0)
    expect(r.netProceeds).toBeCloseTo(50)
    expect(r.remainingPortfolio).toBeCloseTo(50)
    expect(r.remainingCostBasis).toBeCloseTo(50)
    expect(r.depleted).toBe(false)
  })

  it('mix proporzionale tra capitale e plusvalenza', () => {
    const r = sellWithTax(200, 100, 87, 0.26)
    expect(r.grossSale).toBeCloseTo(100)
    expect(r.tax).toBeCloseTo(13)
    expect(r.netProceeds).toBeCloseTo(87)
    expect(r.remainingPortfolio).toBeCloseTo(100)
    expect(r.remainingCostBasis).toBeCloseTo(50)
    expect(r.depleted).toBe(false)
  })

  it('patrimonio insufficiente a coprire il netto richiesto → deplezione', () => {
    const r = sellWithTax(100, 50, 1000, 0.26)
    expect(r.grossSale).toBeCloseTo(100)
    expect(r.tax).toBeCloseTo(13)
    expect(r.netProceeds).toBeCloseTo(87)
    expect(r.remainingPortfolio).toBe(0)
    expect(r.remainingCostBasis).toBe(0)
    expect(r.depleted).toBe(true)
  })
})

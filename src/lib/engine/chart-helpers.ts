import type { LifeEvent, Plan } from './types'
import type { YearBand } from './stats'
import { effectiveStopYear } from './projection'
import { inflationDivisor, type ValueMode } from './deflate'
import { formatEurCompact } from '../format'

export interface ChartMarker {
  /** Anno di calendario dell'evento (es. 2038) */
  year: number
  /** Età corrispondente all'anno dell'evento */
  age: number
  /** Indice 0-based nell'array bands */
  bandIndex: number
  /** Coordinata X nello spazio SVG */
  x: number
  /** Etichette descrittive raggruppate per lo stesso anno */
  labels: string[]
  /** true se in quest'anno cade il pensionamento / stopWorking */
  isStopWork: boolean
}

/**
 * Converte una coordinata X nello spazio SVG nell'indice di banda più vicino (0..count-1),
 * oppure null se fuori dall'area di plot.
 */
export function snapBandIndex(
  xSvg: number,
  width: number,
  padX: number,
  count: number
): number | null {
  if (count <= 0) return null
  if (xSvg < padX - 10 || xSvg > width - padX + 10) return null
  if (count === 1) return 0
  const plotWidth = width - 2 * padX
  const ratio = (xSvg - padX) / plotWidth
  const idx = Math.round(ratio * (count - 1))
  return Math.max(0, Math.min(count - 1, idx))
}

function formatEventLabel(ev: LifeEvent): string {
  switch (ev.kind) {
    case 'stopWorking':
      return 'Smetti di lavorare'
    case 'oneTimeExpense':
      return `Spesa ${formatEurCompact(ev.amount)}`
    case 'setExpenses':
      return `Spese ${formatEurCompact(ev.amount)}/a`
    case 'recurringIncome':
      return `Pensione/Entrata ${formatEurCompact(ev.amount)}/a`
  }
}

function eventCalendarYear(ev: LifeEvent): number {
  switch (ev.kind) {
    case 'stopWorking':
    case 'oneTimeExpense':
      return ev.atYear
    case 'setExpenses':
    case 'recurringIncome':
      return ev.fromYear
  }
}

/**
 * Estrae e deduplica per anno i marker verticali per il pensionamento (effectiveStopYear)
 * e per tutti i LifeEvent configurati nel piano.
 */
export function extractChartMarkers(
  plan: Plan,
  bands: YearBand[],
  width = 800,
  padX = 64
): ChartMarker[] {
  if (bands.length < 2) return []

  const byCalendarYear = new Map<number, { labels: string[]; isStopWork: boolean }>()

  const stopOffset = effectiveStopYear(plan)
  if (stopOffset >= 0 && stopOffset < bands.length) {
    const stopCalYear = plan.startYear + stopOffset
    byCalendarYear.set(stopCalYear, {
      labels: ['Ritiro (FIRE)'],
      isStopWork: true
    })
  }

  for (const ev of plan.events) {
    const calYear = eventCalendarYear(ev)
    const entry = byCalendarYear.get(calYear) ?? { labels: [], isStopWork: false }
    const label = formatEventLabel(ev)
    if (!entry.labels.includes(label)) {
      entry.labels.push(label)
    }
    if (ev.kind === 'stopWorking') {
      entry.isStopWork = true
    }
    byCalendarYear.set(calYear, entry)
  }

  const xScale = (i: number) => padX + (i / Math.max(1, bands.length - 1)) * (width - 2 * padX)
  const result: ChartMarker[] = []

  for (const [calYear, info] of byCalendarYear.entries()) {
    const idx = bands.findIndex((b) => {
      const bCalYear =
        b.calendarYear ?? (b.year >= plan.startYear ? b.year : plan.startYear + b.year)
      return bCalYear === calYear
    })
    if (idx !== -1) {
      result.push({
        year: calYear,
        age: bands[idx].age,
        bandIndex: idx,
        x: xScale(idx),
        labels: info.labels,
        isStopWork: info.isStopWork
      })
    }
  }

  return result.sort((a, b) => a.year - b.year)
}

/**
 * Determina il tasso SWR di riferimento dal piano (o usa swrOverride se fornito).
 */
export function resolveReferenceSwr(plan: Plan, swrOverride?: number): number {
  if (swrOverride !== undefined && swrOverride > 0) return swrOverride
  const ws = plan.withdrawalStrategy
  if ((ws.type === 'percentCap' || ws.type === 'constantDollar') && ws.rate > 0) {
    return ws.rate
  }
  if (ws.type === 'guardrails' && ws.initialRate > 0) {
    return ws.initialRate
  }
  return 0.04
}

/**
 * Calcola la serie annuale della Soglia Target FIRE (Spese Annue / SWR)
 * in modalità 'real' o 'nominal' per ogni banda.
 */
export function computeFireTargetSeries(
  plan: Plan,
  bands: YearBand[],
  valueMode: ValueMode = 'nominal',
  swrOverride?: number
): number[] {
  const swr = resolveReferenceSwr(plan, swrOverride)
  if (swr <= 0) return bands.map(() => 0)

  const expenseChanges = plan.events
    .filter((e): e is Extract<LifeEvent, { kind: 'setExpenses' }> => e.kind === 'setExpenses')
    .sort((a, b) => a.fromYear - b.fromYear)

  return bands.map((b) => {
    const calYear =
      b.calendarYear ?? (b.year >= plan.startYear ? b.year : plan.startYear + b.year)
    const yearOffset = Math.max(0, calYear - plan.startYear)

    let expensesBase = plan.annualExpenses
    for (const change of expenseChanges) {
      if (change.fromYear - plan.startYear <= yearOffset) {
        expensesBase = change.amount
      }
    }

    const nominalExpenses = expensesBase * Math.pow(1 + plan.inflationRate, yearOffset)
    const nominalTarget = nominalExpenses / swr

    if (valueMode === 'real') {
      const d = inflationDivisor(calYear, plan.startYear, plan.inflationRate)
      return nominalTarget / d
    }
    return nominalTarget
  })
}

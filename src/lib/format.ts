const eurFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0
})

const pctFormatter = new Intl.NumberFormat('it-IT', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})

const eurCompactFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1
})

export function formatEur(value: number): string {
  return eurFormatter.format(value)
}

export function formatEurCompact(value: number): string {
  return eurCompactFormatter.format(value)
}

export function formatPct(value: number): string {
  return pctFormatter.format(value)
}

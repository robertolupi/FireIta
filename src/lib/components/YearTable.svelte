<script lang="ts">
  import type { PercentileKey, PercentileRuns } from '../engine/stats'
  import type { YearState } from '../engine/types'
  import { formatEur, formatPct } from '../format'
  import { planStore } from '../stores/plan.svelte'

  interface Props {
    percentileRuns?: PercentileRuns
    years?: YearState[]
  }

  let { percentileRuns, years: fallbackYears = [] }: Props = $props()

  let selectedPercentile = $state<PercentileKey>('p50')
  let showDetailed = $state(false)

  const percentileOptions: { key: PercentileKey; label: string; short: string }[] = [
    { key: 'p10', label: 'P10 — Pessimista', short: 'P10' },
    { key: 'p25', label: 'P25 — Prudente', short: 'P25' },
    { key: 'p50', label: 'P50 — Mediano', short: 'P50' },
    { key: 'p75', label: 'P75 — Favorevole', short: 'P75' },
    { key: 'p90', label: 'P90 — Ottimista', short: 'P90' }
  ]

  let activeRun = $derived(percentileRuns ? percentileRuns[selectedPercentile] : null)
  let years = $derived<YearState[]>(activeRun?.years ?? fallbackYears)
  let hasPensionFund = $derived(years.some((y) => y.pensionFundBalance !== undefined))
  let hasCashBuffer = $derived(years.some((y) => y.cashBufferEnd !== undefined))
  let unitSuffix = $derived(planStore.valueMode === 'real' ? '€ (reali)' : '€ (nom.)')

  let firstDepletionIndex = $derived(years.findIndex((y) => y.depleted || y.endPortfolio <= 0))
  let firstRetirementIndex = $derived(
    years.findIndex((y, i) => i > 0 && years[i - 1].phase === 'accumulation' && y.phase === 'retirement')
  )

  let totals = $derived.by(() =>
    years.reduce(
      (acc, y) => ({
        income: acc.income + y.income,
        expenses: acc.expenses + y.expenses,
        contribution: acc.contribution + y.contribution,
        grossSale: acc.grossSale + y.grossSale,
        taxPaid: acc.taxPaid + y.taxPaid,
        withdrawal: acc.withdrawal + y.withdrawal,
        investmentReturn: acc.investmentReturn + y.investmentReturn
      }),
      {
        income: 0,
        expenses: 0,
        contribution: 0,
        grossSale: 0,
        taxPaid: 0,
        withdrawal: 0,
        investmentReturn: 0
      }
    )
  )

  let lastYear = $derived(years.length > 0 ? years[years.length - 1] : null)
</script>

<section class="card">
  <div class="table-header">
    <div>
      <h2>
        Scenario {selectedPercentile.toUpperCase()} anno per anno ({planStore.valueMode === 'real'
          ? `€ reali ${planStore.plan.startYear}`
          : '€ nominali'})
      </h2>
      {#if activeRun}
        <p class="derived">
          Traiettoria singola rappresentativa (Run #{activeRun.run + 1}) · Patrimonio finale:
          <strong>{formatEur(activeRun.finalPortfolio)}</strong>
        </p>
      {/if}
    </div>

    <div class="table-controls">
      {#if percentileRuns}
        <div class="percentile-selector" role="group" aria-label="Seleziona percentile scenario">
          {#each percentileOptions as opt}
            <button
              type="button"
              class:active={selectedPercentile === opt.key}
              class:p10={opt.key === 'p10'}
              class:p90={opt.key === 'p90'}
              onclick={() => (selectedPercentile = opt.key)}
              title={opt.label}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      {/if}

      <label class="detail-toggle">
        <input type="checkbox" bind:checked={showDetailed} />
        Distinta Cash-Flow dettagliata
      </label>
    </div>
  </div>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Età</th>
          <th>Anno</th>
          <th>Fase</th>
          {#if showDetailed}
            <th>Portafoglio inizio {unitSuffix}</th>
          {/if}
          <th>Entrate {unitSuffix}</th>
          <th>Spese {unitSuffix}</th>
          <th>Versamento {unitSuffix}</th>
          {#if showDetailed}
            <th>Vendita lorda {unitSuffix}</th>
          {/if}
          <th title="Imposte su plusvalenze, bollo 0,20% e RITA">Tasse {unitSuffix}</th>
          <th>Prelievo netto {unitSuffix}</th>
          <th title="Prelievo netto come percentuale del patrimonio a inizio anno">Spesa %</th>
          <th>Rendimento {showDetailed ? unitSuffix : ''}</th>
          {#if hasPensionFund}
            <th>Fondo Pensione {unitSuffix}</th>
          {/if}
          {#if hasCashBuffer}
            <th title="Saldo di fine anno del Cuscinetto di Liquidità (compreso nel patrimonio fine anno)">
              Cash Buffer {unitSuffix}
            </th>
          {/if}
          <th>Patrimonio fine anno {unitSuffix}</th>
          {#if showDetailed}
            <th title="Prezzo Medio di Carico residuo esente da imposta sul capital gain">
              PMC residuo {unitSuffix}
            </th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each years as y, i}
          {@const latentGainPct =
            y.endPortfolio > 0
              ? Math.max(0, (y.endPortfolio - y.endCostBasis) / y.endPortfolio)
              : 0}
          {@const effectiveSaleTaxPct = y.grossSale > 0 ? y.taxPaid / y.grossSale : 0}
          <tr
            class:depleted={y.depleted}
            class:row-depletion={i === firstDepletionIndex}
            class:row-retirement-start={i === firstRetirementIndex}
          >
            <td>{y.age}</td>
            <td>{y.calendarYear}</td>
            <td>
              {y.phase === 'accumulation' ? 'Lavoro' : 'Non lavoro'}
              {#if i === firstRetirementIndex}
                <span class="phase-badge" title="Primo anno di ritiro (FIRE)">🔥</span>
              {/if}
            </td>
            {#if showDetailed}
              <td>{formatEur(y.startPortfolio)}</td>
            {/if}
            <td>{formatEur(y.income)}</td>
            <td>{formatEur(y.expenses)}</td>
            <td class:pos={y.contribution > 0}>
              {y.contribution > 0 ? `+${formatEur(y.contribution)}` : '—'}
            </td>
            {#if showDetailed}
              <td class:neg={y.grossSale > 0}>
                {y.grossSale > 0 ? `-${formatEur(y.grossSale)}` : '—'}
              </td>
            {/if}
            <td
              title={[
                y.stampDutyPaid && y.stampDutyPaid > 0
                  ? `di cui imposta di bollo: ${formatEur(y.stampDutyPaid)}`
                  : '',
                y.grossSale > 0 ? `incidenza su vendita lorda: ${formatPct(effectiveSaleTaxPct)}` : ''
              ]
                .filter(Boolean)
                .join(' · ') || undefined}
            >
              {#if y.taxPaid > 0}
                <span>{formatEur(y.taxPaid)}</span>
                {#if showDetailed && y.grossSale > 0}
                  <small class="sub-pct">({formatPct(effectiveSaleTaxPct)})</small>
                {/if}
              {:else}
                —
              {/if}
            </td>
            <td class:warn={y.expensesNotCovered}>
              {#if y.expensesNotCovered}
                <span
                  class="warn-icon"
                  title="Spese dell'anno non coperte interamente: prelievo limitato dal tetto o patrimonio esaurito"
                  >⚠</span
                >
              {/if}
              {y.withdrawal > 0 ? formatEur(y.withdrawal) : '—'}
            </td>
            <td>
              {y.withdrawal > 0 && y.startPortfolio > 0
                ? formatPct(y.withdrawal / y.startPortfolio)
                : '—'}
            </td>
            <td
              class:pos={showDetailed && y.investmentReturn > 0}
              class:neg={showDetailed && y.investmentReturn < 0}
              title={formatEur(y.investmentReturn)}
            >
              {#if showDetailed}
                <span>{formatEur(y.investmentReturn)}</span>
                <small class="sub-pct">({formatPct(y.returnRate)})</small>
              {:else}
                {formatPct(y.returnRate)}
              {/if}
            </td>
            {#if hasPensionFund}
              <td>{formatEur(y.pensionFundBalance ?? 0)}</td>
            {/if}
            {#if hasCashBuffer}
              <td
                title={[
                  y.bufferWithdrawal && y.bufferWithdrawal > 0
                    ? `prelievo da buffer: -${formatEur(y.bufferWithdrawal)}`
                    : '',
                  y.bufferRefill && y.bufferRefill > 0
                    ? `ricarica buffer: +${formatEur(y.bufferRefill)}`
                    : ''
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined}
              >
                <span>{formatEur(y.cashBufferEnd ?? 0)}</span>
                {#if showDetailed && y.bufferWithdrawal && y.bufferWithdrawal > 0}
                  <small class="sub-pct">(-{formatEur(y.bufferWithdrawal)})</small>
                {:else if showDetailed && y.bufferRefill && y.bufferRefill > 0}
                  <small class="sub-pct">(+{formatEur(y.bufferRefill)})</small>
                {/if}
              </td>
            {/if}
            <td>
              {formatEur(y.endPortfolio)}
              {#if i === firstDepletionIndex}
                <span class="depletion-badge">⚠ capitale esaurito</span>
              {:else if y.depleted}
                (esaurito)
              {/if}
            </td>
            {#if showDetailed}
              <td title="Plusvalenza latente: {formatPct(latentGainPct)}">
                <span>{formatEur(y.endCostBasis)}</span>
                {#if y.endPortfolio > 0}
                  <small class="sub-pct">(+{formatPct(latentGainPct)} CG)</small>
                {/if}
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
      {#if years.length > 0}
        <tfoot>
          <tr>
            <td colspan="3"><strong>Totale cumulato ({years.length} anni)</strong></td>
            {#if showDetailed}
              <td>—</td>
            {/if}
            <td><strong>{formatEur(totals.income)}</strong></td>
            <td><strong>{formatEur(totals.expenses)}</strong></td>
            <td><strong>{formatEur(totals.contribution)}</strong></td>
            {#if showDetailed}
              <td><strong>{formatEur(totals.grossSale)}</strong></td>
            {/if}
            <td><strong>{formatEur(totals.taxPaid)}</strong></td>
            <td><strong>{formatEur(totals.withdrawal)}</strong></td>
            <td>—</td>
            <td><strong>{formatEur(totals.investmentReturn)}</strong></td>
            {#if hasPensionFund}
              <td><strong>{formatEur(lastYear?.pensionFundBalance ?? 0)}</strong></td>
            {/if}
            {#if hasCashBuffer}
              <td><strong>{formatEur(lastYear?.cashBufferEnd ?? 0)}</strong></td>
            {/if}
            <td><strong>{formatEur(lastYear?.endPortfolio ?? 0)}</strong></td>
            {#if showDetailed}
              <td><strong>{formatEur(lastYear?.endCostBasis ?? 0)}</strong></td>
            {/if}
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>

  <p class="legend">
    <span class="warn-icon">⚠</span> Le spese dell'anno non sono state coperte interamente: il
    prelievo è stato limitato dal tetto o il patrimonio era esaurito.
  </p>
</section>

<style>
  .table-header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .table-header h2 {
    margin: 0;
  }
  .table-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  .percentile-selector {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid #c3d2e3;
    border-radius: 6px;
    overflow: hidden;
  }
  .percentile-selector button {
    border: none;
    border-radius: 0;
    background: #fff;
    color: #1a5fa8;
    padding: 0.3rem 0.65rem;
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
    border-right: 1px solid #e5ecf3;
  }
  .percentile-selector button:last-child {
    border-right: none;
  }
  .percentile-selector button.active {
    background: #1a5fa8;
    color: #fff;
  }
  .percentile-selector button.p10.active {
    background: #b3261e;
  }
  .percentile-selector button.p90.active {
    background: #137333;
  }
  .detail-toggle {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    font-size: 0.8rem;
    color: #444;
    cursor: pointer;
  }
  .detail-toggle input {
    margin: 0;
    padding: 0;
  }
  .table-wrapper {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.83rem;
  }
  th,
  td {
    padding: 0.3rem 0.5rem;
    text-align: right;
    border-bottom: 1px solid #e2e2e2;
    white-space: nowrap;
  }
  th:first-child,
  td:first-child,
  th:nth-child(2),
  td:nth-child(2),
  th:nth-child(3),
  td:nth-child(3) {
    text-align: left;
  }
  thead th {
    background: #f4f6f8;
  }
  tfoot td {
    background: #f8fafc;
    border-top: 2px solid #cbd5e1;
  }
  tr.depleted td {
    color: #b3261e;
  }
  tr.row-depletion td {
    background: #fce8e6;
    font-weight: 600;
  }
  tr.row-retirement-start td {
    border-top: 2px solid #d97706;
  }
  td.warn {
    background: #fef7e0;
  }
  td.pos {
    color: #137333;
  }
  td.neg {
    color: #b06000;
  }
  .sub-pct {
    display: inline-block;
    margin-left: 0.2rem;
    font-size: 0.72rem;
    color: #666;
  }
  .phase-badge {
    font-size: 0.75rem;
    margin-left: 0.2rem;
  }
  .depletion-badge {
    display: inline-block;
    margin-left: 0.3rem;
    font-size: 0.72rem;
    background: #b3261e;
    color: #fff;
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
  }
  .warn-icon {
    cursor: help;
  }
  .legend {
    font-size: 0.8rem;
    color: #666;
    margin: 0.5rem 0 0;
  }
</style>

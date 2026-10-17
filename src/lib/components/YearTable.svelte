<script lang="ts">
  import type { YearState } from '../engine/types'
  import { formatEur, formatPct } from '../format'

  let { years }: { years: YearState[] } = $props()
</script>

<section class="card">
  <h2>Scenario mediano anno per anno</h2>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Età</th>
          <th>Anno</th>
          <th>Fase</th>
          <th>Entrate</th>
          <th>Spese</th>
          <th>Versamento</th>
          <th>Prelievo netto</th>
          <th title="Prelievo netto come percentuale del patrimonio a inizio anno">Spesa %</th>
          <th>Rendimento</th>
          <th>Tasse</th>
          <th>Patrimonio fine anno</th>
        </tr>
      </thead>
      <tbody>
        {#each years as y}
          <tr class:depleted={y.depleted}>
            <td>{y.age}</td>
            <td>{y.calendarYear}</td>
            <td>{y.phase === 'accumulation' ? 'Lavoro' : 'Non lavoro'}</td>
            <td>{formatEur(y.income)}</td>
            <td>{formatEur(y.expenses)}</td>
            <td>{y.contribution > 0 ? formatEur(y.contribution) : '—'}</td>
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
            <td>{y.withdrawal > 0 && y.startPortfolio > 0 ? formatPct(y.withdrawal / y.startPortfolio) : '—'}</td>
            <td title={formatEur(y.investmentReturn)}>{formatPct(y.returnRate)}</td>
            <td>{y.taxPaid > 0 ? formatEur(y.taxPaid) : '—'}</td>
            <td>{formatEur(y.endPortfolio)}{y.depleted ? ' (esaurito)' : ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <p class="legend">
    <span class="warn-icon">⚠</span> Le spese dell'anno non sono state coperte interamente: il
    prelievo è stato limitato dal tetto o il patrimonio era esaurito.
  </p>
</section>

<style>
  .table-wrapper {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.85rem;
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
  tr.depleted td {
    color: #b3261e;
  }
  td.warn {
    background: #fef7e0;
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

<script lang="ts">
  import type { SimStats } from '../engine/stats'
  import { formatEur, formatPct } from '../format'

  let { stats }: { stats: SimStats } = $props()

  let survivalClass = $derived(
    stats.successRate >= 0.9 ? 'good' : stats.successRate >= 0.75 ? 'warn' : 'bad'
  )

  let coverageClass = $derived(
    stats.fullCoverageRate >= 0.9 ? 'good' : stats.fullCoverageRate >= 0.75 ? 'warn' : 'bad'
  )
</script>

<section class="card">
  <h2>Risultati ({stats.runs} simulazioni)</h2>

  <div class="kpi-grid">
    <div class="success-rate {survivalClass}">
      <span class="value">{formatPct(stats.successRate)}</span>
      <span class="label">
        <strong>Sopravvivenza patrimonio</strong>
        <small>Capitale &gt; 0 € a fine orizzonte</small>
      </span>
    </div>

    <div class="success-rate {coverageClass}">
      <span class="value">{formatPct(stats.fullCoverageRate)}</span>
      <span class="label">
        <strong>Piena copertura spese</strong>
        <small>Nessun taglio forzato ai prelievi</small>
      </span>
    </div>
  </div>

  <!-- Barra di ripartizione dei 3 regimi -->
  {#if stats.runs > 0}
    <div class="outcome-bar" role="img" aria-label="Ripartizione esiti simulazione">
      {#if stats.fullCoverageRate > 0}
        <div
          class="seg seg-full"
          style="width: {stats.fullCoverageRate * 100}%"
          title="Piena copertura: {formatPct(stats.fullCoverageRate)}"
        ></div>
      {/if}
      {#if stats.cutSpendingRate > 0}
        <div
          class="seg seg-cut"
          style="width: {stats.cutSpendingRate * 100}%"
          title="Salvo con tagli alle spese: {formatPct(stats.cutSpendingRate)}"
        ></div>
      {/if}
      {#if stats.depletionRate > 0}
        <div
          class="seg seg-depleted"
          style="width: {stats.depletionRate * 100}%"
          title="Patrimonio esaurito: {formatPct(stats.depletionRate)}"
        ></div>
      {/if}
    </div>

    <ul class="outcome-legend">
      <li><span class="dot full"></span> Piena copertura: <strong>{formatPct(stats.fullCoverageRate)}</strong></li>
      <li><span class="dot cut"></span> Salvo ma spese tagliate: <strong>{formatPct(stats.cutSpendingRate)}</strong></li>
      <li><span class="dot depleted"></span> Patrimonio esaurito: <strong>{formatPct(stats.depletionRate)}</strong></li>
    </ul>
  {/if}

  <dl class="percentiles">
    <div>
      <dt>p10 (scenario pessimista)</dt>
      <dd>{formatEur(stats.finalPercentiles.p10)}</dd>
    </div>
    <div>
      <dt>p50 (mediano)</dt>
      <dd>{formatEur(stats.finalPercentiles.p50)}</dd>
    </div>
    <div>
      <dt>p90 (scenario ottimista)</dt>
      <dd>{formatEur(stats.finalPercentiles.p90)}</dd>
    </div>
  </dl>

  <div class="diagnostics">
    <p>
      Età media di esaurimento patrimonio:
      <strong>
        {stats.meanDepletionAge !== null ? `${Math.round(stats.meanDepletionAge)} anni` : 'mai (in nessun run)'}
      </strong>
    </p>
    <p>
      Età media primo taglio spese:
      <strong>
        {stats.meanFirstShortfallAge !== null
          ? `${Math.round(stats.meanFirstShortfallAge)} anni (media ${stats.meanShortfallYears.toFixed(1)} anni scoperti)`
          : 'mai (100% spese coperte)'}
      </strong>
    </p>
  </div>
</section>

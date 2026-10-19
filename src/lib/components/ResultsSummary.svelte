<script lang="ts">
  import type { SimStats } from '../engine/stats'
  import { HISTORICAL_DATASET_LABELS } from '../engine/historicalData'
  import { formatEur, formatPct } from '../format'
  import { planStore } from '../stores/plan.svelte'

  let {
    stats,
    baselineStats = null
  }: {
    stats: SimStats
    baselineStats?: SimStats | null
  } = $props()

  let simulationLabel = $derived.by(() => {
    const mode = planStore.committedPlan.simulationMode
    if (!mode || mode.type === 'parametric') return 'Parametrica (Monte Carlo log-normale)'
    const dataset = HISTORICAL_DATASET_LABELS[mode.datasetId ?? 'usa']
    const alloc = Math.round((mode.stockAllocation ?? 1) * 100)
    if (mode.type === 'historicalRolling') {
      return `Storico rolling · ${dataset} · azionario ${alloc}%`
    }
    const variant = mode.stationary ? 'stazionario' : `blocchi ${mode.blockSize ?? 5} anni`
    return `Block bootstrap ${variant} · ${dataset} · azionario ${alloc}%`
  })

  let rateClass = $derived(
    stats.successRate >= 0.9 ? 'good' : stats.successRate >= 0.75 ? 'warn' : 'bad'
  )

  function deltaClass(diff: number, epsilon = 1e-4): 'pos' | 'neg' | 'neutral' {
    if (diff > epsilon) return 'pos'
    if (diff < -epsilon) return 'neg'
    return 'neutral'
  }

  function formatDeltaPp(current: number, baseline: number): string {
    const diffPp = (current - baseline) * 100
    const sign = diffPp > 0.05 ? '+' : ''
    return `${sign}${diffPp.toLocaleString('it-IT', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })} pp`
  }

  function formatDeltaEur(current: number, baseline: number): string {
    const diff = Math.round(current - baseline)
    const sign = diff > 0 ? '+' : ''
    return `${sign}${formatEur(diff)}`
  }

  function formatDeltaYears(current: number, baseline: number): string {
    const diff = Math.round(current - baseline)
    const sign = diff > 0 ? '+' : ''
    return `${sign}${diff} anni`
  }
</script>

<section class="card">
  <h2>Risultati ({stats.runs} simulazioni)</h2>
  <p class="derived">{simulationLabel}</p>

  <div class="success-rate {rateClass}">
    <span class="value">{formatPct(stats.successRate)}</span>
    {#if baselineStats}
      {@const diff = stats.successRate - baselineStats.successRate}
      <span class="delta {deltaClass(diff, 0.0005)}" title="Variazione rispetto allo Scenario Base">
        {formatDeltaPp(stats.successRate, baselineStats.successRate)}
      </span>
    {/if}
    <span class="label">tasso di successo (patrimonio non esaurito entro l'orizzonte)</span>
  </div>

  <dl class="percentiles">
    <div>
      <dt>p10 (scenario pessimista)</dt>
      <dd>
        {formatEur(stats.finalPercentiles.p10)}
        {#if baselineStats}
          {@const diff = stats.finalPercentiles.p10 - baselineStats.finalPercentiles.p10}
          <span class="delta {deltaClass(diff, 0.5)}" title="Variazione rispetto allo Scenario Base">
            {formatDeltaEur(stats.finalPercentiles.p10, baselineStats.finalPercentiles.p10)}
          </span>
        {/if}
      </dd>
    </div>
    <div>
      <dt>p50 (mediano)</dt>
      <dd>
        {formatEur(stats.finalPercentiles.p50)}
        {#if baselineStats}
          {@const diff = stats.finalPercentiles.p50 - baselineStats.finalPercentiles.p50}
          <span class="delta {deltaClass(diff, 0.5)}" title="Variazione rispetto allo Scenario Base">
            {formatDeltaEur(stats.finalPercentiles.p50, baselineStats.finalPercentiles.p50)}
          </span>
        {/if}
      </dd>
    </div>
    <div>
      <dt>p90 (scenario ottimista)</dt>
      <dd>
        {formatEur(stats.finalPercentiles.p90)}
        {#if baselineStats}
          {@const diff = stats.finalPercentiles.p90 - baselineStats.finalPercentiles.p90}
          <span class="delta {deltaClass(diff, 0.5)}" title="Variazione rispetto allo Scenario Base">
            {formatDeltaEur(stats.finalPercentiles.p90, baselineStats.finalPercentiles.p90)}
          </span>
        {/if}
      </dd>
    </div>
  </dl>
  <p class="derived value-mode-note">
    Patrimonio finale espresso in €
    {planStore.valueMode === 'real'
      ? `del ${planStore.committedPlan.startYear} (potere d'acquisto costante)`
      : 'nominali futuri'}
  </p>

  <p>
    Età media di esaurimento:
    <strong>
      {stats.meanDepletionAge !== null ? `${Math.round(stats.meanDepletionAge)} anni` : 'mai (in nessun run)'}
    </strong>
    {#if baselineStats && stats.meanDepletionAge !== null && baselineStats.meanDepletionAge !== null}
      {@const diff = Math.round(stats.meanDepletionAge) - Math.round(baselineStats.meanDepletionAge)}
      <span class="delta {deltaClass(diff, 0.5)}" title="Variazione rispetto allo Scenario Base">
        {formatDeltaYears(stats.meanDepletionAge, baselineStats.meanDepletionAge)}
      </span>
    {/if}
  </p>
</section>

<style>
  .delta {
    display: inline-block;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    vertical-align: middle;
    margin-left: 0.35rem;
  }

  .delta.pos {
    background: #dcfce7;
    color: #166534;
  }

  .delta.neg {
    background: #fee2e2;
    color: #991b1b;
  }

  .delta.neutral {
    background: #f3f4f6;
    color: #4b5563;
  }
</style>

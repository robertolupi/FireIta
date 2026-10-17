<script lang="ts">
  import type { SimStats } from '../engine/stats'
  import { formatEur, formatPct } from '../format'
  import { planStore } from '../stores/plan.svelte'

  let { stats }: { stats: SimStats } = $props()

  let rateClass = $derived(
    stats.successRate >= 0.9 ? 'good' : stats.successRate >= 0.75 ? 'warn' : 'bad'
  )
</script>

<section class="card">
  <h2>Risultati ({stats.runs} simulazioni)</h2>

  <div class="success-rate {rateClass}">
    <span class="value">{formatPct(stats.successRate)}</span>
    <span class="label">tasso di successo (patrimonio non esaurito entro l'orizzonte)</span>
  </div>

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
  <p class="derived value-mode-note">
    Patrimonio finale espresso in €
    {planStore.valueMode === 'real'
      ? `del ${planStore.plan.startYear} (potere d'acquisto costante)`
      : 'nominali futuri'}
  </p>

  <p>
    Età media di esaurimento:
    <strong>
      {stats.meanDepletionAge !== null ? `${Math.round(stats.meanDepletionAge)} anni` : 'mai (in nessun run)'}
    </strong>
  </p>
</section>

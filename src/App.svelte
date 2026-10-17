<script lang="ts">
  import { planStore } from './lib/stores/plan.svelte'
  import PlanForm from './lib/components/PlanForm.svelte'
  import EventsEditor from './lib/components/EventsEditor.svelte'
  import ResultsSummary from './lib/components/ResultsSummary.svelte'
  import FanChart from './lib/components/FanChart.svelte'
  import YearTable from './lib/components/YearTable.svelte'

  let stats = $derived(planStore.stats)
</script>

<main>
  <header>
    <h1>FireIta</h1>
    <p>Calcolatore FIRE (Financial Independence, Retire Early) con simulazione Monte Carlo e tassazione italiana sulle plusvalenze.</p>
  </header>

  <div class="layout">
    <div class="column">
      <PlanForm />
      <EventsEditor />
    </div>
    <div class="column wide">
      <ResultsSummary {stats} />
      <FanChart bands={stats.bands} />
      {#if stats.medianRun}
        <YearTable years={stats.medianRun.years} />
      {/if}
    </div>
  </div>
</main>

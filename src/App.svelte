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
      <div class="results-toolbar">
        <div class="value-mode-toggle" role="group" aria-label="Modalità valuta">
          <button
            type="button"
            class:active={planStore.valueMode === 'real'}
            onclick={() => (planStore.valueMode = 'real')}
            title="Importi scontati per l'inflazione al potere d'acquisto di {planStore.plan.startYear}"
          >
            Valori Reali (Oggi €)
          </button>
          <button
            type="button"
            class:active={planStore.valueMode === 'nominal'}
            onclick={() => (planStore.valueMode = 'nominal')}
            title="Importi futuri non scontati per l'inflazione"
          >
            Valori Nominali (Futuri €)
          </button>
        </div>
      </div>

      <ResultsSummary {stats} />
      <FanChart bands={stats.bands} plan={planStore.plan} valueMode={planStore.valueMode} />
      {#if stats.medianRun}
        <YearTable years={stats.medianRun.years} />
      {/if}
    </div>
  </div>
</main>

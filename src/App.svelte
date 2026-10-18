<script lang="ts">
  import { STORAGE_KEY } from './lib/persistence'
  import { planStore } from './lib/stores/plan.svelte'
  import ScenarioToolbar from './lib/components/ScenarioToolbar.svelte'
  import PlanForm from './lib/components/PlanForm.svelte'
  import EventsEditor from './lib/components/EventsEditor.svelte'
  import ResultsSummary from './lib/components/ResultsSummary.svelte'
  import FanChart from './lib/components/FanChart.svelte'
  import SensitivityMatrix from './lib/components/SensitivityMatrix.svelte'
  import YearTable from './lib/components/YearTable.svelte'

  let stats = $derived(planStore.stats)
  let baselineStats = $derived(planStore.baselineStats)

  $effect(() => {
    const snapshot = JSON.stringify(planStore.plan)
    planStore.notifyPlanChanged(snapshot)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, snapshot)
      } catch {
        // Ignora errori storage
      }
    }
  })
</script>

<main>
  <header>
    <h1>FireIta</h1>
    <p>Calcolatore FIRE (Financial Independence, Retire Early) con simulazione Monte Carlo e tassazione italiana sulle plusvalenze.</p>
  </header>

  <ScenarioToolbar />

  <div class="layout">
    <div class="column">
      <PlanForm />
      <EventsEditor />
    </div>
    <div class="column wide">
      <div class="results-toolbar">
        {#if planStore.isPending}
          <div class="pending-banner" role="status" aria-live="polite">
            <span>Modifiche in attesa — ricalcolo tra <strong>{planStore.remainingSeconds}s</strong>…</span>
            <button type="button" class="btn-recalc-now" onclick={() => planStore.commitNow()}>
              Ricalcola ora
            </button>
          </div>
        {/if}
        <div class="value-mode-toggle" role="group" aria-label="Modalità valuta">
          <button
            type="button"
            class:active={planStore.valueMode === 'real'}
            onclick={() => (planStore.valueMode = 'real')}
            title="Importi scontati per l'inflazione al potere d'acquisto di {planStore.committedPlan.startYear}"
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

      <div class="results-content" class:outdated={planStore.isPending} aria-busy={planStore.isPending}>
        <ResultsSummary {stats} {baselineStats} />
        <FanChart
          bands={stats.bands}
          baselineBands={baselineStats?.bands ?? null}
          plan={planStore.committedPlan}
          valueMode={planStore.valueMode}
        />
        <SensitivityMatrix />
        {#if stats.medianRun}
          <YearTable percentileRuns={stats.percentileRuns} years={stats.medianRun.years} />
        {/if}
      </div>
    </div>
  </div>
</main>

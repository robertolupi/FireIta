<script lang="ts">
  import { encodePlanToUrlParam, exportYearsToCsv } from '../persistence'
  import { planStore } from '../stores/plan.svelte'

  let fileInput = $state<HTMLInputElement | null>(null)
  let feedback = $state<string | null>(null)
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null

  function showFeedback(msg: string) {
    feedback = msg
    if (feedbackTimer) clearTimeout(feedbackTimer)
    feedbackTimer = setTimeout(() => {
      feedback = null
    }, 2500)
  }

  async function shareUrl() {
    if (typeof window === 'undefined') return
    const encoded = encodePlanToUrlParam(planStore.plan)
    const url = new URL(window.location.href)
    url.searchParams.set('plan', encoded)
    window.history.replaceState({}, '', url.toString())
    try {
      await navigator.clipboard.writeText(url.toString())
      showFeedback('Link copiato!')
    } catch {
      showFeedback('URL aggiornato nella barra degli indirizzi')
    }
  }

  function downloadBlob(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function exportJson() {
    const json = JSON.stringify(planStore.plan, null, 2)
    downloadBlob(json, 'fireita-piano.json', 'application/json;charset=utf-8')
    showFeedback('Piano JSON esportato')
  }

  function triggerImportJson() {
    fileInput?.click()
  }

  async function handleFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      planStore.replacePlan(parsed)
      showFeedback('Piano JSON importato')
    } catch {
      showFeedback('File JSON non valido')
    } finally {
      input.value = ''
    }
  }

  function exportCsv() {
    const medianRun = planStore.stats.medianRun
    if (!medianRun) return
    const csv = exportYearsToCsv(medianRun.years)
    downloadBlob(csv, 'fireita-proiezione-mediana.csv', 'text/csv;charset=utf-8')
    showFeedback('CSV esportato')
  }

  function handleReset() {
    planStore.resetToDefault()
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (url.searchParams.has('plan')) {
        url.searchParams.delete('plan')
        window.history.replaceState({}, '', url.toString())
      }
    }
    showFeedback('Valori predefiniti ripristinati')
  }
</script>

<section class="scenario-toolbar card" aria-label="Gestione scenari ed esportazione">
  <div class="toolbar-group baseline-group">
    {#if planStore.baselinePlan === null}
      <button type="button" class="btn-baseline" onclick={() => planStore.pinBaseline()}>
        Fissa come Scenario Base
      </button>
    {:else}
      <span class="baseline-badge">Scenario Base attivo</span>
      <button type="button" class="btn-secondary" onclick={() => planStore.pinBaseline()}>
        Aggiorna Base
      </button>
      <button type="button" class="btn-secondary" onclick={() => planStore.swapWithBaseline()}>
        Inverti A/B
      </button>
      <button type="button" class="remove" onclick={() => planStore.clearBaseline()}>
        Rimuovi Base
      </button>
    {/if}
  </div>

  <div class="toolbar-group actions-group">
    <button type="button" class="btn-secondary" onclick={shareUrl}>
      Condividi link
    </button>
    <button type="button" class="btn-secondary" onclick={exportJson}>
      Esporta JSON
    </button>
    <button type="button" class="btn-secondary" onclick={triggerImportJson}>
      Importa JSON
    </button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".json,application/json"
      class="hidden-file"
      onchange={handleFileChange}
    />
    <button
      type="button"
      class="btn-secondary"
      onclick={exportCsv}
      disabled={!planStore.stats.medianRun}
    >
      Esporta CSV (run mediano)
    </button>
    <button type="button" class="btn-secondary" onclick={handleReset}>
      Ripristina default
    </button>
    {#if feedback}
      <span class="toolbar-feedback" role="status">{feedback}</span>
    {/if}
  </div>
</section>

<style>
  .scenario-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    padding: 0.75rem 1rem;
  }

  .toolbar-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .btn-baseline {
    background: #d97706;
    color: #fff;
    font-weight: 600;
  }

  .btn-baseline:hover {
    background: #b45309;
  }

  .btn-secondary {
    background: #eef3f8;
    color: #1a5fa8;
    border: 1px solid #c3d2e3;
  }

  .btn-secondary:hover {
    background: #dce7f3;
  }

  .baseline-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #f59e0b;
    border-radius: 999px;
    padding: 0.25rem 0.65rem;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .hidden-file {
    display: none;
  }

  .toolbar-feedback {
    font-size: 0.8rem;
    font-weight: 600;
    color: #137333;
    background: #e6f4ea;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
  }
</style>

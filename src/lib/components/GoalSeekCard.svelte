<script lang="ts">
  import type { GoalSeekResult, GoalSeekTargetParam } from '../engine/goalSeek'
  import { formatEur, formatPct } from '../format'
  import { planStore } from '../stores/plan.svelte'

  let selectedParam = $state<GoalSeekTargetParam>('retirementAge')
  let targetRate = $state<number>(0.9)
  let isSolving = $state(false)
  let result = $state<GoalSeekResult | null>(null)
  let errorMsg = $state<string | null>(null)

  const paramOptions: { value: GoalSeekTargetParam; label: string; desc: string }[] = [
    {
      value: 'retirementAge',
      label: 'Età minima di pensionamento',
      desc: 'Trova il primo anno in cui puoi ritirarti raggiungendo il target.'
    },
    {
      value: 'annualExpenses',
      label: 'Spesa annua massima sostenibile',
      desc: 'Trova la spesa massima che mantiene il piano sicuro.'
    },
    {
      value: 'annualIncome',
      label: 'Reddito annuo minimo richiesto',
      desc: 'Trova quanto reddito serve per centrare l’obiettivo.'
    },
    {
      value: 'initialPortfolio',
      label: 'Patrimonio iniziale necessario',
      desc: 'Trova il capitale di partenza richiesto oggi.'
    }
  ]

  async function handleSolve() {
    isSolving = true
    errorMsg = null
    try {
      const res = await planStore.runGoalSeek(selectedParam, targetRate)
      result = res
    } catch (e: unknown) {
      errorMsg = e instanceof Error ? e.message : 'Errore durante la risoluzione del Goal Seek'
      result = null
    } finally {
      isSolving = false
    }
  }

  function applyResult() {
    if (!result) return
    if (result.param === 'retirementAge') {
      planStore.plan.retirementAge = result.optimalValue
    } else if (result.param === 'annualExpenses') {
      planStore.plan.annualExpenses = result.optimalValue
    } else if (result.param === 'annualIncome') {
      planStore.plan.annualIncome = result.optimalValue
    } else if (result.param === 'initialPortfolio') {
      planStore.plan.initialPortfolio = result.optimalValue
    }
    planStore.commitNow()
  }

  function formatOptimal(param: GoalSeekTargetParam, val: number): string {
    if (param === 'retirementAge') {
      return `${Math.round(val)} anni`
    }
    return formatEur(val)
  }
</script>

<section class="card goalseek-card">
  <div class="header">
    <div>
      <h2>Risolutore Inverso (Goal Seek)</h2>
      <p class="subtitle">
        Calcola automaticamente l’età minima di pensionamento, la spesa massima o il capitale necessario per raggiungere la probabilità di successo desiderata.
      </p>
    </div>
  </div>

  <div class="goalseek-controls">
    <div class="control-group">
      <label for="goalseek-param">Obiettivo da calcolare</label>
      <select id="goalseek-param" bind:value={selectedParam} onchange={() => (result = null)}>
        {#each paramOptions as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>

    <div class="control-group">
      <label for="goalseek-rate">Probabilità di successo target</label>
      <div class="rate-presets">
        {#each [0.8, 0.85, 0.9, 0.95] as r}
          <button
            type="button"
            class="preset-btn"
            class:active={targetRate === r}
            onclick={() => {
              targetRate = r
              result = null
            }}
          >
            {Math.round(r * 100)}%
          </button>
        {/each}
      </div>
    </div>

    <div class="action-col">
      <button
        type="button"
        class="btn-solve"
        disabled={isSolving}
        onclick={handleSolve}
      >
        {#if isSolving}
          <span>Risoluzione in corso…</span>
        {:else}
          <span>Risolvi con Web Worker</span>
        {/if}
      </button>
    </div>
  </div>

  {#if errorMsg}
    <div class="error-banner" role="alert">
      {errorMsg}
    </div>
  {/if}

  {#if result}
    <div class="result-box" class:converged={result.status === 'converged'} class:already={result.status === 'alreadyMet'} class:unreachable={result.status === 'unreachable'}>
      <div class="result-details">
        {#if result.status === 'converged'}
          <div class="status-badge success">Obiettivo Trovato</div>
          <div class="result-main">
            <span class="param-label">
              {paramOptions.find((p) => p.value === result?.param)?.label}:
            </span>
            <strong class="optimal-val">{formatOptimal(result.param, result.optimalValue)}</strong>
          </div>
          <div class="result-meta">
            Tasso di successo effettivo: <strong>{formatPct(result.achievedSuccessRate)}</strong> (target {Math.round(targetRate * 100)}%) · Trovato in {result.iterations} iterazioni
          </div>
        {:else if result.status === 'alreadyMet'}
          <div class="status-badge already">Già Soddisfatto</div>
          <div class="result-main">
            Il piano soddisfa già il target di successo del {Math.round(targetRate * 100)}% (tasso attuale: {formatPct(result.achievedSuccessRate)}) con il valore attuale ({formatOptimal(result.param, result.optimalValue)}).
          </div>
        {:else}
          <div class="status-badge warning">Non Raggiungibile</div>
          <div class="result-main">
            Impossibile raggiungere il target del {Math.round(targetRate * 100)}% entro l’intervallo analizzato (massimo tasso possibile: {formatPct(result.achievedSuccessRate)}). Prova a ridurre le spese o posticipare il pensionamento.
          </div>
        {/if}
      </div>

      {#if result.status === 'converged'}
        <button type="button" class="btn-apply" onclick={applyResult}>
          Applica al piano
        </button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .goalseek-card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .header h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  .subtitle {
    margin: 0.25rem 0 0;
    font-size: 0.85rem;
    color: #555;
  }

  .goalseek-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 1rem;
    padding: 0.75rem;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex: 1;
    min-width: 200px;
  }

  .control-group label {
    font-size: 0.8rem;
    font-weight: 600;
    color: #475569;
  }

  select {
    padding: 0.45rem 0.65rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 0.88rem;
    background: #fff;
    color: #1e293b;
  }

  .rate-presets {
    display: flex;
    gap: 0.35rem;
  }

  .preset-btn {
    flex: 1;
    padding: 0.4rem 0.6rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: #fff;
    color: #334155;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .preset-btn:hover {
    background: #f1f5f9;
  }

  .preset-btn.active {
    background: #1a5fa8;
    color: #fff;
    border-color: #1a5fa8;
  }

  .action-col {
    display: flex;
    align-items: flex-end;
  }

  .btn-solve {
    padding: 0.5rem 1.1rem;
    background: #0284c7;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.88rem;
    cursor: pointer;
    transition: background 0.15s ease;
    white-space: nowrap;
  }

  .btn-solve:hover:not(:disabled) {
    background: #0369a1;
  }

  .btn-solve:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error-banner {
    padding: 0.6rem 0.9rem;
    background: #fef2f2;
    border: 1px solid #f87171;
    color: #991b1b;
    border-radius: 6px;
    font-size: 0.85rem;
  }

  .result-box {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.9rem 1.1rem;
    border-radius: 8px;
    border: 1px solid;
  }

  .result-box.converged {
    background: #f0fdf4;
    border-color: #86efac;
  }

  .result-box.already {
    background: #f0f9ff;
    border-color: #7dd3fc;
  }

  .result-box.unreachable {
    background: #fffbeb;
    border-color: #fde68a;
  }

  .result-details {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .status-badge {
    align-self: flex-start;
    padding: 0.15rem 0.5rem;
    font-size: 0.72rem;
    font-weight: 700;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .status-badge.success {
    background: #dcfce7;
    color: #15803d;
  }

  .status-badge.already {
    background: #e0f2fe;
    color: #0369a1;
  }

  .status-badge.warning {
    background: #fef3c7;
    color: #b45309;
  }

  .result-main {
    font-size: 1rem;
    color: #1e293b;
  }

  .optimal-val {
    font-size: 1.25rem;
    color: #0f172a;
    font-weight: 700;
  }

  .result-meta {
    font-size: 0.8rem;
    color: #64748b;
  }

  .btn-apply {
    padding: 0.45rem 0.95rem;
    background: #16a34a;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-apply:hover {
    background: #15803d;
  }
</style>

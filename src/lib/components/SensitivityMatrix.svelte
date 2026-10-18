<script lang="ts">
  import { computeSensitivityGrid } from '../engine/sensitivity'
  import { formatEur, formatEurCompact, formatPct } from '../format'
  import { planStore } from '../stores/plan.svelte'

  let ageStep = $state(2)
  let expenseStep = $state(2500)
  let primaryMetric = $state<'successRate' | 'p50'>('successRate')

  let grid = $derived(
    computeSensitivityGrid(planStore.committedPlan, {
      ageStep,
      expenseStep,
      gridRuns: 400,
      valueMode: planStore.valueMode
    })
  )

  let stopWorkOverrideAge = $derived.by(() => {
    const swYears = planStore.committedPlan.events
      .filter((e): e is Extract<(typeof planStore.committedPlan.events)[number], { kind: 'stopWorking' }> => e.kind === 'stopWorking')
      .map((e) => e.atYear - planStore.committedPlan.birthYear)
    if (swYears.length === 0) return null
    return Math.min(...swYears)
  })

  function cellColorClass(rate: number): string {
    if (rate >= 0.9) return 'tier-good'
    if (rate >= 0.75) return 'tier-ok'
    if (rate >= 0.5) return 'tier-warn'
    return 'tier-bad'
  }

  function applyCell(retirementAge: number, annualExpenses: number) {
    planStore.plan.retirementAge = retirementAge
    planStore.plan.annualExpenses = annualExpenses
    planStore.commitNow()
  }
</script>

<section class="card">
  <div class="header">
    <div>
      <h2>Matrice di sensitività (Età ritiro × Spese annue)</h2>
      <p class="subtitle">
        Tasso di successo e patrimonio mediano finale ({grid.runsPerCell} run/cella,
        {planStore.valueMode === 'real'
          ? `€ reali ${planStore.committedPlan.startYear}`
          : '€ nominali'}). Clicca su una cella per applicarla al piano.
      </p>
    </div>

    <div class="controls">
      <label>
        Metrica primaria
        <select bind:value={primaryMetric}>
          <option value="successRate">Tasso di successo (%)</option>
          <option value="p50">Patrimonio mediano p50 (€)</option>
        </select>
      </label>
      <label>
        Passo età
        <select bind:value={ageStep}>
          <option value={1}>±1 anno</option>
          <option value={2}>±2 anni</option>
          <option value={3}>±3 anni</option>
        </select>
      </label>
      <label>
        Passo spese
        <select bind:value={expenseStep}>
          <option value={1000}>±1.000 €</option>
          <option value={2500}>±2.500 €</option>
          <option value={5000}>±5.000 €</option>
        </select>
      </label>
    </div>
  </div>

  <div class="matrix-wrapper">
    <table class="matrix" role="grid" aria-label="Matrice di sensitività Età ritiro per Spese annue">
      <thead>
        <tr>
          <th class="corner">Spese \ Età ritiro</th>
          {#each grid.retirementAges as age}
            <th class:current-axis={age === planStore.committedPlan.retirementAge}>
              {age} anni
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each grid.cells as row, rIdx}
          {@const expense = grid.expenseLevels[rIdx]}
          <tr>
            <th scope="row" class:current-axis={expense === planStore.committedPlan.annualExpenses}>
              {formatEur(expense)}/a
            </th>
            {#each row as cell}
              <td>
                <button
                  type="button"
                  class="cell-btn {cellColorClass(cell.successRate)}"
                  class:is-current={cell.isCurrent}
                  onclick={() => applyCell(cell.retirementAge, cell.annualExpenses)}
                  title="Ritiro a {cell.retirementAge} anni, spese {formatEur(cell.annualExpenses)}/anno — Tasso di successo: {formatPct(cell.successRate)}, Mediana finale (p50): {formatEur(cell.medianFinalPortfolio)}"
                >
                  {#if cell.isCurrent}
                    <span class="current-badge">Attuale</span>
                  {/if}
                  {#if primaryMetric === 'successRate'}
                    <span class="cell-primary">{formatPct(cell.successRate)}</span>
                    <span class="cell-secondary">p50: {formatEurCompact(cell.medianFinalPortfolio)}</span>
                  {:else}
                    <span class="cell-primary">{formatEurCompact(cell.medianFinalPortfolio)}</span>
                    <span class="cell-secondary">{formatPct(cell.successRate)}</span>
                  {/if}
                </button>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if stopWorkOverrideAge !== null && grid.retirementAges.some((a) => a > stopWorkOverrideAge)}
    <p class="derived stop-work-note">
      Nota: è attivo un evento "Smetti di lavorare" a {stopWorkOverrideAge} anni che anticipa il ritiro per le colonne con età superiore.
    </p>
  {/if}
</section>

<style>
  .header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .header h2 {
    margin: 0 0 0.2rem;
  }

  .subtitle {
    margin: 0;
    font-size: 0.82rem;
    color: #555;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: flex-end;
  }

  .controls label {
    margin-bottom: 0;
    font-size: 0.78rem;
    color: #444;
  }

  .controls select {
    padding: 0.25rem 0.45rem;
    font-size: 0.82rem;
  }

  .matrix-wrapper {
    overflow-x: auto;
  }

  .matrix {
    width: 100%;
    border-collapse: separate;
    border-spacing: 4px;
    font-size: 0.82rem;
  }

  .matrix th {
    padding: 0.35rem 0.5rem;
    font-weight: 600;
    color: #444;
    background: #f8fafc;
    border-radius: 4px;
    text-align: center;
    white-space: nowrap;
  }

  .matrix th.corner {
    text-align: left;
    font-size: 0.76rem;
    color: #666;
  }

  .matrix tbody th {
    text-align: right;
  }

  .matrix th.current-axis {
    background: #e8f0fe;
    color: #1a5fa8;
  }

  .matrix td {
    padding: 0;
  }

  .cell-btn {
    position: relative;
    width: 100%;
    min-width: 96px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    padding: 0.45rem 0.5rem;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: transform 0.08s ease, box-shadow 0.08s ease;
  }

  .cell-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  }

  .cell-btn.tier-good {
    background: #dcfce7;
    color: #14532d;
    border-color: #bbf7d0;
  }

  .cell-btn.tier-ok {
    background: #fef3c7;
    color: #78350f;
    border-color: #fde68a;
  }

  .cell-btn.tier-warn {
    background: #ffedd5;
    color: #7c2d12;
    border-color: #fed7aa;
  }

  .cell-btn.tier-bad {
    background: #fee2e2;
    color: #7f1d1d;
    border-color: #fecaca;
  }

  .cell-btn.is-current {
    outline: 2.5px solid #1a5fa8;
    outline-offset: 1px;
    font-weight: 700;
  }

  .current-badge {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: #1a5fa8;
    color: #fff;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    line-height: 1.2;
  }

  .cell-primary {
    font-size: 0.95rem;
    font-weight: 700;
  }

  .cell-secondary {
    font-size: 0.73rem;
    opacity: 0.88;
  }

  .stop-work-note {
    margin-top: 0.5rem;
  }
</style>

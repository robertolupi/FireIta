# 06 — Matrice di Sensitività (Heatmap Età di Ritiro vs. Spese Annue)

## 1. Obiettivo e Motivazione

Nella pianificazione FIRE, i parametri inseriti dall'utente contengono inevitabilmente incertezza, ma le due leve decisionali più importanti e direttamente controllabili sono:
1. **Quando smettere di lavorare** (`retirementAge`, in anni).
2. **Quanto spendere ogni anno** (`annualExpenses`, in €/anno).

Oggi l'utente esplora lo spazio delle soluzioni per tentativi ("trial-and-error"): modifica un numero nel form a sinistra, legge il nuovo tasso di successo a destra, poi prova un'altra combinazione. Questo approccio puntuale non permette di cogliere a colpo d'occhio:
- **La presenza di "cliff edges" (bordi di scogliera)**: situazioni in cui anticipare il ritiro di 1 solo anno o aumentare le spese di 2.000 €/anno fa crollare il tasso di successo dall'88% al 65%.
- **Il tasso di scambio (trade-off) tempo/denaro**: quanti anni di lavoro in più servono per sostenere 5.000 €/anno di spese extra mantenendo un tasso di successo $\ge 90\%$?
- **Il margine di sicurezza della propria posizione attuale** rispetto alle celle adiacenti.

L'introduzione di un componente **`SensitivityMatrix.svelte`** — una heatmap bidimensionale 5×5 centrata su `(plan.retirementAge, plan.annualExpenses)` — trasforma FireIta da semplice calcolatore puntuale a strumento di esplorazione strategica:
- Mostra in ogni cella il tasso di successo (e in tooltip il patrimonio mediano `p50` e il tasso di piena copertura spese).
- Evidenzia la cella corrispondente al piano corrente.
- Permette il **click-to-apply**: cliccando su qualsiasi cella della griglia, `plan.retirementAge` e `plan.annualExpenses` si aggiornano istantaneamente a quella combinazione.

---

## 2. Valutazione della Complessità

- **Stima effort**: **Media** (~4–6 ore di sviluppo + test).
- **Impatto architetturale**: Basso e ben isolato. Richiede una funzione pura di calcolo della griglia (`src/lib/engine/sensitivity.ts`) e un nuovo componente di visualizzazione (`src/lib/components/SensitivityMatrix.svelte`) montato nella colonna destra di `src/App.svelte`.
- **File coinvolti**:
  - `src/lib/engine/sensitivity.ts` *(nuovo)* — generazione degli assi centrati sul piano corrente ed esecuzione ottimizzata della griglia Monte Carlo.
  - `src/lib/components/SensitivityMatrix.svelte` *(nuovo)* — rendering della heatmap interattiva con controlli di passo ($\Delta$ età, $\Delta$ spese), selettore metrica e interazione click-to-apply.
  - `src/App.svelte` — inserimento del componente `<SensitivityMatrix />` sotto `<FanChart />`.
  - `src/lib/engine/__tests__/sensitivity.test.ts` *(nuovo)* — unit test su generazione assi, vincoli di età/spese, determinismo e monotonicità.
- **Rischi ed Edge Cases**:
  - **Budget computazionale e reattività UI**: una griglia 5×5 contiene 25 celle. Se l'utente ha impostato `plan.runs = 5_000`, ricalcolare $25 \times 5.000 = 125.000$ proiezioni complete ad ogni pressione di tasto in un `<input>` del form bloccherebbe il main thread per centinaia di millisecondi.
    - *Mitigazione 1 (Campionamento dedicato per la griglia)*: per le 24 celle diverse dal centro, usare un numero di run calibrato per la heatmap (es. `gridRuns = Math.min(plan.runs, 400)`), mentre per la cella centrale `(currentAgeIndex, currentExpenseIndex)` riutilizzare direttamente `planStore.stats` già calcolato a piena risoluzione (`plan.runs`), oppure usare `gridRuns` uniforme con debounce.
    - *Mitigazione 2 (Pre-generazione della matrice dei rendimenti casuali)*: poiché tutte le 25 celle condividono lo stesso `seed`, `horizon`, `meanReturn` e `returnStdDev`, le sequenze di rendimenti casuali `returns[run][year]` possono essere generate **una sola volta** per l'intera griglia e passate a `runProjection()`, risparmiando il 100% delle chiamate a `sampleAnnualReturn` / `Math.log` / `Math.cos` nelle 24 celle aggiuntive e garantendo un confronto **Common Random Numbers (CRN)** privo di rumore stocastico tra celle adiacenti!
  - **Vincoli sugli estremi degli assi**:
    - `retirementAge` nella griglia non deve mai scendere sotto l'età corrente (`currentAge(plan)`) né superare `plan.lifeExpectancyAge - 1`.
    - `annualExpenses` non deve mai scendere sotto un valore minimo sensato (es. `1_000 €`).
  - **Interazione con eventi `stopWorking` e `setExpenses`**:
    - Se il piano contiene un evento `stopWorking` con anno antecedente a `retirementAge`, `effectiveStopYear(plan)` usa il minimo tra i due: nella cella della heatmap è opportuno mostrare un avviso se un evento `stopWorking` fisso sovrascrive le età di ritiro esplorate.

---

## 3. Design Tecnico e Modifiche ai Dati/Componenti

### 3.1 Motore della Griglia di Sensitività (`src/lib/engine/sensitivity.ts`)

Sfruttando la tecnica **Common Random Numbers (CRN)**, pre-calcoliamo le traiettorie di rendimento `returnMatrix: number[][]` una sola volta per tutte le celle della griglia. Questo riduce il tempo di calcolo di ~40% ed elimina la varianza di campionamento tra celle vicine:

```ts
import type { Plan } from './types'
import { currentAge, horizonYears, runProjection } from './projection'
import { mulberry32, sampleAnnualReturn } from './montecarlo'
import { percentile } from './stats'

export interface SensitivityCell {
  retirementAge: number
  annualExpenses: number
  isCurrent: boolean
  successRate: number
  fullCoverageRate: number
  medianFinalPortfolio: number
}

export interface SensitivityGrid {
  retirementAges: number[]
  expenseLevels: number[]
  cells: SensitivityCell[][] // [rowIndex (expense)][colIndex (age)]
  runsPerCell: number
}

export interface SensitivityOptions {
  ageStep?: number       // default: 2 anni (es. -4, -2, 0, +2, +4)
  expenseStep?: number   // default: 2_500 € (es. -5k, -2.5k, 0, +2.5k, +5k)
  gridRuns?: number      // default: 400
}

export function buildAxis(center: number, step: number, count: number, min: number, max: number): number[] {
  const half = Math.floor(count / 2)
  const raw: number[] = []
  for (let i = -half; i <= half; i++) {
    raw.push(Math.min(max, Math.max(min, center + i * step)))
  }
  // Rimuove eventuali duplicati ai bordi mantenendo l'ordine crescente
  return Array.from(new Set(raw)).sort((a, b) => a - b)
}

export function computeSensitivityGrid(
  plan: Plan,
  options: SensitivityOptions = {}
): SensitivityGrid {
  const ageStep = options.ageStep ?? 2
  const expenseStep = options.expenseStep ?? 2_500
  const runsPerCell = Math.max(50, Math.min(plan.runs, options.gridRuns ?? 400))

  const minAge = Math.max(18, currentAge(plan))
  const maxAge = Math.max(minAge, plan.lifeExpectancyAge - 1)

  const retirementAges = buildAxis(plan.retirementAge, ageStep, 5, minAge, maxAge)
  const expenseLevels = buildAxis(plan.annualExpenses, expenseStep, 5, 1_000, 1_000_000)

  // Pre-genera le traiettorie di rendimento comuni (Common Random Numbers)
  const rng = mulberry32(plan.seed)
  const horizon = horizonYears(plan)
  const returnMatrix: number[][] = Array.from({ length: runsPerCell }, () =>
    Array.from({ length: horizon }, () =>
      sampleAnnualReturn(rng, plan.meanReturn, plan.returnStdDev)
    )
  )

  const cells: SensitivityCell[][] = expenseLevels.map((annualExpenses) =>
    retirementAges.map((retirementAge) => {
      const cellPlan: Plan = {
        ...plan,
        retirementAge,
        annualExpenses
      }

      let survivedCount = 0
      let fullCoverageCount = 0
      const finals: number[] = []

      for (let r = 0; r < runsPerCell; r++) {
        const years = runProjection(cellPlan, returnMatrix[r])
        const depleted = years.some((y) => y.depleted)
        const shortfall = years.some((y) => y.expensesNotCovered)
        if (!depleted) survivedCount++
        if (!depleted && !shortfall) fullCoverageCount++
        finals.push(years.length > 0 ? years[years.length - 1].endPortfolio : cellPlan.initialPortfolio)
      }

      finals.sort((a, b) => a - b)

      return {
        retirementAge,
        annualExpenses,
        isCurrent:
          retirementAge === plan.retirementAge && annualExpenses === plan.annualExpenses,
        successRate: survivedCount / runsPerCell,
        fullCoverageRate: fullCoverageCount / runsPerCell,
        medianFinalPortfolio: percentile(finals, 50)
      }
    })
  )

  return {
    retirementAges,
    expenseLevels,
    cells,
    runsPerCell
  }
}
```

### 3.2 Componente `src/lib/components/SensitivityMatrix.svelte`

Il componente offre:
- Controlli compatti per regolare il passo degli assi ($\Delta$ Età: `1 / 2 / 3 anni`, $\Delta$ Spese: `1.000 € / 2.500 € / 5.000 €`).
- Tabella accessibile (`role="grid"`) con righe corrispondenti ai livelli di spesa annua e colonne corrispondenti alle età di pensionamento.
- Colorazione continua o a fasce semantiche:
  - $\ge 90\%$: verde (`#dcfce7` / testo `#14532d`)
  - $75\% - 89\%$: giallo/ambra (`#fef3c7` / testo `#78350f`)
  - $50\% - 74\%$: arancione (`#ffedd5` / testo `#7c2d12`)
  - $< 50\%$: rosso (`#fee2e2` / testo `#7f1d1d`)
- Bordo marcato (`outline: 2px solid #1a5fa8`) sulla cella `cell.isCurrent` con badge `"Attuale"`.
- Click su una cella: aggiorna `planStore.plan.retirementAge` e `planStore.plan.annualExpenses`.

```svelte
<script lang="ts">
  import { planStore } from '../stores/plan.svelte'
  import { computeSensitivityGrid } from '../engine/sensitivity'
  import { formatEur, formatEurCompact, formatPct } from '../format'

  let ageStep = $state(2)
  let expenseStep = $state(2500)

  let grid = $derived(
    computeSensitivityGrid(planStore.plan, {
      ageStep,
      expenseStep,
      gridRuns: 400
    })
  )

  function cellColorClass(rate: number): string {
    if (rate >= 0.9) return 'tier-good'
    if (rate >= 0.75) return 'tier-ok'
    if (rate >= 0.5) return 'tier-warn'
    return 'tier-bad'
  }

  function applyCell(retirementAge: number, annualExpenses: number) {
    planStore.plan.retirementAge = retirementAge
    planStore.plan.annualExpenses = annualExpenses
  }
</script>

<section class="card">
  <div class="header">
    <div>
      <h2>Matrice di sensitività (Età ritiro × Spese annue)</h2>
      <p class="subtitle">
        Tasso di successo e patrimonio mediano finale ({grid.runsPerCell} run/cella). Clicca su una cella per applicarla al piano.
      </p>
    </div>

    <div class="controls">
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
    <table class="matrix">
      <thead>
        <tr>
          <th class="corner">Spese \ Età ritiro</th>
          {#each grid.retirementAges as age}
            <th class:current-axis={age === planStore.plan.retirementAge}>
              {age} anni
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each grid.cells as row, rIdx}
          {@const expense = grid.expenseLevels[rIdx]}
          <tr>
            <th scope="row" class:current-axis={expense === planStore.plan.annualExpenses}>
              {formatEur(expense)}/a
            </th>
            {#each row as cell}
              <td>
                <button
                  type="button"
                  class="cell-btn {cellColorClass(cell.successRate)}"
                  class:is-current={cell.isCurrent}
                  onclick={() => applyCell(cell.retirementAge, cell.annualExpenses)}
                  title="Ritiro a {cell.retirementAge} anni, spese {formatEur(cell.annualExpenses)}/anno — Piena copertura: {formatPct(cell.fullCoverageRate)}, Mediana finale: {formatEur(cell.medianFinalPortfolio)}"
                >
                  <span class="cell-rate">{formatPct(cell.successRate)}</span>
                  <span class="cell-p50">p50: {formatEurCompact(cell.medianFinalPortfolio)}</span>
                </button>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
```

---

## 4. Step di Implementazione

1. **Creare `src/lib/engine/sensitivity.ts`**:
   - Implementare `buildAxis()` con clamping ai limiti validi e deduplicazione.
   - Implementare `computeSensitivityGrid()` con pre-generazione della matrice di rendimenti (`returnMatrix`) tramite `mulberry32(plan.seed)` e `sampleAnnualReturn`.
2. **Creare `src/lib/components/SensitivityMatrix.svelte`**:
   - Costruire la tabella reattiva 5×5 con selettori per `ageStep` e `expenseStep`.
   - Stilizzare le 4 fasce cromatiche (`.tier-good`, `.tier-ok`, `.tier-warn`, `.tier-bad`) e l'evidenziazione `.is-current`.
   - Implementare il gestore `applyCell(retirementAge, annualExpenses)` sul click di ogni cella.
3. **Integrare in `src/App.svelte`**:
   - Importare `SensitivityMatrix` e posizionarlo nella `.column.wide` subito dopo `<FanChart bands={stats.bands} />`.
4. **Ottimizzazione opzionale di fluidità**:
   - Verificare che il tempo di esecuzione di `computeSensitivityGrid` con `gridRuns = 400` sia inferiore a `25 ms` (su hardware standard ~10.000 proiezioni di 50 anni in JS puro impiegano ~12–18 ms).

---

## 5. Piano di Test e Verifica

### 5.1 Unit Test (Vitest)
Creare `src/lib/engine/__tests__/sensitivity.test.ts`:
1. **Generazione assi e clamping (`buildAxis`)**:
   - Verificare che `buildAxis(67, 2, 5, 49, 94)` produca `[63, 65, 67, 69, 71]`.
   - Verificare che quando `center` è vicino al minimo (es. `center = 50, min = 49, step = 2`), gli elementi non scendano mai sotto `49` e non ci siano valori duplicati.
2. **Identificazione cella corrente (`isCurrent`)**:
   - Verificare che nella griglia generata da `computeSensitivityGrid(plan)` esista esattamente una cella con `isCurrent === true` e che abbia `retirementAge === plan.retirementAge` e `annualExpenses === plan.annualExpenses`.
3. **Monotonicità economica (grazie a Common Random Numbers)**:
   - A parità di riga (`annualExpenses` fisso), verificare che per ogni colonna $c < c+1$ (cioè ritirandosi più tardi, con `annualIncome >= annualExpenses`), valga:
     - `cell[r][c].successRate <= cell[r][c+1].successRate`
     - `cell[r][c].medianFinalPortfolio <= cell[r][c+1].medianFinalPortfolio`
   - A parità di colonna (`retirementAge` fisso), verificare che per ogni riga $r < r+1$ (cioè spendendo di più ogni anno), valga:
     - `cell[r][c].successRate >= cell[r+1][c].successRate`
     - `cell[r][c].medianFinalPortfolio >= cell[r+1][c].medianFinalPortfolio`

### 5.2 Test Manuali UI
1. Avviare `npm run dev` e verificare che la card **Matrice di sensitività** compaia sotto il Fan Chart con 5 righe e 5 colonne e la cella centrale evidenziata.
2. Osservare il gradiente diagonale: le celle in alto a destra (spese più basse, pensionamento più tardivo) devono apparire più verdi e con `p50` maggiore rispetto alle celle in basso a sinistra.
3. Cliccare sulla cella in alto a sinistra (`retirementAge - 4`, `annualExpenses - 5.000 €`):
   - Verificare che i campi nel form a sinistra si aggiornino ai nuovi valori.
   - Verificare che la griglia si ricentri automaticamente attorno alla nuova combinazione scelta.
4. Cambiare i selettori **Passo età** (`±1 anno`, `±3 anni`) e **Passo spese** (`±1.000 €`, `±5.000 €`) e verificare l'aggiornamento immediato delle intestazioni di riga e colonna.

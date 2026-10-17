# 04 — Distinzione tra "Patrimonio Esaurito" e "Spese Tagliate" nei KPI di Successo

## 1. Obiettivo e Motivazione

Nel motore di proiezione di FireIta (`src/lib/engine/projection.ts`), ogni singolo anno simulato (`YearState`) traccia due condizioni di criticità distinte:
- `depleted: boolean` — il patrimonio è sceso a zero (`portfolio <= 1e-9`) e non sono più possibili prelievi.
- `expensesNotCovered: boolean` — il prelievo netto ottenuto in quell'anno (`obtained`) è risultato inferiore al fabbisogno reale (`expenses + oneTimeExpenses`), con una tolleranza numerica di `1e-9`.

Tuttavia, nell'attuale aggregazione Monte Carlo (`src/lib/engine/montecarlo.ts` e `src/lib/engine/stats.ts`), il successo di una simulazione (`SimResult.success`) è definito esclusivamente come `!depletedState` (`depletionYear === null`). Di conseguenza, `ResultsSummary.svelte` mostra un unico indicatore: *"tasso di successo (patrimonio non esaurito entro l'orizzonte)"*.

Questa semplificazione produce un'illusione pericolosa con entrambe le strategie di prelievo supportate:
1. **`percentCap` (es. cap al 4% del portafoglio al pensionamento rivalutato all'inflazione)**: se il mercato subisce un crollo negli anni immediatamente precedenti al ritiro (`startPortfolio` basso all'anno `stop`), oppure se l'utente ha impostato spese annue superiori al cap (`needed > cap`), il motore vende al massimo `Math.min(needed, cap)`. Il patrimonio può sopravvivere fino a 95 anni (`depleted === false`), ma il pensionato subisce un taglio forzato e permanente dello stile di vita (`expensesNotCovered === true`).
2. **`guardrails` (Guyton-Klinger)**: durante mercati ribassisti prolungati, l'attivazione ripetuta della soglia superiore (`effectiveRate > upperGuardrail`) riduce `currentWithdrawal` del `decreasePct` anno dopo anno. Proprio perché i guardrails tagliano i prelievi per proteggere il capitale, il portafoglio quasi mai si azzera (`successRate` prossimo al 95–100%), nascondendo all'utente che in una frazione significativa dei run il prelievo reale è sceso sotto il livello delle spese pianificate (`expenses`).

Separare e rendere visibili nei KPI tre regimi mutualmente esclusivi o complementari — **Piena copertura delle spese**, **Sopravvivenza del capitale ma con tagli alle spese (underfunded)**, e **Patrimonio esaurito (depletion)** — rende trasparente il vero trade-off delle regole di prelievo flessibili e migliora drasticamente la qualità decisionale della pianificazione FIRE.

---

## 2. Valutazione della Complessità

- **Stima effort**: **Bassa** (~2–4 ore di sviluppo + test).
- **Impatto architetturale**: Locale e retrocompatibile. Tutta l'informazione granulare anno per anno (`YearState.expensesNotCovered` e `YearState.expenses - YearState.withdrawal`) è già calcolata da `runProjection()`. Si tratta di esporre le metriche aggregate in `SimResult` e `SimStats` e aggiornare la card `ResultsSummary.svelte`.
- **File coinvolti**:
  - `src/lib/engine/types.ts` — estensione dell'interfaccia `SimResult` con metriche di scoperta spese.
  - `src/lib/engine/montecarlo.ts` — popolamento dei nuovi campi di `SimResult` in `runMonteCarlo()`.
  - `src/lib/engine/stats.ts` — estensione di `SimStats` e calcolo dei nuovi KPI in `computeStats()`.
  - `src/lib/components/ResultsSummary.svelte` — visualizzazione del doppio KPI, barra di ripartizione a 3 stati e metriche di severità dei tagli.
  - `src/lib/engine/__tests__/stats.test.ts` (e/o `montecarlo.test.ts`) — unit test sui nuovi invarianti matematici.
- **Rischi ed Edge Cases**:
  - **Sovrapposizione tra `depleted` e `expensesNotCovered`**: quando un portafoglio si esaurisce (`depleted: true`), negli anni di esaurimento e successivi `expensesNotCovered` è necessariamente `true`. Bisogna distinguere chiaramente:
    - *Tasso di sopravvivenza del patrimonio* (`portfolioSurvivalRate`, attuale `successRate`): quota di run con `depletionYear === null`.
    - *Tasso di piena copertura spese* (`fullCoverageRate`): quota di run con `depletionYear === null` **e** nessun anno con `expensesNotCovered === true`.
    - *Tasso di sopravvivenza con tagli* (`cutSpendingSurvivalRate`): quota di run in cui il patrimonio **non** si esaurisce (`depletionYear === null`), ma almeno un anno presenta `expensesNotCovered === true`. Vale sempre l'identità:
      $$\text{portfolioSurvivalRate} = \text{fullCoverageRate} + \text{cutSpendingSurvivalRate}$$
  - **Spese non coperte in fase di accumulo (`phase === 'accumulation'`)**: se prima del pensionamento `annualIncome < annualExpenses` o si verifica una `oneTimeExpense` superiore alla liquidità del portafoglio, `expensesNotCovered` può attivarsi già in accumulo. Il conteggio deve considerare l'intero orizzonte ma è utile tracciare il primo anno di scoperto (`firstShortfallYear`).
  - **Tolleranza floating-point**: `projection.ts` utilizza già una soglia `1e-9` per settare `expensesNotCovered`. Nel calcolo dell'ammontare e della percentuale di taglio massimo conviene riutilizzare la stessa soglia per evitare falsi positivi dovuti ad arrotondamenti IEEE 754.

---

## 3. Design Tecnico e Modifiche ai Dati/Componenti

### 3.1 Estensione di `SimResult` in `src/lib/engine/types.ts`

Ogni run della simulazione Monte Carlo arricchisce il proprio riepilogo con i dati relativi alla copertura delle spese:

```ts
export interface SimResult {
  run: number
  years: YearState[]
  finalPortfolio: number
  depletionYear: number | null
  /** true se il patrimonio non si è mai esaurito (depletionYear === null) */
  success: boolean
  /** Primo anno (indice 0-based) in cui expensesNotCovered === true, o null */
  firstShortfallYear: number | null
  /** Numero totale di anni nell'orizzonte con expensesNotCovered === true */
  shortfallYearsCount: number
  /** true se il patrimonio sopravvive E tutte le spese sono sempre state coperte */
  fullCoverage: boolean
}
```

### 3.2 Aggiornamento di `runMonteCarlo` in `src/lib/engine/montecarlo.ts`

```ts
export function runMonteCarlo(plan: Plan): SimResult[] {
  const rng = mulberry32(plan.seed)
  const horizon = horizonYears(plan)
  const results: SimResult[] = []

  for (let run = 0; run < Math.max(0, plan.runs); run++) {
    const returns = Array.from({ length: horizon }, () =>
      sampleAnnualReturn(rng, plan.meanReturn, plan.returnStdDev)
    )
    const years = runProjection(plan, returns)
    const depletedState = years.find((y) => y.depleted)
    const firstShortfallState = years.find((y) => y.expensesNotCovered)
    const shortfallYearsCount = years.filter((y) => y.expensesNotCovered).length
    const survived = !depletedState

    results.push({
      run,
      years,
      finalPortfolio: years.length > 0 ? years[years.length - 1].endPortfolio : plan.initialPortfolio,
      depletionYear: depletedState ? depletedState.year : null,
      success: survived,
      firstShortfallYear: firstShortfallState ? firstShortfallState.year : null,
      shortfallYearsCount,
      fullCoverage: survived && !firstShortfallState
    })
  }

  return results
}
```

### 3.3 Estensione di `SimStats` e `computeStats` in `src/lib/engine/stats.ts`

Oltre alle frequenze dei tre esiti, calcoliamo:
- `meanFirstShortfallAge`: età media in cui inizia il primo taglio alle spese (sui run che subiscono tagli o esaurimento).
- `meanShortfallYears`: numero medio di anni con spese non coperte (calcolato sui soli run con `shortfallYearsCount > 0`).

```ts
export interface SimStats {
  runs: number
  /** Quota di run in cui il patrimonio non si esaurisce (depletionYear === null) */
  successRate: number
  /** Quota di run con patrimonio integro E 100% delle spese coperte in ogni anno */
  fullCoverageRate: number
  /** Quota di run con patrimonio non esaurito ma con almeno 1 anno di spese tagliate */
  cutSpendingRate: number
  /** Quota di run con patrimonio esaurito prima della fine dell'orizzonte */
  depletionRate: number
  finalPercentiles: { p10: number; p25: number; p50: number; p75: number; p90: number }
  meanDepletionAge: number | null
  meanFirstShortfallAge: number | null
  meanShortfallYears: number
  bands: YearBand[]
  medianRun: SimResult | null
}
```

Implementazione in `computeStats(results: SimResult[]): SimStats`:

```ts
const successes = results.filter((r) => r.success).length
const fullCoverages = results.filter((r) => r.fullCoverage).length
const cutSpendingRuns = results.filter((r) => r.success && !r.fullCoverage).length
const depletedRuns = results.length - successes

const shortfallRuns = results.filter((r) => r.firstShortfallYear !== null)
const firstShortfallAges = shortfallRuns.map(
  (r) => r.years[r.firstShortfallYear as number].age
)
const meanFirstShortfallAge =
  firstShortfallAges.length > 0
    ? firstShortfallAges.reduce((sum, a) => sum + a, 0) / firstShortfallAges.length
    : null

const meanShortfallYears =
  shortfallRuns.length > 0
    ? shortfallRuns.reduce((sum, r) => sum + r.shortfallYearsCount, 0) / shortfallRuns.length
    : 0
```

### 3.4 Redesign di `src/lib/components/ResultsSummary.svelte`

Il componente `ResultsSummary.svelte` viene aggiornato per mostrare due KPI affiancati, una barra di composizione a 3 segmenti (Copertura piena / Spese ridotte / Patrimonio esaurito) e i dettagli diagnostici:

```svelte
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
```

---

## 4. Step di Implementazione

1. **Aggiornare i tipi (`src/lib/engine/types.ts`)**:
   - Aggiungere `firstShortfallYear: number | null`, `shortfallYearsCount: number` e `fullCoverage: boolean` all'interfaccia `SimResult`.
2. **Arricchire `runMonteCarlo` (`src/lib/engine/montecarlo.ts`)**:
   - Per ogni run, individuare `years.find((y) => y.expensesNotCovered)` e contare gli anni con `expensesNotCovered === true`.
   - Impostare `fullCoverage: !depletedState && !firstShortfallState`.
3. **Estendere `SimStats` e `computeStats` (`src/lib/engine/stats.ts`)**:
   - Aggiungere `fullCoverageRate`, `cutSpendingRate`, `depletionRate`, `meanFirstShortfallAge`, `meanShortfallYears` a `SimStats` (incluso il caso limite `results.length === 0`).
   - Calcolare le nuove statistiche mantenendo `successRate` invariato per piena retrocompatibilità.
4. **Aggiornare la UI (`src/lib/components/ResultsSummary.svelte`)**:
   - Sostituire il singolo blocco `.success-rate` con la griglia a 2 KPI (`Sopravvivenza patrimonio` e `Piena copertura spese`).
   - Inserire la barra `.outcome-bar` a 3 colori (verde `#1b7f3b`, ambra `#d97706`, rosso `#b91c1c`) e la relativa legenda.
   - Aggiungere la riga diagnostica sull'età media del primo taglio spese e la durata media dello scoperto.
5. **Verificare gli stili globali/locali**:
   - Assicurarsi che `.kpi-grid` utilizzi `display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;` per adattarsi sia a desktop sia a schermi mobili.

---

## 5. Piano di Test e Verifica

### 5.1 Unit Test (Vitest)
In `src/lib/engine/__tests__/stats.test.ts` e `montecarlo.test.ts`:
1. **Invariante di partizione**: verificare che per qualsiasi piano simulato valga:
   `expect(stats.fullCoverageRate + stats.cutSpendingRate).toBeCloseTo(stats.successRate, 10)`
   e `expect(stats.successRate + stats.depletionRate).toBeCloseTo(1, 10)`.
2. **Scenario `percentCap` con cap inferiore alle spese fisse**:
   - Configurare un piano deterministico (`returnStdDev: 0`, `meanReturn: 0.05`, `initialPortfolio: 500_000`, `annualExpenses: 30_000`, `withdrawalStrategy: { type: 'percentCap', rate: 0.03 }`).
   - Il cap iniziale è `15_000 € < 30_000 €`: il portafoglio cresce e non si esaurisce mai (`stats.successRate === 1`), ma le spese non sono mai coperte in pensione (`stats.fullCoverageRate === 0`, `stats.cutSpendingRate === 1`).
3. **Scenario `guardrails` sotto stress**:
   - Configurare un piano con `withdrawalStrategy: { type: 'guardrails', initialRate: 0.05, lowerGuardrail: 0.04, upperGuardrail: 0.06, increasePct: 0.1, decreasePct: 0.1 }` e volatilità `returnStdDev: 0.18`.
   - Verificare che `stats.successRate > stats.fullCoverageRate` e che `stats.meanFirstShortfallAge` sia un numero valido compreso tra l'età di ritiro e `lifeExpectancyAge`.
4. **Array vuoto (`computeStats([])`)**:
   - Verificare che `fullCoverageRate`, `cutSpendingRate`, `depletionRate` e `meanShortfallYears` siano `0` e `meanFirstShortfallAge` sia `null`.

### 5.2 Test Manuali UI
1. Avviare `npm run dev` e impostare la strategia `Percentuale fissa con cap` con tasso `2.5%` e spese annue `30.000 €` su un portafoglio di `600.000 €`.
2. Verificare che **Sopravvivenza patrimonio** mostri una percentuale alta (verde) mentre **Piena copertura spese** segnali chiaramente il rischio (rosso/ambra) e la barra a 3 stati mostri la quota arancione *"Salvo ma spese tagliate"*.
3. Passare alla strategia `Guardrails (Guyton-Klinger)` e ridurre il `Tasso di riduzione` da `10%` a `0%`: osservare come i run passino dal segmento ambra (*Spese tagliate*) al segmento rosso (*Patrimonio esaurito*).

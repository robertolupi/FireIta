# 05 — Confronto Scenari A/B, Persistenza (`localStorage` / URL) ed Export

## 1. Obiettivo e Motivazione

Attualmente lo stato dell'applicazione in `src/lib/stores/plan.svelte.ts` è interamente effimero:
- `plan` è inizializzato con valori hardcoded ogni volta che la pagina viene caricata. Un semplice refresh del browser cancella tutti i parametri inseriti e l'intera lista di `LifeEvent` (`setExpenses`, `oneTimeExpense`, `stopWorking`).
- Non è possibile condividere una configurazione con un consulente, un partner o su un forum (es. tramite link URL) né esportare/importare il piano o la tabella annuale.
- Quando l'utente modifica una leva fondamentale — ad esempio posticipare `retirementAge` da 60 a 65 anni, ridurre `annualExpenses` di 3.000 €, o passare da `percentCap` a `guardrails` — i numeri in `ResultsSummary` e le curve in `FanChart` cambiano istantaneamente, ma non c'è modo di visualizzare il **delta** rispetto alla configurazione precedente.

Introdurre:
1. **Confronto Scenari A/B ("Fissa come Riferimento / Baseline")**: permette di congelare lo scenario corrente come *Scenario Base* e vedere in tempo reale i delta ($\Delta$ tasso di successo, $\Delta$ p10/p50/p90, $\Delta$ età di esaurimento) in `ResultsSummary.svelte` e la curva mediana di riferimento sovrapposta (tratteggiata) nel `FanChart.svelte`.
2. **Persistenza automatica (`localStorage`) e condivisione via URL (`?plan=...`)**: salvataggio automatico trasparente ad ogni modifica, pulsante *"Ripristina default"* e pulsante *"Copia link scenario"* che serializza il piano nell'hash/querystring dell'URL.
3. **Import/Export JSON e CSV**: esportazione/importazione del `Plan` completo in formato `.json` ed esportazione della proiezione annuale mediana (`YearState[]`) in `.csv` per analisi su fogli di calcolo.

---

## 2. Valutazione della Complessità

- **Stima effort**: **Media** (~5–7 ore di sviluppo + test).
- **Impatto architetturale**: Moderato. Coinvolge lo store centrale (`plan.svelte.ts`), un nuovo modulo puro di serializzazione/validazione (`src/lib/persistence.ts`), una barra degli strumenti per la gestione scenari (`ScenarioToolbar.svelte`), e aggiornamenti mirati a `ResultsSummary.svelte`, `FanChart.svelte` e `App.svelte`.
- **File coinvolti**:
  - `src/lib/persistence.ts` *(nuovo)* — funzioni pure per serializzazione/deserializzazione JSON e URL, validazione schema/versioning, generazione CSV della tabella annuale.
  - `src/lib/stores/plan.svelte.ts` — gestione di `baselinePlan`, `baselineStats`, persistenza reattiva su `localStorage`, caricamento iniziale da URL o `localStorage`, azioni `pinBaseline()`, `clearBaseline()`, `swapWithBaseline()`, `resetToDefault()`.
  - `src/lib/components/ScenarioToolbar.svelte` *(nuovo)* — barra superiore con azioni: *Fissa scenario base*, *Rimuovi base*, *Condividi link*, *Esporta/Importa JSON*, *Esporta CSV*, *Reset*.
  - `src/lib/components/ResultsSummary.svelte` — badge di variazione ($\Delta$) accanto a tasso di successo, percentili `p10`/`p50`/`p90` ed età di esaurimento quando è attivo uno scenario base.
  - `src/lib/components/FanChart.svelte` — rendering della linea mediana (`p50`) dello scenario base come curva tratteggiata di confronto.
  - `src/App.svelte` — integrazione di `ScenarioToolbar` e passaggio delle prop `baselineStats` / `baselineBands` ai componenti figli.
- **Rischi ed Edge Cases**:
  - ** Evoluzione dello schema `Plan` e dati corrotti in `localStorage` o URL**: se in futuro vengono aggiunti nuovi campi a `Plan` o un utente apre un URL malformato, l'applicazione non deve andare in crash. La funzione di parsing deve applicare un merge sicuro con `DEFAULT_PLAN` e validare i tipi numerici, gli enum di `withdrawalStrategy` e l'array `events`.
  - **Dimensione di `runs` durante il confronto A/B**: se `baselinePlan` è fissato, `baselineStats` dipende solo da `baselinePlan` (immutabile finché non viene aggiornato). Grazie a `$derived` di Svelte 5, `runMonteCarlo(baselinePlan)` viene eseguito **una sola volta** al momento del pin e non ricalcolato ad ogni input dell'utente sullo scenario attivo. Zero overhead sulle performance interattive.
  - **Orizzonti temporali diversi tra Scenario Attivo e Scenario Base**: se l'utente modifica `birthYear` o `lifeExpectancyAge` dopo aver fissato la baseline, gli array `stats.bands` e `baselineStats.bands` possono avere lunghezze o età iniziali diverse. In `FanChart.svelte`, l'allineamento sull'asse X deve avvenire per **età** (`age`) e non per semplice indice `year`.

---

## 3. Design Tecnico e Modifiche ai Dati/Componenti

### 3.1 Modulo di Persistenza, URL Encoding ed Export (`src/lib/persistence.ts`)

```ts
import type { Plan, YearState } from './engine/types'

export const STORAGE_KEY = 'fireita.plan.v1'
export const BASELINE_STORAGE_KEY = 'fireita.baseline.v1'

export function createDefaultPlan(): Plan {
  return {
    startYear: new Date().getFullYear(),
    birthYear: 1977,
    retirementAge: 67,
    lifeExpectancyAge: 95,
    initialPortfolio: 100_000,
    initialCostBasis: 80_000,
    annualIncome: 40_000,
    incomeGrowthRate: 0.02,
    annualExpenses: 25_000,
    inflationRate: 0.02,
    meanReturn: 0.05,
    returnStdDev: 0.15,
    runs: 1_000,
    seed: 42,
    taxRate: 0.26,
    withdrawalStrategy: { type: 'percentCap', rate: 0.04 },
    events: []
  }
}

export function sanitizePlan(raw: unknown): Plan {
  const def = createDefaultPlan()
  if (!raw || typeof raw !== 'object') return def
  const obj = raw as Record<string, unknown>

  const num = (key: keyof Plan, fallback: number, min = -Infinity, max = Infinity): number => {
    const val = Number(obj[key])
    return Number.isFinite(val) ? Math.min(max, Math.max(min, val)) : fallback
  }

  let withdrawalStrategy = def.withdrawalStrategy
  if (obj.withdrawalStrategy && typeof obj.withdrawalStrategy === 'object') {
    const ws = obj.withdrawalStrategy as Record<string, unknown>
    if (ws.type === 'percentCap' && Number.isFinite(Number(ws.rate))) {
      withdrawalStrategy = { type: 'percentCap', rate: Number(ws.rate) }
    } else if (ws.type === 'guardrails') {
      withdrawalStrategy = {
        type: 'guardrails',
        initialRate: Number.isFinite(Number(ws.initialRate)) ? Number(ws.initialRate) : 0.04,
        lowerGuardrail: Number.isFinite(Number(ws.lowerGuardrail)) ? Number(ws.lowerGuardrail) : 0.03,
        upperGuardrail: Number.isFinite(Number(ws.upperGuardrail)) ? Number(ws.upperGuardrail) : 0.05,
        increasePct: Number.isFinite(Number(ws.increasePct)) ? Number(ws.increasePct) : 0.1,
        decreasePct: Number.isFinite(Number(ws.decreasePct)) ? Number(ws.decreasePct) : 0.1
      }
    }
  }

  const events = Array.isArray(obj.events)
    ? obj.events.filter((e): e is Plan['events'][number] => {
        if (!e || typeof e !== 'object') return false
        if (e.kind === 'setExpenses') return Number.isFinite(e.fromYear) && Number.isFinite(e.amount)
        if (e.kind === 'oneTimeExpense') return Number.isFinite(e.atYear) && Number.isFinite(e.amount)
        if (e.kind === 'stopWorking') return Number.isFinite(e.atYear)
        return false
      })
    : []

  return {
    startYear: num('startYear', def.startYear, 1900, 2200),
    birthYear: num('birthYear', def.birthYear, 1900, 2200),
    retirementAge: num('retirementAge', def.retirementAge, 18, 120),
    lifeExpectancyAge: num('lifeExpectancyAge', def.lifeExpectancyAge, 19, 130),
    initialPortfolio: num('initialPortfolio', def.initialPortfolio, 0),
    initialCostBasis: num('initialCostBasis', def.initialCostBasis, 0),
    annualIncome: num('annualIncome', def.annualIncome, 0),
    incomeGrowthRate: num('incomeGrowthRate', def.incomeGrowthRate, -0.5, 1),
    annualExpenses: num('annualExpenses', def.annualExpenses, 0),
    inflationRate: num('inflationRate', def.inflationRate, -0.2, 1),
    meanReturn: num('meanReturn', def.meanReturn, -0.5, 1),
    returnStdDev: num('returnStdDev', def.returnStdDev, 0, 2),
    runs: Math.round(num('runs', def.runs, 10, 10_000)),
    seed: Math.round(num('seed', def.seed)),
    taxRate: num('taxRate', def.taxRate, 0, 1),
    withdrawalStrategy,
    events
  }
}

export function encodePlanToUrlParam(plan: Plan): string {
  const json = JSON.stringify(plan)
  return btoa(encodeURIComponent(json))
}

export function decodePlanFromUrlParam(encoded: string): Plan | null {
  try {
    const json = decodeURIComponent(atob(encoded))
    return sanitizePlan(JSON.parse(json))
  } catch {
    return null
  }
}

export function exportYearsToCsv(years: YearState[]): string {
  const headers = [
    'Anno',
    'Eta',
    'Fase',
    'PatrimonioInizio',
    'Reddito',
    'Spese',
    'Risparmio',
    'PrelievoNetto',
    'VenditaLorda',
    'ImpostePagate',
    'RendimentoPct',
    'RendimentoEur',
    'PatrimonioFine',
    'CostoFiscaleFine',
    'SpeseNonCoperte',
    'Esaurito'
  ]
  const rows = years.map((y) =>
    [
      y.calendarYear,
      y.age,
      y.phase,
      y.startPortfolio.toFixed(2),
      y.income.toFixed(2),
      y.expenses.toFixed(2),
      y.contribution.toFixed(2),
      y.withdrawal.toFixed(2),
      y.grossSale.toFixed(2),
      y.taxPaid.toFixed(2),
      (y.returnRate * 100).toFixed(2),
      y.investmentReturn.toFixed(2),
      y.endPortfolio.toFixed(2),
      y.endCostBasis.toFixed(2),
      y.expensesNotCovered ? '1' : '0',
      y.depleted ? '1' : '0'
    ].join(',')
  )
  return [headers.join(','), ...rows].join('\n')
}
```

### 3.2 Estensione dello Store (`src/lib/stores/plan.svelte.ts`)

Lo store carica lo stato iniziale dando priorità al parametro URL `?plan=...` (se presente), poi a `localStorage`, e infine a `createDefaultPlan()`. Inoltre espone `baselinePlan` e `baselineStats`:

```ts
import { runMonteCarlo } from '../engine/montecarlo'
import { computeStats, type SimStats } from '../engine/stats'
import type { Plan, SimResult } from '../engine/types'
import {
  BASELINE_STORAGE_KEY,
  STORAGE_KEY,
  createDefaultPlan,
  decodePlanFromUrlParam,
  sanitizePlan
} from '../persistence'

function loadInitialPlan(): Plan {
  if (typeof window === 'undefined') return createDefaultPlan()
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('plan')
  if (fromUrl) {
    const decoded = decodePlanFromUrlParam(fromUrl)
    if (decoded) return decoded
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved) return sanitizePlan(JSON.parse(saved))
  } catch {
    // Fallback al piano di default
  }
  return createDefaultPlan()
}

function loadInitialBaseline(): Plan | null {
  if (typeof window === 'undefined') return null
  try {
    const saved = window.localStorage.getItem(BASELINE_STORAGE_KEY)
    if (saved) return sanitizePlan(JSON.parse(saved))
  } catch {
    // Ignora errori storage
  }
  return null
}

function createPlanStore() {
  const plan = $state<Plan>(loadInitialPlan())
  let baselinePlan = $state<Plan | null>(loadInitialBaseline())

  const results: SimResult[] = $derived(runMonteCarlo(plan))
  const stats: SimStats = $derived(computeStats(results))

  const baselineResults: SimResult[] | null = $derived(
    baselinePlan ? runMonteCarlo(baselinePlan) : null
  )
  const baselineStats: SimStats | null = $derived(
    baselineResults ? computeStats(baselineResults) : null
  )

  function replacePlan(next: Plan) {
    const clean = sanitizePlan(next)
    Object.assign(plan, clean)
  }

  function pinBaseline() {
    baselinePlan = structuredClone($state.snapshot(plan))
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baselinePlan))
    }
  }

  function clearBaseline() {
    baselinePlan = null
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(BASELINE_STORAGE_KEY)
    }
  }

  function swapWithBaseline() {
    if (!baselinePlan) return
    const currentSnapshot = structuredClone($state.snapshot(plan))
    replacePlan(baselinePlan)
    baselinePlan = currentSnapshot
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baselinePlan))
    }
  }

  function resetToDefault() {
    replacePlan(createDefaultPlan())
  }

  return {
    plan,
    get results() {
      return results
    },
    get stats() {
      return stats
    },
    get baselinePlan() {
      return baselinePlan
    },
    get baselineStats() {
      return baselineStats
    },
    replacePlan,
    pinBaseline,
    clearBaseline,
    swapWithBaseline,
    resetToDefault
  }
}

export const planStore = createPlanStore()
```

In `App.svelte` un `$effect` sincronizza automaticamente `planStore.plan` verso `localStorage` a ogni modifica:

```ts
$effect(() => {
  const snapshot = JSON.stringify(planStore.plan)
  window.localStorage.setItem(STORAGE_KEY, snapshot)
})
```

### 3.3 Visualizzazione Delta in `ResultsSummary.svelte` e Curva di Riferimento in `FanChart.svelte`

- **`ResultsSummary.svelte`** accetta una prop opzionale `baselineStats?: SimStats | null`. Quando presente, mostra accanto a ciascuna metrica un badge $\Delta$:
  - Per `successRate`: `(stats.successRate - baselineStats.successRate) * 100` in punti percentuali (`+4,2 pp` in verde, `-3,1 pp` in rosso).
  - Per `p10`, `p50`, `p90`: differenza in Euro formattata con segno (`+45.000 €` / `-18.500 €`).
- **`FanChart.svelte`** accetta `baselineBands?: YearBand[] | null`. Se presente:
  - `maxValue` viene calcolato considerando il massimo tra `bands` e `baselineBands` così che entrambe le curve rientrino nella stessa scala Y.
  - Le coordinate X sono mappate per età (`age` compresa tra `minAge` e `maxAge`) e viene disegnato un `<path d={chart.baselineMedian} class="baseline-median" fill="none" />` con `stroke: #d97706; stroke-width: 2; stroke-dasharray: 6 4;` e relativa voce in legenda (*"mediana scenario base"*).

---

## 4. Step di Implementazione

1. **Creare `src/lib/persistence.ts`**:
   - Implementare `createDefaultPlan()`, `sanitizePlan()`, `encodePlanToUrlParam()`, `decodePlanFromUrlParam()`, `exportYearsToCsv()`.
2. **Aggiornare `src/lib/stores/plan.svelte.ts`**:
   - Integrare caricamento iniziale da URL/localStorage, stato reattivo `baselinePlan` e `$derived` per `baselineStats`, più i metodi di mutazione (`pinBaseline`, `clearBaseline`, `swapWithBaseline`, `replacePlan`, `resetToDefault`).
3. **Creare `src/lib/components/ScenarioToolbar.svelte`**:
   - Aggiungere pulsanti per:
     - *"Fissa come Scenario Base"* (o *"Aggiorna Base"*, *"Inverti A/B"*, *"Rimuovi Base"* quando già fissato).
     - *"Condividi link"* (aggiorna `window.history.replaceState` con `?plan=...` e copia negli appunti con feedback `"Link copiato!"`).
     - *"Esporta JSON"* / *"Importa JSON"* (tramite `<input type="file" accept=".json">` nascosto).
     - *"Esporta CSV (run mediano)"*.
     - *"Ripristina default"*.
4. **Aggiornare `src/lib/components/ResultsSummary.svelte`**:
   - Aggiungere prop `baselineStats?: SimStats | null` e helper di formattazione dei delta con classi semantiche `.delta.pos`, `.delta.neg`, `.delta.neutral`.
5. **Aggiornare `src/lib/components/FanChart.svelte`**:
   - Aggiungere prop `baselineBands?: YearBand[] | null`, scalare l'asse Y sul massimo congiunto e disegnare la linea mediana tratteggiata dello scenario base.
6. **Collegare in `src/App.svelte`**:
   - Montare `<ScenarioToolbar />` sotto l'header, attivare il salvataggio automatico su `localStorage` via `$effect` e passare `baselineStats={planStore.baselineStats}` e `baselineBands={planStore.baselineStats?.bands}`.

---

## 5. Piano di Test e Verifica

### 5.1 Unit Test (Vitest)
Creare `src/lib/engine/__tests__/persistence.test.ts`:
1. **Round-trip URL encoding/decoding**:
   - Creare un `Plan` con strategia `guardrails` e tutti e 3 i tipi di `LifeEvent`.
   - Verificare che `decodePlanFromUrlParam(encodePlanToUrlParam(plan))` sia `toEqual(plan)`.
2. **Sanitizzazione input corrotti (`sanitizePlan`)**:
   - Passare `null`, `{}`, `{ retirementAge: "non-un-numero", runs: 99999999, events: [{ kind: "unknown" }] }`.
   - Verificare che `sanitizePlan` restituisca un oggetto `Plan` valido, con `runs` limitato a `10_000` ed eventi invalidi filtrati.
3. **Generazione CSV (`exportYearsToCsv`)**:
   - Eseguire `runProjection` su un piano di 5 anni e verificare che l'output CSV contenga l'intestazione + 5 righe con 16 colonne separate da virgola.

### 5.2 Test Manuali UI
1. Modificare `Patrimonio iniziale` a `250.000 €`, aggiungere un evento `Cambio spese annue` e ricaricare la pagina (`F5`): verificare che tutti i dati persistano.
2. Cliccare su **Fissa come Scenario Base**, poi abbassare l'**Età pensionamento** da 67 a 60 anni:
   - Verificare che in `ResultsSummary` compaiano i badge $\Delta$ negativi sul tasso di successo e sui percentili.
   - Verificare che in `FanChart` compaia la linea tratteggiata arancione della mediana base sopra la nuova mediana blu.
3. Cliccare su **Condividi link**, aprire una finestra in incognito all'URL copiato e verificare che il piano venga caricato identico.
4. Testare **Esporta JSON**, modificare il piano, poi usare **Importa JSON** con il file appena scaricato e verificare il ripristino completo.

# FireIta — Roadmap & Piano dei Miglioramenti

Questo documento raccoglie e organizza i **12 miglioramenti** progettati per **FireIta**, suddivisi tra **Interfaccia e Presentazione (UI/UX)** e **Motore di Simulazione e Metodologie Quant/Fiscali**.

Ogni voce nella checklist qui sotto punta al relativo documento di progettazione tecnica nella cartella [`doc/`](./), che contiene:
- **Obiettivo e Motivazione**
- **Valutazione della Complessità** (Effort, Impatto architetturale, File coinvolti, Edge case)
- **Design Tecnico e Modello Matematico**
- **Step di Implementazione**
- **Piano di Test e Verifica**

---

## Checklist dei Miglioramenti (To-Do List)

### Parte 1 — Interfaccia e Presentazione delle Informazioni (UI/UX)

- [ ] **[01 — Toggle Valori Reali (Oggi €) vs. Valori Nominali (Futuri €)](./01-ui-real-vs-nominal.md)**
  - **Complessità**: 🟢 Bassa
  - **Sintesi**: Aggiunge uno switch globale per deflazionare tutti i valori monetari in grafici, KPI e tabelle per $(1 + r_{\text{infl}})^t$, eliminando l'illusione monetaria su orizzonti lunghi.
  - **File principali**: `src/lib/stores/plan.svelte.ts`, `src/lib/components/ResultsSummary.svelte`, `src/lib/components/FanChart.svelte`, `src/lib/components/YearTable.svelte`.

- [ ] **[02 — FanChart Interattivo con Crosshair, Tooltip, Marker di Eventi e Soglia Target FIRE](./02-ui-interactive-fanchart.md)**
  - **Complessità**: 🟡 Media
  - **Sintesi**: Arricchisce l'SVG del grafico a bande con cursore interattivo (*hover crosshair*), tooltip dettagliato dei percentili per età, linee verticali per pensionamento ed eventi di vita, e curva del Target FIRE.
  - **File principali**: `src/lib/components/FanChart.svelte`, `src/App.svelte`.

- [ ] **[03 — Selettore di Percentile/Scenario per la Tabella Annuale e Distinta di Cash-Flow](./03-ui-yeartable-percentiles-cashflow.md)**
  - **Complessità**: 🟡 Media
  - **Sintesi**: Permette di ispezionare in tabella non solo il run mediano (`p50`), ma anche gli scenari avversi (`p10`, `p25`, peggior run o primo fallimento) e di visualizzare la scomposizione dei flussi di cassa annuali.
  - **File principali**: `src/lib/engine/stats.ts`, `src/lib/components/YearTable.svelte`, `src/App.svelte`.

- [ ] **[04 — Distinzione tra "Patrimonio Esaurito" e "Spese Tagliate" nei KPI di Successo](./04-ui-spending-coverage-kpi.md)**
  - **Complessità**: 🟢 Bassa
  - **Sintesi**: Separa il tasso di sopravvivenza del capitale (`!depleted`) dal tasso di copertura integrale delle spese (`!expensesNotCovered`), fondamentale quando si usano strategie dinamiche (`guardrails` o `percentCap`) che evitano il default tagliando i consumi.
  - **File principali**: `src/lib/engine/types.ts`, `src/lib/engine/montecarlo.ts`, `src/lib/engine/stats.ts`, `src/lib/components/ResultsSummary.svelte`.

- [ ] **[05 — Confronto Scenari A/B, Persistenza (`localStorage` / URL) ed Export](./05-ui-scenarios-persistence-export.md)**
  - **Complessità**: 🟡 Media
  - **Sintesi**: Salva automaticamente il piano in `localStorage`, permette la condivisione tramite URL, l'esportazione JSON/CSV e il "Pin" di uno scenario di riferimento per confrontare i delta sui KPI e la mediana sul FanChart.
  - **File principali**: `src/lib/stores/plan.svelte.ts`, `src/lib/components/ResultsSummary.svelte`, `src/lib/components/FanChart.svelte`, `src/App.svelte`.

- [ ] **[06 — Matrice di Sensitività (Heatmap Età di Ritiro vs. Spese Annue)](./06-ui-sensitivity-heatmap.md)**
  - **Complessità**: 🟡 Media
  - **Sintesi**: Aggiunge una griglia visuale (es. Età di pensionamento $\pm 4$ anni $\times$ Spese annue $\pm 20\%$) colorata per tasso di successo per valutare immediatamente il margine di sicurezza del piano.
  - **File principali**: `src/lib/components/SensitivityMatrix.svelte`, `src/App.svelte`.

---

### Parte 2 — Motore di Simulazione e Metodologie (Quant & Fiscalità Italiana)

- [ ] **[07 — Fiscalità e Previdenza Italiana Realistica (Imposta di Bollo 0,20%, INPS, Fondo Pensione)](./07-engine-italian-tax-pension.md)**
  - **Complessità**: 🟡 Media
  - **Sintesi**: Introduce l'imposta di bollo patrimoniale dello 0,20% annuo sul dossier titoli, le entrate previdenziali ricorrenti post-ritiro (es. pensione pubblica INPS o rendite), l'aliquota mista white-list (12,5% vs 26%) e/o la gestione Fondo Pensione / RITA.
  - **File principali**: `src/lib/engine/types.ts`, `src/lib/engine/tax.ts`, `src/lib/engine/projection.ts`, `src/lib/components/PlanForm.svelte`, `src/lib/components/EventsEditor.svelte`.

- [ ] **[08 — Backtesting Storico e Block Bootstrap (Serie Storiche Reali e Inflazione Stocastica)](./08-engine-historical-backtesting-bootstrap.md)**
  - **Complessità**: 🟠 Media-Alta
  - **Sintesi**: Affianca al Monte Carlo log-normale i.i.d. il backtesting su finestre storiche reali (*Rolling Historical Periods*) e il campionamento *Block Bootstrap* di blocchi pluriennali (rendimento + inflazione storica correlata).
  - **File principali**: `src/lib/engine/historicalData.ts`, `src/lib/engine/montecarlo.ts`, `src/lib/engine/projection.ts`, `src/lib/engine/types.ts`.

- [ ] **[09 — Correzione e Arricchimento delle Strategie di Prelievo (Inflazione su Guardrails, SWR Costante, VPW)](./09-engine-withdrawal-strategies.md)**
  - **Complessità**: 🟢 Bassa-Media
  - **Sintesi**: Corregge l'indicizzazione all'inflazione del prelievo nella strategia `guardrails` (Guyton-Klinger) e introduce le strategie `constantDollar` (4% rule classica), `spendExpenses` (fabbisogno puro senza cap) e `vpw` (*Variable Percentage Withdrawal*).
  - **File principali**: `src/lib/engine/types.ts`, `src/lib/engine/projection.ts`, `src/lib/components/PlanForm.svelte`, `src/lib/engine/__tests__/guardrails.test.ts`.

- [ ] **[10 — Asset Allocation Multi-Asset, Ribilanciamento e Glidepath (Bond Tent)](./10-engine-multi-asset-glidepath.md)**
  - **Complessità**: 🔴 Alta
  - **Sintesi**: Modella portafogli multi-asset (Azioni, Obbligazioni, Liquidità) con correlazione, supporto a *Glidepath / Bond Tent* intorno alla data di ritiro e ribilanciamento fiscalmente efficiente per il regime amministrato italiano.
  - **File principali**: `src/lib/engine/types.ts`, `src/lib/engine/montecarlo.ts`, `src/lib/engine/projection.ts`, `src/lib/components/PlanForm.svelte`.

- [ ] **[11 — Ordine dei Flussi di Cassa Infra-Annuali e Cuscinetto di Liquidità (Cash Buffer)](./11-engine-cashflow-timing-buffer.md)**
  - **Complessità**: 🟡 Media
  - **Sintesi**: Affina il timing dei prelievi rispetto ai rendimenti di mercato (inizio anno / mid-year) e introduce un *Cash Buffer* (1–3 anni di spese in liquidità) da utilizzare negli anni di mercato orso per evitare di vendere azioni in drawdown.
  - **File principali**: `src/lib/engine/types.ts`, `src/lib/engine/projection.ts`, `src/lib/components/PlanForm.svelte`.

- [ ] **[12 — Esecuzione Asincrona via Web Worker, Ottimizzazione Memoria e Risolutore Inverso ("Goal Seek")](./12-engine-webworker-goalseek.md)**
  - **Complessità**: 🟠 Media-Alta
  - **Sintesi**: Ottimizza `computeStats`, sposta il calcolo Monte Carlo pesante in un Web Worker per mantenere la UI fluida a 60 fps e aggiunge un risolutore inverso (*Goal Seek* per bisezione) che calcola automaticamente età minima FIRE o spesa massima sostenibile.
  - **File principali**: `src/lib/engine/stats.ts`, `src/lib/engine/goalSeek.ts`, `src/lib/workers/sim.worker.ts`, `src/lib/stores/plan.svelte.ts`.

---

## Matrice Riassuntiva e Ordine di Implementazione Consigliato

Per minimizzare i conflitti sul codice e ottenere subito il massimo valore funzionale, si consiglia di procedere in **4 fasi incrementali**:

| Fase | ID | Proposta | Area | Complessità | Impatto Utente |
| :--- | :-: | :--- | :---: | :---: | :---: |
| **Fase 1: Fondamenta Motore & KPI** | [09](./09-engine-withdrawal-strategies.md) | Fix inflazione Guardrails + nuove strategie (`spendExpenses`, `constantDollar`, `vpw`) | Engine | 🟢 Bassa-Media | 🔥 Altissimo |
| **Fase 1: Fondamenta Motore & KPI** | [04](./04-ui-spending-coverage-kpi.md) | KPI "Spese Coperte" vs "Patrimonio non esaurito" | UI + Stats | 🟢 Bassa | 🔥 Altissimo |
| **Fase 1: Fondamenta Motore & KPI** | [07](./07-engine-italian-tax-pension.md) | Imposta di Bollo 0,20% + Pensione INPS / Entrate ricorrenti | Engine + UI | 🟡 Media | 🔥 Altissimo |
| **Fase 2: Chiarezza Visiva & Analisi** | [01](./01-ui-real-vs-nominal.md) | Toggle Valori Reali (Oggi €) vs. Nominali (Futuri €) | UI | 🟢 Bassa | ⭐ Alto |
| **Fase 2: Chiarezza Visiva & Analisi** | [02](./02-ui-interactive-fanchart.md) | FanChart interattivo (Crosshair, Tooltip, Marker, Target FIRE) | UI | 🟡 Media | ⭐ Alto |
| **Fase 2: Chiarezza Visiva & Analisi** | [03](./03-ui-yeartable-percentiles-cashflow.md) | Selettore Percentile (`p10`/`p25`/`p50`/`p90`) in Tabella + Cash-Flow | UI + Stats | 🟡 Media | ⭐ Alto |
| **Fase 3: Strumenti di Pianificazione** | [05](./05-ui-scenarios-persistence-export.md) | Persistenza `localStorage`/URL, Export e Confronto Scenari A/B | Store + UI | 🟡 Media | ⭐ Alto |
| **Fase 3: Strumenti di Pianificazione** | [11](./11-engine-cashflow-timing-buffer.md) | Timing flussi di cassa e Cash Buffer anti-drawdown | Engine | 🟡 Media | 📈 Medio-Alto |
| **Fase 3: Strumenti di Pianificazione** | [06](./06-ui-sensitivity-heatmap.md) | Matrice di Sensitività (Heatmap Età Ritiro $\times$ Spese) | UI | 🟡 Media | 📈 Medio-Alto |
| **Fase 4: Simulazione Avanzata** | [08](./08-engine-historical-backtesting-bootstrap.md) | Backtesting Storico & Block Bootstrap con inflazione stocastica | Engine + UI | 🟠 Media-Alta | 🚀 Avanzato |
| **Fase 4: Simulazione Avanzata** | [12](./12-engine-webworker-goalseek.md) | Web Worker asincrono + Risolutore Inverso ("Goal Seek") | Engine + Store | 🟠 Media-Alta | 🚀 Avanzato |
| **Fase 4: Simulazione Avanzata** | [10](./10-engine-multi-asset-glidepath.md) | Asset Allocation Multi-Asset, Ribilanciamento e Bond Tent | Engine + UI | 🔴 Alta | 🚀 Avanzato |

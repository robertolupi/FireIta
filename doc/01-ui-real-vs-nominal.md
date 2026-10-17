# 01 — Toggle Valori Reali (Oggi €) vs. Valori Nominali (Futuri €)

## Obiettivo e Motivazione

Nella pianificazione finanziaria orientata al movimento FIRE (*Financial Independence, Retire Early*) su orizzonti temporali di 30–50 anni, la proiezione esclusiva di valori nominali induce il fenomeno psicologico della **money illusion** (illusione monetaria). Con un tasso di inflazione annuo del $2{,}0\%$, un capitale nominale di $1.000.000\text{ €}$ tra 35 anni corrisponde a circa $500.028\text{ €}$ in potere d'acquisto odierno; al $3{,}0\%$, scende a circa $355.383\text{ €}$.

Attualmente il motore di simulazione di **FireIta** proietta flussi di cassa, spese indicizzate e montanti di portafoglio esclusivamente in termini nominali (euro futuri correnti dell'anno $y$). Introdurre un selettore globale **"Valori Reali (Oggi €) / Valori Nominali (Futuri €)"** consente all'utente di:
1. Confrontare immediatamente il capitale futuro e i prelievi con il proprio tenore di vita attuale (es. *"Vivere con 24.000 € annui di oggi"*).
2. Verificare che le spese indicizzate all'inflazione rimangano costanti in termini reali lungo la `YearTable` (in assenza di eventi `setExpenses` o `oneTimeExpense`).
3. Valutare la reale erosione fiscale in Italia: poiché l'imposta sul capital gain ($26\%$ o aliquota mista con Titoli di Stato al $12{,}5\%$) si applica sul guadagno nominale anziché reale, la visualizzazione in euro reali mette in luce il cosiddetto *fiscal drag* sul rendimento reale del portafoglio.

---

## Valutazione della Complessità

- **Stima effort**: **Bassa–Media** (circa 3–4 ore di sviluppo + test).
- **Impatto architetturale**: **Non intrusivo sul motore di simulazione**. Il motore Monte Carlo (`projection.ts` / `montecarlo.ts`) deve continuare a operare internamente in **valori nominali**, poiché la fiscalità italiana (PMC / `endCostBasis`, plusvalenze nominali, zainetto fiscale o bollo) è calcolata per legge sui valori nominali. La conversione in valori reali avviene come **trasformazione pura di presentazione (view-layer)** derivata tramite Svelte 5 runes (`$derived`).
- **File coinvolti**:
  - `src/lib/engine/deflate.ts` *(nuovo modulo di utility pure per la deflazione)*
  - `src/lib/stores/plan.svelte.ts` *(aggiunta stato UI `valueMode: 'nominal' | 'real'` e derivati deflazionati)*
  - `src/lib/components/ResultsSummary.svelte` *(badge/indicatore modalità e metriche finali)*
  - `src/lib/components/FanChart.svelte` *(sottotitolo/asse Y aggiornato con unità di misura)*
  - `src/lib/components/YearTable.svelte` *(intestazione colonne e valori riga)*
  - `src/App.svelte` *(posizionamento del toggle globale nella barra superiore dei risultati)*
- **Rischi ed Edge Cases**:
  1. **Tasso di inflazione nullo o negativo** ($r_{\text{infl}} \le 0$): la formula $(1 + r_{\text{infl}})^t$ resta ben definita per $r_{\text{infl}} > -1$, ma occorre imporre un guard $1 + r_{\text{infl}} \ge 0{,}01$ per evitare divisioni per zero o inversioni di segno con input estremi.
  2. **Allineamento dell'anno base ($t = 0$)**: il primo anno della simulazione (`year === plan.startYear`) rappresenta l'anno zero ($t = 0$, fattore di sconto $= 1$) oppure la fine del primo anno ($t = 1$)? Per coerenza con `projection.ts` (dove nell'anno `startYear` le spese base non hanno ancora subito rivalutazione inflattiva o usano indice $t = y - \text{startYear}$), il fattore di deflazione all'anno $y$ deve usare esattamente $t = y - \text{startYear}$.
  3. **Invarianza del tasso di successo (`successRate`)**: la probabilità di sopravvivenza del portafoglio ($\text{endPortfolio} > 0$) è invariante per riscalamento positivo. Il calcolo non deve essere alterato.

---

## Design Tecnico e Modifiche ai Dati/Componenti

### 1. Modello Matematico di Deflazione

Sia $y_0 = \text{plan.startYear}$ l'anno iniziale del piano e $r_{\text{infl}} = \text{plan.inflationRate}$ il tasso di inflazione annuo atteso (es. $0{,}02$ per il $2\%$). Per un generico anno di simulazione $y \ge y_0$, il numero di anni trascorsi è:

$$t = y - y_0$$

Il **fattore di deflazione cumulato** $D(y)$ è definito come:

$$D(y) = (1 + r_{\text{infl}})^{y - y_0}$$

Ogni grandezza monetaria nominale $V_{\text{nom}}(y)$ (espressa in euro correnti dell'anno $y$) viene convertita nel corrispondente valore reale $V_{\text{real}}(y)$ (espresso in euro a potere d'acquisto costante dell'anno $y_0$) mediante:

$$V_{\text{real}}(y) = \frac{V_{\text{nom}}(y)}{D(y)} = V_{\text{nom}}(y) \cdot (1 + r_{\text{infl}})^{-(y - y_0)}$$

> **Nota di consistenza sui saldi di fine anno vs. inizio anno**:
> All'interno di `YearState`, `startPortfolio` all'anno $y$ coincide con `endPortfolio` dell'anno $y-1$ in termini nominali. Se si deflazionano tutte le colonne della riga $y$ con lo stesso divisore $D(y)$, l'identità contabile intra-annuale:
> $$\text{endPortfolio} = \text{startPortfolio} + \text{investmentReturn} + \text{contribution} - \text{grossSale}$$
> **si preserva esattamente anche in termini reali**, perché la trasformazione è lineare per ogni fissato $y$.

### 2. Nuovo Modulo `src/lib/engine/deflate.ts`

```typescript
import type { YearState } from './types';
import type { SimStats, YearBand, Percentiles } from './stats';

export type ValueMode = 'nominal' | 'real';

/**
 * Calcola il divisore di inflazione cumulata (1 + r_infl)^(year - startYear).
 */
export function inflationDivisor(year: number, startYear: number, inflationRate: number): number {
	const t = Math.max(0, year - startYear);
	const safeBase = Math.max(0.01, 1 + inflationRate);
	return Math.pow(safeBase, t);
}

/**
 * Converte uno stato annuale nominale in valori reali (euro dell'anno startYear).
 */
export function deflateYearState(
	state: YearState,
	startYear: number,
	inflationRate: number
): YearState {
	const d = inflationDivisor(state.year, startYear, inflationRate);
	if (d === 1) return state;

	return {
		...state,
		income: state.income / d,
		expenses: state.expenses / d,
		contribution: state.contribution / d,
		withdrawal: state.withdrawal / d,
		grossSale: state.grossSale / d,
		taxPaid: state.taxPaid / d,
		investmentReturn: state.investmentReturn / d,
		startPortfolio: state.startPortfolio / d,
		endPortfolio: state.endPortfolio / d,
		endCostBasis: state.endCostBasis / d
	};
}

/**
 * Converte una YearBand (percentili p10..p90 per l'anno y) in valori reali.
 */
export function deflateYearBand(
	band: YearBand,
	startYear: number,
	inflationRate: number
): YearBand {
	const d = inflationDivisor(band.year, startYear, inflationRate);
	if (d === 1) return band;

	return {
		...band,
		p10: band.p10 / d,
		p25: band.p25 / d,
		p50: band.p50 / d,
		p75: band.p75 / d,
		p90: band.p90 / d
	};
}

/**
 * Converte l'intero oggetto SimStats nel ValueMode richiesto.
 */
export function transformSimStats(
	stats: SimStats,
	startYear: number,
	inflationRate: number,
	mode: ValueMode
): SimStats {
	if (mode === 'nominal') return stats;

	const bands = stats.bands.map((b) => deflateYearBand(b, startYear, inflationRate));
	const lastBand = bands[bands.length - 1];

	const finalPercentiles: Percentiles = lastBand
		? {
				p10: lastBand.p10,
				p25: lastBand.p25,
				p50: lastBand.p50,
				p75: lastBand.p75,
				p90: lastBand.p90
			}
		: stats.finalPercentiles;

	const medianRun = stats.medianRun
		? {
				...stats.medianRun,
				years: stats.medianRun.years.map((y) => deflateYearState(y, startYear, inflationRate)),
				finalPortfolio:
					stats.medianRun.years.length > 0
						? stats.medianRun.years[stats.medianRun.years.length - 1].endPortfolio /
							inflationDivisor(
								stats.medianRun.years[stats.medianRun.years.length - 1].year,
								startYear,
								inflationRate
							)
						: 0
			}
		: null;

	return {
		...stats,
		bands,
		finalPercentiles,
		medianRun
	};
}
```

### 3. Estensione dello Store `src/lib/stores/plan.svelte.ts`

Nello store reattivo Svelte 5 aggiungiamo lo stato `valueMode` (con persistenza opzionale in `localStorage`) e il derivato `displayStats`:

```typescript
import { transformSimStats, type ValueMode } from '$lib/engine/deflate';

// All'interno dello stato reattivo del modulo:
let valueMode = $state<ValueMode>('real'); // Default consigliato: 'real' o 'nominal'

const rawStats = $derived(computeStats(simResults));
const displayStats = $derived(
	transformSimStats(rawStats, plan.startYear, plan.inflationRate, valueMode)
);

export function getPlanStore() {
	return {
		get plan() { return plan; },
		get valueMode() { return valueMode; },
		set valueMode(v: ValueMode) { valueMode = v; },
		get stats() { return displayStats; },
		get rawStats() { return rawStats; }
	};
}
```

### 4. Componente UI Toggle e Aggiornamento Viste

Nella barra degli strumenti dei risultati (`App.svelte` o header di `ResultsSummary.svelte`), inseriamo un controllo segmentato accessibile:

```svelte
<div class="value-mode-toggle" role="group" aria-label="Modalità valuta">
	<button
		type="button"
		class:active={store.valueMode === 'real'}
		onclick={() => (store.valueMode = 'real')}
		title="Importi scontati per l'inflazione al potere d'acquisto di {store.plan.startYear}"
	>
		Valori Reali (Oggi €)
	</button>
	<button
		type="button"
		class:active={store.valueMode === 'nominal'}
		onclick={() => (store.valueMode = 'nominal')}
		title="Importi futuri non scontati per l'inflazione"
	>
		Valori Nominali (Futuri €)
	</button>
</div>
```

- **`ResultsSummary.svelte`**: Aggiunge un sottotitolo esplicativo sotto i percentili finali: `in € del ${plan.startYear} (potere d'acquisto costante)` quando `valueMode === 'real'`, oppure `in € nominali futuri` quando `valueMode === 'nominal'`.
- **`FanChart.svelte`**: Aggiorna l'etichetta della legenda/titolo del grafico indicando chiaramente `(€ reali ${plan.startYear})` vs `(€ nominali)`.
- **`YearTable.svelte`**: Nelle intestazioni delle colonne monetarie mostra il suffisso `€ (reali)` o `€ (nom.)`.

---

## Step di Implementazione

1. **Creazione utility di deflazione**: Creare `src/lib/engine/deflate.ts` con le funzioni pure `inflationDivisor`, `deflateYearState`, `deflateYearBand` e `transformSimStats`.
2. **Integrazione nello store reattivo**: Aggiornare `src/lib/stores/plan.svelte.ts` per esporre `valueMode` (`'real' | 'nominal'`) e sostituire l'esposizione diretta di `stats` con la versione trasformata da `transformSimStats`, mantenendo `rawStats` se necessario per ispezioni grezze.
3. **Implementazione del Toggle UI**: Aggiungere il segmented button in `src/App.svelte` (sopra `ResultsSummary`) con stile coerente con il design system esistente.
4. **Aggiornamento etichette nei componenti figli**: Passare `valueMode` (o leggerlo dallo store) in `ResultsSummary.svelte`, `FanChart.svelte` e `YearTable.svelte` per mostrare badge contestuali sul tipo di euro visualizzato.
5. **Verifica formattazione valuta**: Assicurarsi che la funzione di formattazione `formatCurrency` arrotondi correttamente i valori reali all'euro intero più vicino (`Math.round`).

---

## Piano di Test e Verifica

### Unit Test (Vitest — `src/lib/engine/__tests__/deflate.test.ts`)
1. **Anno base ($t = 0$)**: Verificare che per `year === startYear` `inflationDivisor(2026, 2026, 0.02)` restituisca esattamente `1` e `deflateYearState` lasci invariati tutti i campi.
2. **Deflazione multi-annuale esatta**: Con `startYear = 2026`, `year = 2036` ($t = 10$), `inflationRate = 0.02` e `endPortfolio = 100_000`, verificare che il valore reale sia $100000 / (1{,}02)^{10} \approx 82034{,}83$.
3. **Preservazione dell'equazione contabile annuale**: Verificare che dopo `deflateYearState` valga ancora `Math.abs((s.startPortfolio + s.investmentReturn + s.contribution - s.grossSale) - s.endPortfolio) < 1e-6`.
4. **Invarianza con inflazione zero**: Con `inflationRate = 0`, verificare che `transformSimStats` in modalità `'real'` produca numeri identici alla modalità `'nominal'`.
5. **Invarianza del `successRate`**: Verificare che `transformSimStats` non alteri mai `stats.successRate`.

### Test UI Manuali
1. Impostare un piano con inflazione al $2\%$ e spese annue costanti (es. $24.000\text{ €}$) senza eventi `setExpenses`.
2. Attivare **"Valori Nominali (Futuri €)"**: verificare che nella `YearTable` la colonna `Spese` cresca del $2\%$ ogni anno.
3. Attivare **"Valori Reali (Oggi €)"**: verificare che nella `YearTable` la colonna `Spese` rimanga fissa a $24.000\text{ €}$ per tutta la durata della simulazione e che le bande del `FanChart` si abbassino riflettendo il potere d'acquisto reale.

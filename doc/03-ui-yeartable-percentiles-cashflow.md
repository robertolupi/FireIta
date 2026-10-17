# 03 — Selettore di Percentile/Scenario per la Tabella Annuale e Distinta di Cash-Flow

## Obiettivo e Motivazione

Attualmente `SimStats` (`src/lib/engine/stats.ts`) ordina le $N$ traiettorie Monte Carlo in base al patrimonio finale (`finalPortfolio`) ed espone unicamente la traiettoria mediana (`medianRun`, corrispondente al $50^\circ$ percentile $P_{50}$), che viene poi passata a `YearTable.svelte`.

Tuttavia, nella pianificazione FIRE il rischio principale non risiede nello scenario mediano, bensì nel **rischio di sequenza dei rendimenti** (*Sequence of Returns Risk* — SoRR) negli scenari sfavorevoli ($P_{10}$ e $P_{25}$). Un piano che mostra una mediana finale di $800.000\text{ €}$ potrebbe nascondere che nel $10^\circ$ percentile il capitale si azzera a 68 anni a causa di mercati ribassisti nei primi 5 anni di pensionamento.

Inoltre, l'attuale tabella annuale condensa i flussi in poche colonne sintetiche, rendendo difficile per l'utente capire l'esatta meccanica fiscale italiana anno per anno:
- Quanto è stato versato (`contribution`) vs. quanto è stato venduto al lordo delle tasse (`grossSale`)?
- Qual è la quota di imposta sul capital gain pagata (`taxPaid`) rispetto al prelievo netto necessario per coprire le spese (`withdrawal`)?
- Qual è il Prezzo Medio di Carico residuo (`endCostBasis`, cioè la base imponibile esente da tassazione) rispetto alla plusvalenza latente del portafoglio?

Questo intervento introduce:
1. **Selettore di Scenario/Percentile nella `YearTable`**: possibilità di ispezionare l'intera traiettoria annuale per **$P_{10}$ (Pessimistico)**, **$P_{25}$ (Prudente)**, **$P_{50}$ (Mediano)**, **$P_{75}$ (Favorevole)** e **$P_{90}$ (Ottimistico)**.
2. **Distinta Completa di Cash-Flow e Fiscalità**: visualizzazione chiara di tutte le componenti di `YearState`, con indicatori visivi di plusvalenza latente, aliquota fiscale effettiva sul prelievo e riga di riepilogo/totali cumulati.

---

## Valutazione della Complessità

- **Stima effort**: **Bassa–Media** (circa 3–4 ore di sviluppo + test).
- **Impatto architetturale**: **Contenuto e retrocompatibile**. `YearState` in `src/lib/engine/types.ts` calcola e popola **già oggi** tutti i campi necessari (`income`, `expenses`, `contribution`, `withdrawal`, `grossSale`, `taxPaid`, `investmentReturn`, `startPortfolio`, `endPortfolio`, `endCostBasis`). Basta estendere `SimStats` in `stats.ts` per conservare le 5 run rappresentative dei percentili anziché solo `medianRun`.
- **File coinvolti**:
  - `src/lib/engine/stats.ts` *(aggiunta di `percentileRuns: Record<PercentileKey, SimResult | null>` in `SimStats`)*
  - `src/lib/engine/deflate.ts` *(se combinato con la feature 01, deflazione di tutte le `percentileRuns`)*
  - `src/lib/components/YearTable.svelte` *(selettore di percentile, toggle vista compatta/dettagliata cash-flow, riga totali cumulati)*
  - `src/App.svelte` *(passaggio di `stats.percentileRuns` a `<YearTable>`)*
- **Rischi ed Edge Cases**:
  1. **Differenza tra Traiettoria Rappresentativa ($R_{p}$) e Banda Puntuale ($B_{p}$)**:
     - Nel `FanChart`, la banda $P_{10}$ all'anno $y$ è il $10^\circ$ percentile della distribuzione cross-sezionale dei portafogli in quell'anno specifico (quindi anni diversi possono provenire da simulazioni diverse).
     - Nella `YearTable`, invece, **è fondamentale mostrare una singola traiettoria coerente (`SimResult`) dall'inizio alla fine**, altrimenti l'identità contabile $\text{startPortfolio}(y) = \text{endPortfolio}(y-1)$ e l'evoluzione di `endCostBasis` risulterebbero matematicamente incoerenti tra un anno e il successivo.
     - **Soluzione**: Selezionare la singola simulazione che si colloca al percentile $p$ secondo una metrica di ordinamento rigorosa (che tiene conto anche dell'anno di eventuale esaurimento del capitale) e aggiungere una nota informativa (tooltip) che spiega perché i valori intermedi della singola run rappresentativa possono differire leggermente dalle bande cross-sezionali del `FanChart`.
  2. **Ordinamento delle simulazioni che vanno a zero (`endPortfolio === 0`)**:
     - Se il $20\%$ delle simulazioni termina con `finalPortfolio === 0`, ordinare solo per `finalPortfolio` renderebbe indistinguibili tutte le run fallite (tra cui $P_{10}$).
     - **Soluzione**: Ordinare le simulazioni prima per **anno di sopravvivenza** (numero di anni con `endPortfolio > 0`) e, a parità di sopravvivenza, per `finalPortfolio`.

---

## Design Tecnico e Modifiche ai Dati/Componenti

### 1. Ordinamento Robusto delle Traiettorie e Selezione dei Percentili (`src/lib/engine/stats.ts`)

Definiamo una chiave di ordinamento lessicografica per due traiettorie $A$ e $B$:
1. Sia $S(R)$ l'indice del primo anno in cui $\text{endPortfolio} \le 0$ (oppure $+\infty$ se il portafoglio sopravvive fino a fine orizzonte).
2. $A \prec B$ se e solo se:
   $$S(A) < S(B) \quad \lor \quad \big(S(A) = S(B) \;\land\; A.\text{finalPortfolio} < B.\text{finalPortfolio}\big)$$

Dato l'array ordinato $R_0 \preceq R_1 \preceq \dots \preceq R_{M-1}$ di $M$ simulazioni, l'indice associato al quantile $q \in \{0{,}10, \, 0{,}25, \, 0{,}50, \, 0{,}75, \, 0{,}90\}$ è:

$$k(q) = \text{clamp}\big(\lfloor q \cdot (M - 1) + 0{,}5 \rfloor, \; 0, \; M - 1\big)$$

```typescript
import type { SimResult } from './types';

export type PercentileKey = 'p10' | 'p25' | 'p50' | 'p75' | 'p90';

export type PercentileRuns = Record<PercentileKey, SimResult | null>;

export interface SimStats {
	successRate: number;
	finalPercentiles: Percentiles;
	bands: YearBand[];
	medianRun: SimResult | null; // Mantenuto per retrocompatibilità (= percentileRuns.p50)
	percentileRuns: PercentileRuns;
}

/**
 * Restituisce il numero di anni in cui il portafoglio resta strettamente positivo.
 */
function survivalYears(run: SimResult): number {
	const idx = run.years.findIndex((y) => y.endPortfolio <= 0);
	return idx === -1 ? run.years.length : idx;
}

/**
 * Comparatore che distingue le run esaurite in base a quanto presto finiscono i soldi,
 * e le run sopravvissute in base al patrimonio finale.
 */
export function compareSimRuns(a: SimResult, b: SimResult): number {
	const survA = survivalYears(a);
	const survB = survivalYears(b);
	if (survA !== survB) return survA - survB;
	return a.finalPortfolio - b.finalPortfolio;
}

function pickRunAtQuantile(sortedRuns: SimResult[], q: number): SimResult | null {
	if (sortedRuns.length === 0) return null;
	const idx = Math.min(
		sortedRuns.length - 1,
		Math.max(0, Math.round(q * (sortedRuns.length - 1)))
	);
	return sortedRuns[idx];
}
```

Dentro `computeStats(results: SimResult[]): SimStats`:

```typescript
const sorted = [...results].sort(compareSimRuns);

const percentileRuns: PercentileRuns = {
	p10: pickRunAtQuantile(sorted, 0.10),
	p25: pickRunAtQuantile(sorted, 0.25),
	p50: pickRunAtQuantile(sorted, 0.50),
	p75: pickRunAtQuantile(sorted, 0.75),
	p90: pickRunAtQuantile(sorted, 0.90)
};
```

### 2. Relazioni Contabili della Distinta di Cash-Flow (`YearState`)

Per ogni riga $y$ della tabella dettagliata, le grandezze esposte soddisfano le seguenti relazioni esatte:

1. **Saldo Netto Lavoro / Spese**:
   $$\Delta_{\text{lavoro}} = \text{income} - \text{expenses}$$
   - Se $\Delta_{\text{lavoro}} \ge 0$ (fase di accumulo): $\text{contribution} = \Delta_{\text{lavoro}}$, mentre $\text{withdrawal} = \text{grossSale} = \text{taxPaid} = 0$.
   - Se $\Delta_{\text{lavoro}} < 0$ (fase di decumulo / FIRE): il fabbisogno netto da coprire col portafoglio è $\text{withdrawal} = \min(\text{disponibile netto}, \, \text{expenses} - \text{income})$.
2. **Vendita Lorda e Imposta sul Capital Gain**:
   $$\text{grossSale} = \text{withdrawal} + \text{taxPaid}$$
   L'incidenza fiscale effettiva sul prelievo lordo è:
   $$\tau_{\text{eff}} = \begin{cases} \dfrac{\text{taxPaid}}{\text{grossSale}} & \text{se } \text{grossSale} > 0 \\[6pt] 0 & \text{altrimenti} \end{cases}$$
3. **Evoluzione del Capitale di Portafoglio**:
   $$\text{endPortfolio} = \text{startPortfolio} + \text{investmentReturn} + \text{contribution} - \text{grossSale}$$
4. **Quota di Plusvalenza Latente a Fine Anno**:
   $$G_{\text{latente}} = \max(0, \, \text{endPortfolio} - \text{endCostBasis})$$

### 3. Design UI di `YearTable.svelte`

Nel componente `YearTable.svelte` introduciamo due controlli nella testata della card:
1. **Selettore di Scenario (`selectedPercentile: PercentileKey`)**:
   - `P10 — Pessimistico` (badge rosso/ambra)
   - `P25 — Prudente`
   - `P50 — Mediano` *(default)*
   - `P75 — Favorevole`
   - `P90 — Ottimistico` (badge verde)
2. **Toggle Livello di Dettaglio (`detailedCashFlow: boolean`)**:
   - **Vista Sintetica**: `Anno`, `Età`, `Portafoglio Inizio`, `Reddito`, `Spese`, `Flusso Netto (+Vers. / -Prel.)`, `Rendimento`, `Tasse CG`, `Portafoglio Fine`.
   - **Vista Distinta Completa Cash-Flow**: espande `Flusso Netto` e la fiscalità in colonne dedicate:
     - `Anno` | `Età`
     - `Portafoglio Inizio`
     - `Reddito Lavoro` (`income`)
     - `Spese` (`expenses`)
     - `Versamento` (`+contribution`, testo verde)
     - `Vendita Lorda` (`-grossSale`, testo arancione)
     - `Tasse Pagate` (`-taxPaid`, con percentuale $\tau_{\text{eff}}$ in sottotitolo)
     - `Prelievo Netto` (`withdrawal`)
     - `Rendimento Inv.` (`investmentReturn`, verde/rosso)
     - `Portafoglio Fine` (`endPortfolio`, evidenziato in rosso se $\le 0$)
     - `PMC Residuo` (`endCostBasis`, con % di plusvalenza latente in tooltip)

```svelte
<script lang="ts">
	import type { PercentileKey, PercentileRuns } from '$lib/engine/stats';
	import type { YearState } from '$lib/engine/types';

	interface Props {
		percentileRuns: PercentileRuns;
		initialPercentile?: PercentileKey;
	}

	let { percentileRuns, initialPercentile = 'p50' }: Props = $props();

	let selectedPercentile = $state<PercentileKey>(initialPercentile);
	let showDetailed = $state(false);

	const activeRun = $derived(percentileRuns[selectedPercentile]);
	const years = $derived<YearState[]>(activeRun?.years ?? []);

	const totals = $derived.by(() => {
		return years.reduce(
			(acc, y) => ({
				income: acc.income + y.income,
				expenses: acc.expenses + y.expenses,
				contribution: acc.contribution + y.contribution,
				grossSale: acc.grossSale + y.grossSale,
				taxPaid: acc.taxPaid + y.taxPaid,
				withdrawal: acc.withdrawal + y.withdrawal,
				investmentReturn: acc.investmentReturn + y.investmentReturn
			}),
			{
				income: 0,
				expenses: 0,
				contribution: 0,
				grossSale: 0,
				taxPaid: 0,
				withdrawal: 0,
				investmentReturn: 0
			}
		);
	});
</script>
```

Inoltre, le righe della tabella ricevono una classe semantica:
- `.row-depletion`: per il primo anno in cui `endPortfolio <= 0` (evidenziata con bordo/sfondo rosso tenue e icona ⚠️ *Capitale esaurito*).
- `.row-retirement-start`: per il primo anno in cui `income === 0` dopo anni con `income > 0` (separatore visivo tra fase di Accumulo e fase di Decumulo FIRE).
- **`<tfoot>` con Totali Cumulati**: mostra la somma sull'intero orizzonte di `Reddito`, `Spese`, `Versamenti`, `Vendite Lorde`, `Tasse Pagate` e `Rendimento Complessivo`.

---

## Step di Implementazione

1. **Aggiornamento `src/lib/engine/stats.ts`**:
   - Definire i tipi `PercentileKey` e `PercentileRuns`.
   - Implementare `compareSimRuns` (ordinamento per anni di sopravvivenza + portafoglio finale) e popolare `percentileRuns` dentro `computeStats`.
   - Mantenere `medianRun: percentileRuns.p50` per non rompere alcun test o componente esistente.
2. **Compatibilità con Deflazione (Feature 01)**:
   - Se è presente `transformSimStats` in `src/lib/engine/deflate.ts`, applicare la deflazione anche a tutte le chiavi `p10..p90` di `stats.percentileRuns`.
3. **Rifattorizzazione `src/lib/components/YearTable.svelte`**:
   - Aggiornare le props per accettare `percentileRuns: PercentileRuns` (mantenendo fallback opzionale a `years: YearState[]`).
   - Aggiungere la barra di controllo superiore con i 5 pulsanti `P10 | P25 | P50 | P75 | P90` e lo switch `Distinta Cash-Flow dettagliata`.
   - Aggiungere le colonne `grossSale`, `withdrawal`, `endCostBasis` e il `<tfoot>` con i totali cumulati.
   - Evidenziare visivamente l'anno di transizione al pensionamento e l'eventuale anno di esaurimento del portafoglio.
4. **Aggiornamento `src/App.svelte`**:
   - Passare `percentileRuns={store.stats.percentileRuns}` a `<YearTable>`.

---

## Piano di Test e Verifica

### Unit Test (Vitest — `src/lib/engine/__tests__/stats.test.ts`)
1. **Ordinamento con run fallite (`compareSimRuns`)**:
   - Creare 3 `SimResult` fittizi: Run A che si azzera al 10° anno (`finalPortfolio = 0`), Run B che si azzera al 20° anno (`finalPortfolio = 0`), Run C che sopravvive 30 anni (`finalPortfolio = 150_000`).
   - Verificare che `compareSimRuns` ordini esattamente `Run A < Run B < Run C`.
2. **Popolamento completo di `percentileRuns`**:
   - Con un set di 100 risultati simulati, verificare che `stats.percentileRuns.p10`, `p25`, `p50`, `p75`, `p90` siano tutti non-nulli, che `stats.percentileRuns.p50 === stats.medianRun` e che i rispettivi patrimoni finali (o anni di sopravvivenza) siano monotoni non decrescenti:
     $$P_{10} \preceq P_{25} \preceq P_{50} \preceq P_{75} \preceq P_{90}$$
3. **Coerenza contabile intra-traiettoria**:
   - Per ciascuna delle 5 run in `percentileRuns`, verificare che per ogni anno $t > 0$ valga `years[t].startPortfolio === years[t - 1].endPortfolio` e `grossSale === withdrawal + taxPaid`.

### Test UI Manuali
1. **Cambio Scenario $P_{10} \leftrightarrow P_{90}$**: Cliccare sui pulsanti `P10`, `P25`, `P50`, `P75`, `P90` sopra la tabella e verificare l'aggiornamento immediato delle righe e dei totali a piè di tabella.
2. **Ispezione Scenario Pessimistico ($P_{10}$) in un piano aggressivo**: Configurare un piano con tasso di successo intorno al $75\text{–}80\%$ (in modo che il $10^\circ$ percentile fallisca). Selezionare `P10` nella tabella e verificare che l'anno in cui `Portafoglio Fine` raggiunge $0\text{ €}$ sia evidenziato chiaramente come anno di esaurimento capitale.
3. **Verifica Distinta Cash-Flow**: Attivare il toggle `Distinta Cash-Flow dettagliata` e verificare che durante gli anni di pensionamento la somma `Prelievo Netto + Tasse Pagate` coincida sempre con `Vendita Lorda`, e che `PMC Residuo` decresca proporzionalmente alle vendite effettuate.

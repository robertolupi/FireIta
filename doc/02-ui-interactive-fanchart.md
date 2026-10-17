# 02 — FanChart Interattivo con Crosshair, Tooltip, Marker di Eventi e Soglia Target FIRE

## Obiettivo e Motivazione

Il componente `FanChart.svelte` rappresenta il cuore visivo dell'analisi Monte Carlo in **FireIta**, mostrando l'evoluzione probabilistica del patrimonio tramite le bande di confidenza ($P_{10}\text{–}P_{90}$, $P_{25}\text{–}P_{75}$) e la mediana ($P_{50}$). Attualmente il grafico è un SVG statico: l'utente non può leggere i valori esatti dei percentili in uno specifico anno/età senza scorrere la tabella sottostante, né riesce a correlare visivamente i cambi di pendenza delle curve con gli **eventi di vita** (`LifeEvent`, come l'anno di *Stop Working* / inizio FIRE, una spesa straordinaria o un cambio di tenore di vita) o con una **soglia di capitale target** (FIRE Number).

Rendere il `FanChart` interattivo e annotato risponde a tre esigenze chiave:
1. **Ispezione puntuale (Crosshair + Tooltip)**: Passando il cursore (o trascinando il dito su dispositivi touch) lungo l'asse temporale, l'utente visualizza immediatamente `Anno`, `Età` e l'intera distribuzione dei 5 percentili ($P_{90}, P_{75}, P_{50}, P_{25}, P_{10}$) per quell'anno.
2. **Contestualizzazione temporale (Marker di Eventi)**: Linee verticali tratteggiate e badge sull'asse X evidenziano l'anno effettivo di ritiro dal lavoro (`effectiveStopYear(plan)`) e gli altri `LifeEvent` configurati dall'utente.
3. **Riferimento di obiettivo (Soglia Target FIRE)**: Una linea orizzontale di riferimento mostra il capitale obiettivo (calcolato come $\text{Spese Annue} / \text{SWR}$ o basato sul multiplo delle spese all'anno di pensionamento), permettendo di vedere a colpo d'occhio in quale anno i diversi percentili superano la soglia di indipendenza finanziaria.

---

## Valutazione della Complessità

- **Stima effort**: **Media** (circa 4–6 ore di sviluppo e rifinitura UX/SVG).
- **Impatto architetturale**: **Locale al componente `FanChart.svelte` e al suo punto di invocazione (`App.svelte`)**. Non richiede librerie esterne di charting (Chart.js, D3), mantenendo il bundle leggero e sfruttando la reattività nativa di Svelte 5 sull'SVG custom esistente (`W=800`, `H=320`, `PAD_X=64`, `PAD_Y=28`).
- **File coinvolti**:
  - `src/lib/components/FanChart.svelte` *(aggiunta props `plan`, gestione stato hover, layer SVG per marker/target e tooltip HTML/SVG)*
  - `src/lib/engine/chart-helpers.ts` *(nuovo modulo opzionale con logica pura di mapping coordinate X/Y, snapping all'indice di banda e generazione annotazioni da `Plan`)*
  - `src/App.svelte` *(passaggio della prop `plan` a `<FanChart>`)*
- **Rischi ed Edge Cases**:
  1. **Risorse su vista responsiva (`viewBox` vs pixel reali del DOM)**: Poiché l'SVG ha dimensioni logiche fisse (`W=800`, `H=320`) ma viene ridimensionato via CSS (`width: 100%`), la coordinata `clientX` del mouse non corrisponde direttamente allo spazio SVG. È necessario normalizzare tramite `getBoundingClientRect()`:
     $$x_{\text{svg}} = \frac{\text{clientX} - \text{rect.left}}{\text{rect.width}} \cdot W$$
  2. **Scala Logaritmica (`logScale = true`) e valori $\le 0$**: Quando il portafoglio nei percentili bassi ($P_{10}, P_{25}$) tocca zero o la linea Target FIRE eccede il dominio, la funzione `yScale` deve fare clamping al floor logaritmico (es. $\max(1, v)$) ed evitare valori `NaN` o fuori dal rettangolo di plot (`[PAD_Y, H - PAD_Y]`).
  3. **Sovrapposizione di più `LifeEvent` nello stesso anno**: Se l'utente definisce nello stesso anno sia `stopWorking` sia `oneTimeExpense`, i marker verticali devono essere raggruppati in un unico marcatore con etichetta combinata per evitare collisioni tipografiche.
  4. **Posizionamento del Tooltip ai bordi**: Quando `hoveredIndex` è vicino al margine destro ($x_{\text{svg}} > W - 220$), il tooltip deve ancorarsi a sinistra del crosshair anziché a destra per non uscire dal contenitore.

---

## Design Tecnico e Modifiche ai Dati/Componenti

### 1. Estensione delle Props di `FanChart.svelte`

```typescript
import type { YearBand } from '$lib/engine/stats';
import type { Plan } from '$lib/engine/types';
import type { ValueMode } from '$lib/engine/deflate';

interface Props {
	bands: YearBand[];
	plan: Plan;
	valueMode?: ValueMode;
	swrReference?: number; // Default: 0.04 (regola del 4%, cioè 25x le spese annue)
}

let { bands, plan, valueMode = 'nominal', swrReference = 0.04 }: Props = $props();
```

### 2. Geometria di Snapping e Mapping Coordinate

Dato un array `bands` di lunghezza $N$ ($N \ge 2$), la larghezza utile dell'area di disegno è:

$$W_{\text{plot}} = W - 2 \cdot \text{PAD\_X} = 800 - 128 = 672\text{ px}$$

L'ascissa SVG dell'indice $i \in \{0, \dots, N-1\}$ è:

$$X(i) = \text{PAD\_X} + \frac{i}{N - 1} \cdot W_{\text{plot}}$$

Invertendo la relazione, data una coordinata $x_{\text{svg}}$ ottenuta dall'evento `pointermove`, l'indice di banda più vicino è:

$$i_{\text{snap}} = \text{clamp}\left( \text{round}\left( \frac{x_{\text{svg}} - \text{PAD\_X}}{W_{\text{plot}}} \cdot (N - 1) \right), \; 0, \; N - 1 \right)$$

```typescript
let hoveredIndex = $state<number | null>(null);
let svgElement = $state<SVGSVGElement | null>(null);

function handlePointerMove(e: PointerEvent) {
	if (!svgElement || bands.length === 0) return;
	const rect = svgElement.getBoundingClientRect();
	const xSvg = ((e.clientX - rect.left) / rect.width) * W;
	const plotWidth = W - 2 * PAD_X;

	if (xSvg < PAD_X - 10 || xSvg > W - PAD_X + 10) {
		hoveredIndex = null;
		return;
	}
	if (bands.length === 1) {
		hoveredIndex = 0;
		return;
	}
	const ratio = (xSvg - PAD_X) / plotWidth;
	const idx = Math.round(ratio * (bands.length - 1));
	hoveredIndex = Math.max(0, Math.min(bands.length - 1, idx));
}

function handlePointerLeave() {
	hoveredIndex = null;
}
```

### 3. Estrazione e Raggruppamento dei Marker di Eventi (`ChartMarker`)

Utilizzando `effectiveStopYear(plan)` da `src/lib/engine/projection.ts` e l'array `plan.lifeEvents`, costruiamo una lista derivata di marker raggruppati per anno:

```typescript
import { effectiveStopYear } from '$lib/engine/projection';
import { inflationDivisor } from '$lib/engine/deflate';

export interface ChartMarker {
	year: number;
	bandIndex: number;
	x: number;
	labels: string[];
	isStopWork: boolean;
}

const markers = $derived.by<ChartMarker[]>(() => {
	if (bands.length < 2) return [];
	const byYear = new Map<number, { labels: string[]; isStopWork: boolean }>();

	const stopYear = effectiveStopYear(plan);
	if (stopYear !== null) {
		byYear.set(stopYear, { labels: ['🔥 Ritiro (FIRE)'], isStopWork: true });
	}

	for (const ev of plan.lifeEvents) {
		const entry = byYear.get(ev.year) ?? { labels: [], isStopWork: false };
		const label = ev.label?.trim() || formatEventDefaultLabel(ev);
		if (!entry.labels.includes(label)) {
			entry.labels.push(label);
		}
		if (ev.stopWorking) entry.isStopWork = true;
		byYear.set(ev.year, entry);
	}

	const result: ChartMarker[] = [];
	for (const [year, info] of byYear.entries()) {
		const idx = bands.findIndex((b) => b.year === year);
		if (idx !== -1) {
			result.push({
				year,
				bandIndex: idx,
				x: xScale(idx),
				labels: info.labels,
				isStopWork: info.isStopWork
			});
		}
	}
	return result.sort((a, b) => a.year - b.year);
});
```

### 4. Soglia Target FIRE (Orizzontale o Curva Indicizzata)

Il numero FIRE di riferimento all'anno iniziale $y_0$ è dato da:

$$F_{\text{real}} = \frac{\text{plan.annualExpenses}}{\text{swrReference}} \quad (\text{es. } 25 \times \text{Spese Annue per SWR} = 4\%)$$

- Se `valueMode === 'real'`, la soglia Target FIRE è una **retta orizzontale costante** di valore $F_{\text{real}}$.
- Se `valueMode === 'nominal'`, per mantenere lo stesso potere d'acquisto, la soglia Target FIRE all'anno $y$ cresce con l'inflazione:
  $$F_{\text{nom}}(y) = F_{\text{real}} \cdot (1 + r_{\text{infl}})^{y - y_0}$$
  *(In alternativa, se all'anno $y$ è intervenuto un `LifeEvent` con `setExpenses`, la soglia può adeguarsi al nuovo livello di spesa).*

### 5. Struttura del Layer SVG Interattivo e Tooltip

All'interno di `FanChart.svelte`:

```svelte
<div class="chart-wrapper">
	<svg
		bind:this={svgElement}
		viewBox="0 0 {W} {H}"
		onpointermove={handlePointerMove}
		onpointerleave={handlePointerLeave}
	>
		<!-- 1. Griglia e Bande p10-p90, p25-p75, linea p50 esistenti -->

		<!-- 2. Linea Target FIRE (tratteggiata verde smeraldo) -->
		{#if showFireTarget && fireTargetPath}
			<path d={fireTargetPath} class="fire-target-line" stroke-dasharray="6 4" />
		{/if}

		<!-- 3. Marker Verticali per Eventi di Vita e Stop Work -->
		{#each markers as m (m.year)}
			<g class="event-marker" class:stop-work={m.isStopWork}>
				<line x1={m.x} y1={PAD_Y} x2={m.x} y2={H - PAD_Y} stroke-dasharray="3 3" />
				<text x={m.x} y={PAD_Y - 6} text-anchor="middle" class="marker-badge">
					{m.labels.join(' • ')}
				</text>
			</g>
		{/each}

		<!-- 4. Crosshair e Punti Attivi sull'anno in Hover -->
		{#if hoveredBand && hoveredX !== null}
			<line
				x1={hoveredX}
				y1={PAD_Y}
				x2={hoveredX}
				y2={H - PAD_Y}
				class="crosshair-line"
			/>
			{#each [hoveredBand.p90, hoveredBand.p75, hoveredBand.p50, hoveredBand.p25, hoveredBand.p10] as val, i}
				<circle cx={hoveredX} cy={yScale(val)} r={i === 2 ? 4.5 : 3} class="crosshair-dot dot-{i}" />
			{/each}
		{/if}
	</svg>

	<!-- 5. Tooltip HTML flottante ancorato alla posizione percentuale X -->
	{#if hoveredBand && hoveredX !== null}
		<div
			class="chart-tooltip"
			class:flip-left={hoveredX > W * 0.62}
			style="left: {(hoveredX / W) * 100}%;"
		>
			<div class="tooltip-header">
				<strong>Anno {hoveredBand.year}</strong>
				<span>Età {hoveredBand.age}</span>
			</div>
			<ul class="tooltip-list">
				<li class="p90"><span>P90 (Ottimistico):</span> <strong>{formatCurrency(hoveredBand.p90)}</strong></li>
				<li class="p75"><span>P75:</span> <strong>{formatCurrency(hoveredBand.p75)}</strong></li>
				<li class="p50"><span>P50 (Mediana):</span> <strong>{formatCurrency(hoveredBand.p50)}</strong></li>
				<li class="p25"><span>P25:</span> <strong>{formatCurrency(hoveredBand.p25)}</strong></li>
				<li class="p10"><span>P10 (Pessimistico):</span> <strong>{formatCurrency(hoveredBand.p10)}</strong></li>
			</ul>
		</div>
	{/if}
</div>
```

---

## Step di Implementazione

1. **Creazione helper geometrici e di annotazione**: Creare `src/lib/engine/chart-helpers.ts` con funzioni pure e testabili per:
   - `snapBandIndex(xSvg, width, padX, count)`
   - `extractChartMarkers(plan, bands)`
   - `computeFireTargetSeries(plan, bands, valueMode, swr)`
2. **Aggiornamento interfaccia `FanChart.svelte`**: Aggiungere le props `plan` e `valueMode`, oltre a un checkbox/toggle locale nella barra del grafico (`Mostra Target FIRE 4%` e `Mostra Eventi`) accanto allo switch `Scala Logaritmica` esistente.
3. **Rendering di Marker e Soglia FIRE**: Disegnare nel layer SVG i `<g class="event-marker">` e la curva/linea della soglia FIRE, verificando che l'asse Y includa opzionalmente la soglia nel calcolo di `maxVal` (oppure la clippi se fuori scala).
4. **Implementazione Crosshair e Tooltip**: Aggiungere i listener `onpointermove` e `onpointerleave` sull'`<svg>`, i cerchi indicatori sui 5 percentili dell'anno selezionato e il pannello HTML assoluto `.chart-tooltip` con inversione automatica sinistra/destra (`flip-left`).
5. **Collegamento in `src/App.svelte`**: Passare `plan={store.plan}` e `valueMode={store.valueMode}` a `<FanChart>`.

---

## Piano di Test e Verifica

### Unit Test (Vitest — `src/lib/engine/__tests__/chart-helpers.test.ts`)
1. **Snapping dell'indice**:
   - Con `W = 800`, `PAD_X = 64` e `N = 31` bande (30 anni), verificare che `xSvg = 64` restituisca `0`, `xSvg = 736` restituisca `30` e `xSvg = 400` (centro) restituisca `15`.
   - Verificare che coordinate fuori margine (`xSvg < 50` o `xSvg > 750`) restituiscano `null`.
2. **Estrazione e deduplicazione Marker**:
   - Dato un `Plan` con `stopWorkAge` corrispondente all'anno `2038` e un `LifeEvent` nel `2038` con `oneTimeExpense: 30000` e `label: 'Acquisto auto'`, verificare che `extractChartMarkers` produca un solo marker per il `2038` con `isStopWork === true` e `labels` contenente entrambe le voci.
3. **Serie Target FIRE Reale vs. Nominale**:
   - Con `annualExpenses = 24_000` e `swr = 0.04`, verificare che in modalità `'real'` il target sia $600.000\text{ €}$ per ogni anno, mentre in modalità `'nominal'` cresca come $600.000 \cdot (1 + r_{\text{infl}})^t$.

### Test UI Manuali
1. **Esplorazione cursore e bordi**: Muovere il mouse dal primo all'ultimo anno del `FanChart` e verificare che il tooltip segua il crosshair senza mai essere tagliato dal bordo destro della card.
2. **Compatibilità Scala Logaritmica**: Attivare la scala logaritmica e verificare che i 5 pallini del crosshair rimangano perfettamente centrati sulle rispettive curve $P_{10}\dots P_{90}$ e che la linea Target FIRE si posizioni alla quota logaritmica corretta.
3. **Verifica Marker dinamici**: Aggiungere o spostare un `LifeEvent` nella sidebar di configurazione e verificare che la linea verticale tratteggiata sul grafico si sposti istantaneamente sull'anno corrispondente.

# 08 — Backtesting Storico e Block Bootstrap (Serie Storiche Reali e Inflazione Stocastica)

## 1. Obiettivo e Motivazione

L'attuale motore Monte Carlo (`src/lib/engine/montecarlo.ts`) e il motore di proiezione (`src/lib/engine/projection.ts`) presentano tre limiti strutturali quando vengono impiegati per valutare la sostenibilità di un piano FIRE su orizzonti di 30–50 anni:

1. **Campionamento i.i.d. Log-Normale dei Rendimenti (`sampleAnnualReturn`)**:
   Attualmente ogni anno $t$ viene campionato in modo indipendente e identicamente distribuito (i.i.d.) da una distribuzione log-normale con media `plan.meanReturn` e deviazione standard `plan.returnStdDev`. Nella realtà dei mercati finanziari:
   - I rendimenti mostrano **code grasse (fat tails / leptocurtosi)** e asimmetria negativa nei crolli (es. 1929, 1973–1974, 2000–2002, 2008);
   - Esistono cicli pluriennali di **mean-reversion** e cluster di volatilità (autocorrelazione seriale) che una serie i.i.d. non cattura.
2. **Inflazione Fissa e Deterministica (`plan.inflationRate`)**:
   In `runProjection(plan, returns)`, l'inflazione è una costante scalare applicata con legge esponenziale $(1 + \text{plan.inflationRate})^{\text{year}}$. Questo ignora completamente il rischio più letale per un pensionato FIRE: la **stagflazione** (anni consecutivi di rendimenti reali fortemente negativi combinati con fiammate inflattive, come il decennio 1973–1982 in Italia e negli USA o il biennio 2021–2022).
3. **Assenza di Correlazione Congiunta (Rendimento Azionario, Rendimento Obbligazionario, Inflazione)**:
   Nei periodi di shock inflattivo, sia le azioni sia le obbligazioni possono subire drawdown simultanei mentre il costo della vita (`expenses`) accelera in modo permanente. Campionare il rendimento senza campionare contemporaneamente l'inflazione dello stesso periodo storico sottostima drasticamente il *Sequence of Returns Risk* (SORR).

L'obiettivo di questo documento è progettare:
- Un **dataset storico annuale integrato** (`src/lib/engine/historicalData.ts`) con rendimenti nominali azionari, obbligazionari e tasso di inflazione annuale;
- Il supporto a un **vettore di inflazione annuale variabile** `inflations?: number[]` in `runProjection(plan, returns, inflations?)`, preservando al 100% la retrocompatibilità quando `inflations` non è passato;
- Due nuove modalità di simulazione in `montecarlo.ts`:
  1. **Rolling Historical Backtest** (tutte le finestre storiche contigue di lunghezza $H$, in stile *Trinity Study* / *cFIREsim*);
  2. **Block Bootstrap (Moving / Stationary Block Bootstrap)** con blocchi contigui di lunghezza $k$ (es. $k = 5$ anni) dove la tupla $(\text{rendimento}_t, \text{inflazione}_t)$ viene campionata congiuntamente per preservare sia l'autocorrelazione multi-annuale sia la correlazione incrociata rendimento–inflazione.

---

## 2. Valutazione della Complessità

| Dimensione | Valutazione | Note Tecniche |
| :--- | :--- | :--- |
| **Stima Effort** | **Media** (2 giorni uomo) | La modifica a `projection.ts` per l'inflazione cumulativa vettoriale richiede attenzione all'interazione con gli eventi `setExpenses`; gli algoritmi di Rolling Window e Block Bootstrap sono puri, veloci e deterministici tramite il PRNG `mulberry32` già presente. |
| **Impatto Architetturale** | **Basso** | Si aggiunge un modulo statico `src/lib/engine/historicalData.ts` (zero fetch di rete a runtime, bundle leggero < 5 KB) e si estende `runProjection` con un 3° parametro opzionale `inflations?: number[]`. |
| **File Coinvolti** | `src/lib/engine/types.ts`<br>`src/lib/engine/historicalData.ts` (nuovo)<br>`src/lib/engine/projection.ts`<br>`src/lib/engine/montecarlo.ts`<br>`src/lib/engine/__tests__/historical-bootstrap.test.ts` (nuovo) | Nessuna rottura delle firme esistenti: `runProjection(plan, returns)` e `runMonteCarlo(plan)` mantengono il comportamento di default se non viene specificato `simulationMode`. |
| **Compatibilità coi Test Esistenti** | **100% Retrocompatibile** | Quando `inflations` è omesso in `runProjection`, il fattore cumulativo di inflazione coincide al bit (entro `1e-12`) con `Math.pow(1 + plan.inflationRate, year - expensesBaseYear)`. |

---

## 3. Design Tecnico e Modello Matematico

### 3.1 Fattore di Inflazione Cumulativo con Vettore `inflations?: number[]`

Attualmente in `src/lib/engine/projection.ts` (riga 75 e riga 122), le spese e il tetto `percentCap` sono calcolati con un tasso costante $\pi = \text{plan.inflationRate}$:

$$\text{expenses}_t = E_{\text{base}} \cdot (1 + \pi)^{t - t_{\text{base}}}, \qquad \text{cap}_t = \text{retirementBase} \cdot (1 + \pi)^{t - t_{\text{stop}}}$$

Con l'introduzione di un vettore di tassi di inflazione annuali $\boldsymbol{\pi} = [\pi_0, \pi_1, \dots, \pi_{H-1}]$ (`inflations?: number[]`), dove $\pi_s = \text{inflations}[s] ?? \text{plan.inflationRate}$, definiamo l'**indice dei prezzi cumulativo** $I_t$ all'inizio dell'anno $t$:

$$I_0 = 1, \qquad I_t = \prod_{s=0}^{t-1} (1 + \pi_s) \quad \text{per } t \ge 1$$

In questo modo:
- Nell'anno $t = 0$ (anno iniziale del piano), le spese non hanno ancora subito inflazione: $I_0 = 1 \implies \text{expenses}_0 = E_{\text{base}}$, esattamente come $(1 + \pi)^0 = 1$.
- Nell'anno $t > 0$, il fattore di rivalutazione cumulativa tra un qualsiasi anno di riferimento $t_{\text{ref}} \le t$ (es. $t_{\text{base}} = \text{expensesBaseYear}$ oppure $t_{\text{stop}} = \text{stop}$) e l'anno corrente $t$ è dato dal rapporto degli indici:

$$\Phi(t_{\text{ref}}, t) = \frac{I_t}{I_{t_{\text{ref}}}} = \prod_{s = t_{\text{ref}}}^{t - 1} (1 + \pi_s)$$

Con questa formulazione:
1. **Spese correnti nell'anno $t$**:
   $$\text{expenses}_t = E_{\text{base}} \cdot \Phi(t_{\text{base}}, t) = E_{\text{base}} \cdot \prod_{s = t_{\text{base}}}^{t - 1} (1 + \pi_s)$$
2. **Tetto di prelievo `percentCap` nell'anno $t \ge t_{\text{stop}}$**:
   $$\text{cap}_t = \text{retirementBase} \cdot \Phi(t_{\text{stop}}, t) = \text{retirementBase} \cdot \prod_{s = t_{\text{stop}}}^{t - 1} (1 + \pi_s)$$
3. **Caso particolare di inflazione costante ($\pi_s = \pi \;\forall s$)**:
   $$\Phi(t_{\text{ref}}, t) = (1 + \pi)^{t - t_{\text{ref}}}$$
   che coincide esattamente con la formula originale.

---

### 3.2 Costruzione del Rendimento Nominale di Portafoglio dalla Serie Storica

Ogni record annuale della serie storica $y \in \{1, \dots, N_{\text{hist}}\}$ contiene la tripla:

$$\mathbf{x}_y = \left(r_{\text{eq}, y},\; r_{\text{bond}, y},\; \pi_y\right)$$

dove:
- $r_{\text{eq}, y}$ è il rendimento totale nominale azionario nell'anno storico $y$ (comprensivo di dividendi);
- $r_{\text{bond}, y}$ è il rendimento totale nominale obbligazionario nell'anno storico $y$ (comprensivo di cedole);
- $\pi_y$ è il tasso di inflazione al consumo (CPI / FOI ISTAT) registrato nello stesso anno storico $y$.

Dato il peso azionario del portafoglio $w_{\text{eq}} \in [0, 1]$ (`stockAllocation`, default `1.0` se non specificato, con peso obbligazionario $w_{\text{bond}} = 1 - w_{\text{eq}}$), assumendo ribilanciamento annuale:

$$r_y = w_{\text{eq}} \cdot r_{\text{eq}, y} + (1 - w_{\text{eq}}) \cdot r_{\text{bond}, y}$$

> **Preservazione della Correlazione Congiunta**: Quando viene campionato l'anno storico $y$, il motore estrae **simultaneamente** la coppia $(r_y, \pi_y)$. In tal modo, se l'anno storico $y$ è il 1974 (crollo azionario e inflazione vicina al 20%), la simulazione subisce nello stesso anno `year` sia il rendimento negativo $r_y$ sul portafoglio sia lo shock inflattivo $\pi_y$ sulle spese.

---

### 3.3 Modalità 1: Rolling Historical Backtest (`historicalRolling`)

Sia $N_{\text{hist}}$ il numero totale di anni presenti nel dataset storico (es. dal 1928 al 2024, $N_{\text{hist}} = 97$ anni) e sia $H = \text{horizonYears}(\text{plan})$ la durata della simulazione.

- Se $H \le N_{\text{hist}}$, esistono esattamente $M = N_{\text{hist}} - H + 1$ finestre contigue complete:
  $$\mathcal{W}_m = \big[\mathbf{x}_{m},\; \mathbf{x}_{m+1},\; \dots,\; \mathbf{x}_{m+H-1}\big], \qquad m \in \{0, 1, \dots, N_{\text{hist}} - H\}$$
- Se $H > N_{\text{hist}}$ (o se si desiderano esattamente $N_{\text{hist}}$ coorti di partenza con avvolgimento circolare *wrap-around*, come nello standard *cFIREsim*), l'indice storico scorre modulo $N_{\text{hist}}$:
  $$\mathbf{x}_{(m + t) \bmod N_{\text{hist}}}, \qquad t \in \{0, \dots, H-1\}$$
  In particolare, progettiamo il comportamento standard:
  - Se $H \le N_{\text{hist}}$, genera le $M = N_{\text{hist}} - H + 1$ finestre storiche strettamente contigue (senza cuciture artificiali fine-serie/inizio-serie).
  - Se $H > N_{\text{hist}}$, effettua il wrap-around circolare producendo $N_{\text{hist}}$ traiettorie.

---

### 3.4 Modalità 2: Moving Block Bootstrap e Stationary Block Bootstrap (`blockBootstrap`)

Per generare un numero arbitrario `plan.runs` (es. $1.000$ o $10.000$) di traiettorie sintetiche di lunghezza $H$ a partire dalla serie storica di lunghezza $N_{\text{hist}}$, preservando la struttura di autocorrelazione di medio periodo:

#### A. Moving Block Bootstrap (Lunghezza di Blocco Fissa $k$)
1. Si sceglie una dimensione di blocco $k = \text{blockSize} \ge 1$ (default consigliato: $k = 5$ anni).
2. Finché la traiettoria costruita ha lunghezza inferiore a $H$:
   - Si estrae uniformemente tramite `rng()` un indice iniziale di blocco:
     $$i \sim \text{Uniform}\big(\{0, 1, \dots, N_{\text{hist}} - 1\}\big) \quad \text{oppure} \quad i \sim \text{Uniform}\big(\{0, 1, \dots, N_{\text{hist}} - k\}\big)$$
     (Usando l'indicizzazione circolare $(i + j) \bmod N_{\text{hist}}$ per $j = 0, \dots, k-1$, ogni anno storico ha esattamente la stessa probabilità $1/N_{\text{hist}}$ di essere campionato, evitando il bias di sottorappresentazione degli primi e ultimi $k-1$ anni della serie storica!).
   - Si accodano alla traiettoria i $k$ anni storici contigui:
     $$(r_{(i+j) \bmod N_{\text{hist}}},\; \pi_{(i+j) \bmod N_{\text{hist}}}), \qquad j = 0, 1, \dots, k-1$$
3. Si tronca la sequenza risultante esattamente a lunghezza $H$.

#### B. Stationary Block Bootstrap di Politis & Romano (Lunghezza di Blocco Geometrica con Media $k$)
Per evitare discontinuità periodiche a multipli fissi di $k$ anni ($t = k, 2k, 3k, \dots$), lo *Stationary Bootstrap* (Politis & Romano, 1994) estrae il primo anno $i_0 \sim \text{Uniform}(\{0, \dots, N_{\text{hist}} - 1\})$ e, per ogni anno successivo $t = 1, \dots, H-1$:
- Con probabilità $1 - \frac{1}{k}$, prosegue nell'anno storico successivo contiguo: $i_t = (i_{t-1} + 1) \bmod N_{\text{hist}}$;
- Con probabilità $p = \frac{1}{k}$, inizia un nuovo blocco estraendo $i_t \sim \text{Uniform}(\{0, \dots, N_{\text{hist}} - 1\})$.

Entrambe le varianti condividono la stessa interfaccia e possono essere selezionate o testate deterministicamente.

---

### 3.5 Modifiche alle Interfacce TypeScript (`src/lib/engine/types.ts`)

```typescript
export interface HistoricalYearData {
  calendarYear: number
  equityReturn: number
  bondReturn: number
  inflationRate: number
}

export type SimulationMode =
  | { type: 'parametric' } // Default attuale: log-normale i.i.d. + inflazione fissa plan.inflationRate
  | {
      type: 'historicalRolling'
      stockAllocation?: number // 0..1, default 1.0 (o derivato da (1 - whitelistAllocation))
      customDataset?: HistoricalYearData[]
    }
  | {
      type: 'blockBootstrap'
      blockSize: number // es. 5 (anni contigui per blocco)
      stationary?: boolean // false (default): Moving Block Bootstrap a blocchi fissi; true: Politis-Romano
      stockAllocation?: number // 0..1, default 1.0
      customDataset?: HistoricalYearData[]
    }

export interface Plan {
  // ... campi esistenti ...
  simulationMode?: SimulationMode // default: { type: 'parametric' }
}

export interface YearState {
  // ... campi esistenti ...
  returnRate: number
  /** Tasso di inflazione applicato nell'anno (default: plan.inflationRate) */
  inflationRate?: number
  // ...
}
```

---

### 3.6 Modifiche a `src/lib/engine/projection.ts` e `src/lib/engine/montecarlo.ts`

#### Firma aggiornata di `runProjection` in `src/lib/engine/projection.ts`
```typescript
export function runProjection(
  plan: Plan,
  returns: number[],
  inflations?: number[]
): YearState[]
```
All'interno di `runProjection`:
```typescript
// Precalcolo dell'indice cumulativo dei prezzi I[0..horizon]
// I[0] = 1, I[t] = I[t-1] * (1 + inflation_for_year_{t-1})
const priceIndex: number[] = new Array(horizon + 1)
priceIndex[0] = 1
for (let y = 0; y < horizon; y++) {
  const inf = inflations?.[y] ?? plan.inflationRate
  priceIndex[y + 1] = priceIndex[y] * (1 + inf)
}

const inflationFactor = (fromYearIdx: number, toYearIdx: number): number => {
  if (toYearIdx <= fromYearIdx) return 1
  return priceIndex[toYearIdx] / priceIndex[fromYearIdx]
}
```
- Alla riga 75:
  ```typescript
  const expenses = expensesBase * inflationFactor(expensesBaseYear, year)
  ```
- Alla riga 122:
  ```typescript
  const cap = retirementBase * inflationFactor(stop, year)
  ```

#### Funzioni di campionamento in `src/lib/engine/montecarlo.ts`
```typescript
export function sampleBlockBootstrapTrajectory(
  rng: () => number,
  dataset: HistoricalYearData[],
  horizon: number,
  blockSize: number,
  stockAllocation = 1,
  stationary = false
): { returns: number[]; inflations: number[] } {
  const n = dataset.length
  const k = Math.max(1, Math.floor(blockSize))
  const wEq = Math.max(0, Math.min(1, stockAllocation))
  const returns: number[] = []
  const inflations: number[] = []

  if (stationary) {
    let idx = Math.floor(rng() * n)
    for (let t = 0; t < horizon; t++) {
      if (t > 0) {
        idx = rng() < 1 / k ? Math.floor(rng() * n) : (idx + 1) % n
      }
      const row = dataset[idx]
      returns.push(wEq * row.equityReturn + (1 - wEq) * row.bondReturn)
      inflations.push(row.inflationRate)
    }
  } else {
    while (returns.length < horizon) {
      const startIdx = Math.floor(rng() * n)
      for (let j = 0; j < k && returns.length < horizon; j++) {
        const row = dataset[(startIdx + j) % n]
        returns.push(wEq * row.equityReturn + (1 - wEq) * row.bondReturn)
        inflations.push(row.inflationRate)
      }
    }
  }

  return { returns, inflations }
}
```

---

## 4. Step di Implementazione

1. **Creazione di `src/lib/engine/historicalData.ts`**:
   - Definire e popolare la costante `HISTORICAL_MARKET_DATA: HistoricalYearData[]` con la serie storica annuale (1928–2024, azionario globale/USA, obbligazionario decennale e inflazione CPI/FOI, verificata e immutabile).
   - Esportare una funzione helper `computeHistoricalPortfolioReturn(row: HistoricalYearData, stockAllocation: number): number`.

2. **Aggiornamento di `src/lib/engine/types.ts`**:
   - Aggiungere `HistoricalYearData` e `SimulationMode`.
   - Aggiungere `simulationMode?: SimulationMode` a `Plan` e `inflationRate?: number` a `YearState`.

3. **Aggiornamento di `src/lib/engine/projection.ts`**:
   - Aggiornare la firma in `export function runProjection(plan: Plan, returns: number[], inflations?: number[]): YearState[]`.
   - Costruire il vettore `priceIndex` e la funzione `inflationFactor(fromYearIdx, toYearIdx)` e usarla per `expenses`, `percentCap` e qualsiasi calcolo indicizzato all'inflazione.

4. **Aggiornamento di `src/lib/engine/montecarlo.ts`**:
   - Implementare `runHistoricalRolling(plan, dataset, stockAllocation)` e `sampleBlockBootstrapTrajectory(...)`.
   - In `runMonteCarlo(plan)`, instradare l'esecuzione in base a `plan.simulationMode?.type ?? 'parametric'`:
     - `'parametric'`: comportamento attuale invariato.
     - `'historicalRolling'`: esegue `runProjection(plan, returns, inflations)` su ciascuna finestra storica.
     - `'blockBootstrap'`: esegue `plan.runs` simulazioni campionando blocchi di lunghezza `blockSize` con `mulberry32(plan.seed)` e passando sia `returns` sia `inflations` a `runProjection`.

5. **Creazione della suite di test `src/lib/engine/__tests__/historical-bootstrap.test.ts`**:
   - Implementare i test deterministici descritti nella Sezione 5.

---

## 5. Piano di Test e Verifica

Tutti i test sono deterministici e verificabili tramite `npx vitest run`.

### Caso di Test 1: Equivalenza Esatta tra `inflations` Costante e `plan.inflationRate`
- **Setup**: Piano con `inflationRate = 0.03`, `horizon = 10`, evento `setExpenses` all'anno 4.
- **Verifica**:
  - `runProjection(plan, returns)` e `runProjection(plan, returns, Array(10).fill(0.03))` producono gli stessi identici valori di `expenses`, `withdrawal` ed `endPortfolio` in tutti i 10 anni (entro `1e-12`).

### Caso di Test 2: Shock Stagflattivo con Vettore `inflations` Variabile e `setExpenses`
- **Setup**: `annualExpenses = 10_000`, `inflations = [0.10, 0.20, 0.00]`, `returns = [-0.15, -0.10, 0.05]`.
- **Verifica**:
  - Anno 0: `expenses = 10_000` ($I_0 = 1$).
  - Anno 1: `expenses = 10_000 * 1.10 = 11_000` ($I_1 = 1{,}10$).
  - Anno 2: `expenses = 10_000 * 1.10 * 1.20 = 13_200` ($I_2 = 1{,}32$).
  - Se c'è un `setExpenses` a `startYear + 1` con `amount = 20_000`, all'anno 1 `expenses = 20_000` e all'anno 2 `expenses = 20_000 * 1.20 = 24_000`.

### Caso di Test 3: Rolling Historical Backtest su Mini-Dataset Sintetico
- **Setup**: `customDataset` di 6 anni con valori noti, piano con `horizon = 4`, `simulationMode = { type: 'historicalRolling', stockAllocation: 0.6, customDataset }`.
- **Verifica**:
  - `runMonteCarlo(plan)` restituisce esattamente $6 - 4 + 1 = 3$ `SimResult` (finestre `[0..3]`, `[1..4]`, `[2..5]`).
  - Per ciascuna finestra, `result.years[t].returnRate` è esattamente $0{,}6 \cdot r_{\text{eq}} + 0{,}4 \cdot r_{\text{bond}}$ dell'anno storico corrispondente.

### Caso di Test 4: Preservazione della Contiguità e della Correlazione nel Block Bootstrap
- **Setup**: `customDataset` di 10 anni in cui ogni anno $y \in \{0, \dots, 9\}$ ha `equityReturn = y * 0.01` e `inflationRate = y * 0.005`, `blockSize = 3`, `stationary = false`, `horizon = 6`.
- **Verifica**:
  - In ogni traiettoria generata, per ogni anno $t$: `inflations[t]` è sempre esattamente `0.5 * returns[t]` (correlazione rendimento-inflazione preservata al 100%).
  - All'interno di ogni blocco di 3 anni $(t \in \{0,1,2\}$ e $t \in \{3,4,5\})$, gli indici estratti sono strettamente consecutivi modulo 10: $y_{t+1} \equiv (y_t + 1) \pmod{10}$.

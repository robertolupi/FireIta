# 07 — Fiscalità e Previdenza Italiana Realistica (Imposta di Bollo 0,20%, INPS, Fondo Pensione)

## 1. Obiettivo e Motivazione

Il motore di simulazione attuale (`src/lib/engine/tax.ts` e `src/lib/engine/projection.ts`) modella la fiscalità e i flussi post-ritiro con tre ipotesi semplificatrici che portano a distorsioni sistematiche su orizzonti multi-decennali (30–50 anni) tipici del percorso FIRE in Italia:

1. **Assenza dell'Imposta di Bollo sul Dossier Titoli (0,20% annuo)**: In Italia (D.L. 201/2011, convertito in L. 214/2011 e successive modifiche), gli strumenti finanziari detenuti in un dossier titoli subiscono un'imposta patrimoniale proporzionale dello **0,20% annuo** sul valore di mercato di fine periodo, indipendentemente dalla realizzazione di plusvalenze. A differenza della tassa sul capital gain (`taxRate = 26%`), l'imposta di bollo:
   - Colpisce l'intero controvalore del portafoglio ($P_t$), inclusa la quota di capitale versato (`costBasis`);
   - Si applica sia in fase di accumulo sia in fase di decumulo (anche negli anni con rendimento negativo o nullo);
   - Riduce direttamente il Safe Withdrawal Rate (SWR) sostenibile di circa 15–20 punti base annui (un SWR teorico del 4,0% scende di fatto a ~3,8% solo per effetto del bollo).
2. **Assenza di Entrate Previdenziali Post-Ritiro (Pensione Pubblica INPS e Rendite Ricorrenti)**: Chi raggiunge il FIRE in Italia tra i 40 e i 55 anni affronta tipicamente una **fase di "ponte" (Bridge Phase)** di 15–25 anni in cui il sostentamento dipende al 100% dal portafoglio finanziario, seguita dall'attivazione della pensione pubblica INPS (vecchiaia a 67+ anni o anticipata contributiva) che è rivalutata all'inflazione (perequazione ISTAT). Ignorare l'entrata INPS costringe a sovradimensionare enormemente il capitale FIRE necessario all'età di ritiro (`retirementAge`).
3. **Aliquota Unica sul Capital Gain (26%) e Assenza di Previdenza Complementare (Fondo Pensione / RITA)**:
   - Un portafoglio bilanciato contiene spesso Titoli di Stato ed emittenti sovranazionali *White List* (tassati al **12,5%** anziché al **26%**). Usare un'unica aliquota nominale del 26% sovrastima il carico fiscale sulle vendite.
   - I Fondi Pensione aperti/negoziali offrono deducibilità IRPEF in accumulo (fino a 5.164,57 €/anno), tassazione agevolata sui rendimenti (20% standard, 12,5% su titoli di Stato) e tassazione finale sostitutiva dal **15% fino al 9%** (con riduzione dello 0,30% per ogni anno di partecipazione oltre il 15°), oltre alla **RITA (Rendita Integrativa Temporanea Anticipata)** utilizzabile fino a 5–10 anni prima dell'età di vecchiaia INPS.

L'obiettivo di questo documento è progettare l'estensione di `types.ts`, `tax.ts` e `projection.ts` per supportare in modo nativo, deterministico e retrocompatibile:
- L'imposta di bollo (`stampDutyRate`, default `0.002` nei nuovi piani, `0` di fallback per retrocompatibilità);
- Flussi di reddito ricorrenti post-ritiro (`recurringIncome` / pensione INPS rivalutata all'inflazione) che abbattono il fabbisogno netto da prelevare dal portafoglio;
- L'aliquota effettiva mista azioni/obbligazioni White List (`whitelistAllocation`) e il modulo opzionale Fondo Pensione / RITA (`pensionFund`).

---

## 2. Valutazione della Complessità

| Dimensione | Valutazione | Note Tecniche |
| :--- | :--- | :--- |
| **Stima Effort** | **Media** (2–3 giorni uomo) | La matematica è chiusa e non richiede iterazioni numeriche; l'effort principale risiede nel mantenere la pura trasparenza contabile in `YearState` e l'invarianza dei test esistenti. |
| **Impatto Architetturale** | **Basso / Moderato** | Nessuna dipendenza esterna. La firma di `runProjection(plan, returns)` rimane invariata; tutti i nuovi parametri in `Plan` sono opzionali (`?`) con default neutri (`0` o `undefined`). |
| **File Coinvolti** | `src/lib/engine/types.ts`<br>`src/lib/engine/tax.ts`<br>`src/lib/engine/projection.ts`<br>`src/lib/engine/__tests__/italian-tax-pension.test.ts` (nuovo) | `tax.ts` viene arricchito con il calcolo dell'aliquota effettiva mista e dell'imposta di bollo; `projection.ts` integra i flussi previdenziali prima del calcolo del prelievo dal dossier titoli. |
| **Compatibilità coi Test Esistenti** | **100% Retrocompatibile** | Rendendo opzionali `stampDutyRate`, `whitelistAllocation`, `pensionFund` e i nuovi `LifeEvent` (`recurringIncome`), tutti i test esistenti in `src/lib/engine/__tests__/` continuano a passare senza alcuna modifica. |

---

## 3. Design Tecnico e Modello Matematico

### 3.1 Aliquota Effettiva Mista sul Capital Gain (Azioni 26% vs White List 12,5%)

Sia $w_{\text{wl}} \in [0, 1]$ la frazione del portafoglio investita in obbligazioni governative / sovranazionali *White List* (`whitelistAllocation`), soggetta all'aliquota agevolata $\tau_{\text{wl}} = 0{,}125$, e sia $1 - w_{\text{wl}}$ la quota restante soggetta all'aliquota ordinaria $\tau_{\text{ord}} = \text{plan.taxRate}$ (tipicamente $0{,}26$).

Assumendo un ribilanciamento costante del portafoglio, l'aliquota fiscale effettiva sulle plusvalenze $\tau_{\text{eff}}$ applicata in `sellWithTax` è la media ponderata:

$$\tau_{\text{eff}} = (1 - w_{\text{wl}}) \cdot \tau_{\text{ord}} + w_{\text{wl}} \cdot 0{,}125$$

Quando si effettua una vendita per ottenere una liquidità netta $N$ (`netNeeded`) da un portafoglio di valore $P > 0$ con costo storico fiscale $B$ (`costBasis`), la frazione di plusvalenza latente è:

$$g = \max\left(0, \min\left(1, \frac{P - B}{P}\right)\right)$$

La vendita lorda $G$ (`grossSale`), l'imposta sul capital gain $T_{\text{cg}}$ e il costo storico residuo $B'$ seguono la legge già presente in `sellWithTax`, sostituendo $\tau_{\text{ord}}$ con $\tau_{\text{eff}}$:

$$G = \min\left(P, \frac{N}{1 - \tau_{\text{eff}} \cdot g}\right), \qquad T_{\text{cg}} = \tau_{\text{eff}} \cdot g \cdot G, \qquad B' = B \cdot \frac{P - G}{P}$$

---

### 3.2 Imposta di Bollo sul Dossier Titoli (0,20% Annuo)

L'imposta di bollo sul dossier titoli si applica a fine anno sul valore di mercato del portafoglio con aliquota $b = \text{stampDutyRate}$ (in Italia $b = 0{,}002$, ovvero $0{,}20\%$).

#### Ordine temporale delle operazioni nell'anno $t$ (`projection.ts`)
Nel ciclo annuale di `runProjection`, per coerenza con la struttura attuale:
1. **Fase di accumulo (`!retired`)**: accredito risparmio netto ($P \leftarrow P + \text{net}$, $B \leftarrow B + \text{net}$) o vendita per coprire deficit ed eventuali `oneTimeExpense`.
2. **Rendimento di mercato**:
   $$R_t = P \cdot r_t, \qquad P \leftarrow \max(0, P + R_t)$$
3. **Fase di ritiro (`retired`)**: vendita titoli tramite `sell(...)` per coprire il fabbisogno netto di prelievo.
4. **Addebito dell'Imposta di Bollo a fine anno**:
   Sia $P_{\text{pre-bollo}}$ il valore del portafoglio dopo i prelievi del punto 3. L'imposta di bollo dovuta è:
   $$T_{\text{bollo}, t} = P_{\text{pre-bollo}} \cdot b$$

#### Modalità di pagamento dell'imposta di bollo e impatto sul `costBasis`
Nella realtà bancaria italiana, l'imposta di bollo viene addebitata sul conto corrente d'appoggio (alimentato da liquidità/dividendi o da una micro-vendita titoli). Per mantenere il modello matematico pulito, conservativo e privo di ricorsioni infinite:
- Se l'investitore paga il bollo vendendo una quota del portafoglio tramite `sell(T_bollo)`, si genera anche una micro-tassazione sulla plusvalenza della quota venduta per pagare il bollo, riducendo proporzionalmente il `costBasis`:
  $$\text{sell}(T_{\text{bollo}, t}) \implies G_{\text{bollo}} = \frac{T_{\text{bollo}, t}}{1 - \tau_{\text{eff}} \cdot g}, \qquad P_{\text{fine}} = P_{\text{pre-bollo}} - G_{\text{bollo}}, \qquad B_{\text{fine}} = B \cdot \frac{P_{\text{fine}}}{P_{\text{pre-bollo}}}$$
- In alternativa (approccio diretto patrimoniale consigliato per semplicità e leggibilità nei test), il bollo viene prelevato direttamente dal valore del portafoglio come erosione patrimoniale a fine anno riducendo proporzionalmente il `costBasis` (equivalente a una vendita esente da ulteriore iterazione sul bollo stesso, oppure contabilizzato in `stampDutyPaid` e sommato a `taxPaid`):
  $$T_{\text{bollo}, t} = \min(P_{\text{pre-bollo}}, P_{\text{pre-bollo}} \cdot b)$$
  $$B_{\text{fine}} = B \cdot \left(1 - b\right), \qquad P_{\text{fine}} = P_{\text{pre-bollo}} - T_{\text{bollo}, t}$$
  $$\text{taxPaid}_t \leftarrow \text{taxPaid}_t + T_{\text{bollo}, t}$$

> **Nota di design**: Ridurre proporzionalmente $B_{\text{fine}} = B \cdot (1 - b)$ preserva esattamente la frazione di plusvalenza latente $g = (P - B)/P$ prima e dopo il prelievo del bollo, evitando che il costo storico superi artificialmente il valore del portafoglio o che il bollo diventi implicitamente deducibile dalle plusvalenze future (in Italia l'imposta di bollo **non** genera minusvalenze compensabili nello zainetto fiscale).

---

### 3.3 Entrate Previdenziali Ricorrenti Post-Ritiro (Pensione INPS / Rendite)

Un flusso previdenziale ricorrente (es. pensione di vecchiaia INPS o pensione anticipata) è definito da:
- Anno di inizio erogazione $y_{\text{start}}$ (`fromYear`, es. `birthYear + 67`) e anno opzionale di fine $y_{\text{end}}$ (`toYear`, default $\infty$ per vitalizio INPS);
- Importo annuo netto iniziale $I_0$ (`amount`, espresso in euro reali dell'anno di inizio piano `startYear`, esattamente come `annualExpenses` e `setExpenses`);
- Flag di indicizzazione all'inflazione `inflationAdjusted` (default `true` per pensione INPS perequata ISTAT, `false` per rendite nominali fisse).

Nell'anno di simulazione $t = \text{year} \in [0, \text{horizon}-1]$ (corrispondente a $\text{calendarYear} = \text{startYear} + t$), se $y_{\text{start}} \le \text{calendarYear} \le y_{\text{end}}$, il flusso previdenziale netto $I_{\text{pens}, t}$ è:

$$I_{\text{pens}, t} = \begin{cases}
I_0 \cdot (1 + \pi)^t & \text{se } \text{inflationAdjusted} = \text{true} \\
I_0 & \text{se } \text{inflationAdjusted} = \text{false}
\end{cases}$$

dove $\pi = \text{plan.inflationRate}$.

#### Effetto sul fabbisogno di prelievo in fase di ritiro (`retired`)
Durante la fase di ritiro (`year >= stop`):
- Il reddito totale dell'anno `income` nello stato `YearState` registra la somma delle entrate previdenziali/ricorrenti attive nell'anno $t$:
  $$\text{income}_t = \sum_{k} I_{\text{pens}, k, t}$$
- Sia $E_t = \text{expenses}_t + \text{oneTimeExpenses}_t$ il fabbisogno totale di spesa dell'anno $t$.
- L'entrata previdenziale copre prioritariamente le spese correnti. Il **fabbisogno netto residuo** da coprire tramite il portafoglio è:
  $$E_{\text{net}, t} = \max(0, E_t - \text{income}_t)$$
- Se $\text{income}_t > E_t$ (ossia la pensione INPS supera le spese totali dell'anno), il surplus $\Delta_t = \text{income}_t - E_t$ viene reinvestito nel portafoglio:
  $$\text{contribution}_t = \Delta_t, \qquad P \leftarrow P + \Delta_t, \qquad B \leftarrow B + \Delta_t$$
- Interazione con le strategie di prelievo quando $E_{\text{net}, t} > 0$:
  - **`percentCap`**: il tetto massimo prelevabile dal portafoglio resta $\text{cap}_t = \text{retirementBase} \cdot (1 + \pi)^{t - \text{stop}}$, ma l'importo richiesto al portafoglio è $\min(E_{\text{net}, t}, \text{cap}_t)$. Le spese sono coperte se $\text{income}_t + \text{obtained} \ge E_t - 10^{-9}$.
  - **`guardrails`**: il budget di spesa complessivo consentito dai guardrail è $W_{\text{target}, t} = \text{currentWithdrawal}$, ma poiché $\text{income}_t$ è già fornito dalla pensione, dal portafoglio si preleva solo $\max(0, \text{currentWithdrawal} - \text{income}_t)$ (più eventuali `oneTimeExpenses` non ancora coperte da un eventuale eccedenza della pensione rispetto a `currentWithdrawal`).

---

### 3.4 Modulo Fondo Pensione Complementare e RITA (Opzionale)

Per modellare fedelmente il secondo pilastro previdenziale italiano (`pensionFund?: PensionFundConfig`):

1. **Tassazione finale agevolata ($\tau_{\text{fp}}$)**:
   In base agli anni di adesione $A_t = A_0 + t$ (dove $A_0 = \text{initialSeniorityYears}$):
   $$\tau_{\text{fp}}(A_t) = \max\left(0{,}09,\; 0{,}15 - 0{,}003 \cdot \max(0, A_t - 15)\right)$$
   - Fino a 15 anni di adesione: $\tau_{\text{fp}} = 15\%$.
   - Dal 16° anno in poi: scende dello $0{,}30\%$ all'anno fino al minimo del $9\%$ (raggiunto a $35$ anni di adesione).
2. **Fase di Accumulo (`year < stop`)**:
   - Versamento annuo $C_{\text{fp}} = \text{annualContribution}$ (fino a $5.164{,}57\text{ €}$).
   - Risparmio fiscale IRPEF in busta paga / dichiarazione dei redditi: $S_{\text{irpef}} = \min(C_{\text{fp}}, 5164{,}57) \cdot \tau_{\text{irpef}}$, che riduce l'esborso netto per l'investitore.
   - Il montante del fondo pensione $M_{\text{fp}, t}$ cresce a un tasso netto $\tilde{r}_{\text{fp}, t}$ (tassato annualmente per competenza al 20% sulla componente azionaria e 12,5% sui titoli di Stato).
3. **Erogazione tramite RITA (Rendita Integrativa Temporanea Anticipata)**:
   - Tra l'età `ritaStartAge` (es. 57 anni, fino a 10 anni prima della pensione di vecchiaia) e `ritaEndAge` (es. 67 anni), il montante accumulato nel fondo pensione viene erogato in rate annuali:
     $$N_{\text{anni RITA}} = \text{ritaEndAge} - \text{ age } + 1, \qquad L_{\text{rita}, t} = \frac{M_{\text{fp}, t}}{N_{\text{anni RITA}}}$$
   - La rata netta RITA incassata dall'utente (soggetta a $\tau_{\text{fp}}(A_t)$ sulla parte imponibile dei contributi dedotti, mentre i rendimenti sono già stati tassati anno per anno) si somma a $\text{income}_t$, riducendo i prelievi dal dossier titoli ETF durante gli anni più critici del Sequence of Returns Risk.

---

### 3.5 Modifiche alle Interfacce TypeScript (`src/lib/engine/types.ts`)

```typescript
export type LifeEvent =
  | { kind: 'setExpenses'; fromYear: number; amount: number }
  | { kind: 'oneTimeExpense'; atYear: number; amount: number }
  | { kind: 'stopWorking'; atYear: number }
  | {
      kind: 'recurringIncome'
      fromYear: number
      toYear?: number
      amount: number
      inflationAdjusted?: boolean // default: true (es. Pensione INPS perequata ISTAT)
    }

export interface PensionFundConfig {
  initialBalance: number          // Montante già presente nel fondo pensione a inizio piano
  initialTaxableBase?: number     // Quota del montante soggetta a tassazione finale (contributi dedotti + TFR); default = initialBalance
  initialSeniorityYears: number   // Anni di anzianità pregressa nel fondo pensione a startYear
  annualContribution: number      // Versamento annuo durante la fase di accumulo (es. 5164.57)
  irpefMarginalRate: number       // Aliquota marginale IRPEF per il rimborso da deduzione (es. 0.35 o 0.43)
  returnRateOffset?: number       // Delta rendimento annuo rispetto al portafoglio principale (default 0)
  ritaStartAge: number            // Età di avvio erogazione RITA / rendita (es. 57)
  ritaEndAge: number              // Età di termine RITA (es. 67, coincidente con l'avvio pensione INPS)
}

export interface Plan {
  startYear: number
  birthYear: number
  retirementAge: number
  lifeExpectancyAge: number
  initialPortfolio: number
  initialCostBasis: number
  annualIncome: number
  incomeGrowthRate: number
  annualExpenses: number
  inflationRate: number
  meanReturn: number
  returnStdDev: number
  runs: number
  seed: number
  taxRate: number
  /** Aliquota imposta di bollo annua sul dossier titoli (default 0, tipico Italia: 0.002 = 0,20%) */
  stampDutyRate?: number
  /** Quota di portafoglio in Titoli di Stato White List tassati al 12,5% anziché taxRate (0..1, default 0) */
  whitelistAllocation?: number
  /** Configurazione opzionale Fondo Pensione Complementare / RITA */
  pensionFund?: PensionFundConfig
  withdrawalStrategy: WithdrawalStrategy
  events: LifeEvent[]
}

export interface YearState {
  year: number
  age: number
  calendarYear: number
  phase: 'accumulation' | 'retirement'
  income: number
  expenses: number
  contribution: number
  withdrawal: number
  grossSale: number
  taxPaid: number
  /** Di cui imposta di bollo pagata nell'anno (opzionale o sempre valorizzato >= 0) */
  stampDutyPaid?: number
  /** Saldo residuo del fondo pensione a fine anno (se pensionFund è attivo) */
  pensionFundBalance?: number
  returnRate: number
  investmentReturn: number
  startPortfolio: number
  endPortfolio: number
  endCostBasis: number
  expensesNotCovered: boolean
  depleted: boolean
}
```

---

### 3.6 Modifiche alla Logica in `src/lib/engine/tax.ts`

```typescript
export const WHITELIST_TAX_RATE = 0.125

/**
 * Calcola l'aliquota effettiva sul capital gain combinando l'aliquota ordinaria (es. 26%)
 * e l'aliquota agevolata White List (12,5%) in base a whitelistAllocation.
 */
export function effectiveCapitalGainsTaxRate(
  taxRate: number,
  whitelistAllocation = 0
): number {
  const wl = Math.max(0, Math.min(1, whitelistAllocation))
  return (1 - wl) * taxRate + wl * WHITELIST_TAX_RATE
}

/**
 * Applica l'imposta di bollo patrimoniale a fine anno (es. 0,20%) sul portafoglio,
 * riducendo proporzionalmente il costBasis per mantenere invariata la frazione di plusvalenza.
 */
export function applyStampDuty(
  portfolio: number,
  costBasis: number,
  stampDutyRate = 0
): { remainingPortfolio: number; remainingCostBasis: number; stampDuty: number } {
  if (portfolio <= 0 || stampDutyRate <= 0) {
    return { remainingPortfolio: portfolio, remainingCostBasis: costBasis, stampDuty: 0 }
  }
  const rate = Math.max(0, Math.min(1, stampDutyRate))
  const stampDuty = portfolio * rate
  const remainingPortfolio = portfolio - stampDuty
  const remainingCostBasis = costBasis * (1 - rate)
  return { remainingPortfolio, remainingCostBasis, stampDuty }
}

/**
 * Calcola l'aliquota sostitutiva finale del Fondo Pensione / RITA (dal 15% al 9%
 * con riduzione di 0,30% per ogni anno di partecipazione oltre il 15°).
 */
export function pensionFundTaxRate(seniorityYears: number): number {
  const extraYears = Math.max(0, Math.floor(seniorityYears) - 15)
  return Math.max(0.09, 0.15 - 0.003 * extraYears)
}
```

---

## 4. Step di Implementazione

1. **Estensione di `src/lib/engine/types.ts`**:
   - Aggiungere la variante `{ kind: 'recurringIncome'; fromYear: number; toYear?: number; amount: number; inflationAdjusted?: boolean }` al tipo unione `LifeEvent`.
   - Definire l'interfaccia `PensionFundConfig`.
   - Aggiungere i campi opzionali `stampDutyRate?: number`, `whitelistAllocation?: number` e `pensionFund?: PensionFundConfig` all'interfaccia `Plan`.
   - Aggiungere `stampDutyPaid?: number` e `pensionFundBalance?: number` (opzionali o sempre presenti) a `YearState`.

2. **Aggiornamento di `src/lib/engine/tax.ts`**:
   - Esportare `WHITELIST_TAX_RATE = 0.125`, `effectiveCapitalGainsTaxRate(taxRate, whitelistAllocation)`, `applyStampDuty(portfolio, costBasis, stampDutyRate)` e `pensionFundTaxRate(seniorityYears)`.
   - Mantenere `sellWithTax(portfolio, costBasis, netNeeded, taxRate)` con la stessa identica firma a 4 parametri per non rompere le chiamate dirette in `src/lib/engine/__tests__/tax.test.ts`.

3. **Integrazione in `src/lib/engine/projection.ts`**:
   - All'inizio di `runProjection`, calcolare `const effectiveTaxRate = effectiveCapitalGainsTaxRate(plan.taxRate, plan.whitelistAllocation)` e usarlo nella closure `sell(netNeeded)`.
   - Creare un helper interno `computeRecurringIncome(plan, year, calendarYear)` che somma tutti gli eventi `recurringIncome` attivi nell'anno `calendarYear` (applicando `Math.pow(1 + plan.inflationRate, year)` se `inflationAdjusted !== false`).
   - Se `plan.pensionFund` è configurato:
     - In fase `!retired`: dedurre il contributo netto dal flusso di cassa (o aggiungere il rimborso IRPEF $\min(C_{\text{fp}}, 5164{,}57) \cdot \tau_{\text{irpef}}$) e capitalizzare il montante del fondo pensione.
     - Quando `age >= ritaStartAge && age <= ritaEndAge`: erogare la rata annua RITA al netto di `pensionFundTaxRate(seniorityYears)` sulla quota imponibile e sommarla alle entrate ricorrenti dell'anno.
   - In fase `retired`:
     - Valorizzare `income` con la somma di `recurringIncome` + eventuale rata netta RITA.
     - Ridurre il fabbisogno di prelievo dal portafoglio dell'importo `income` (e, se `income > expenses + oneTimeExpenses`, versare l'eccedenza nel portafoglio come `contribution > 0`).
   - A fine anno (prima del controllo `if (portfolio <= 1e-9)` e del `push` in `states`):
     - Invocare `applyStampDuty(portfolio, costBasis, plan.stampDutyRate ?? 0)`.
     - Aggiornare `portfolio`, `costBasis`, sommare `stampDuty` a `taxPaid` e registrare `stampDutyPaid`.

4. **Creazione della suite di test `src/lib/engine/__tests__/italian-tax-pension.test.ts`**:
   - Scrivere i test unitari e di integrazione descritti nella Sezione 5.

---

## 5. Piano di Test e Verifica

Tutti i test sono deterministici e vanno eseguiti con `npx vitest run`.

### Caso di Test 1: Imposta di Bollo 0,20% con Rendimento Nullo e Guadagno Nullo
- **Setup**: `initialPortfolio = 100_000`, `initialCostBasis = 100_000`, `annualExpenses = 0`, `taxRate = 0.26`, `stampDutyRate = 0.002`, `returns = [0]`.
- **Verifica**:
  - `years[0].endPortfolio` deve essere esattamente $100.000 \times (1 - 0{,}002) = 99.800\text{ €}$.
  - `years[0].endCostBasis` deve essere $99.800\text{ €}$ (la frazione di plusvalenza resta $0\%$).
  - `years[0].taxPaid` deve essere $200\text{ €}$ (`stampDutyPaid = 200`).

### Caso di Test 2: Imposta di Bollo + Vendita in Presenza di Plusvalenza (Conservazione di `gainFraction`)
- **Setup**: `initialPortfolio = 200_000`, `initialCostBasis = 100_000` ($g = 50\%$), `stampDutyRate = 0.002`, `taxRate = 0.26`, `annualExpenses = 10_000`, `returns = [0, 0]`, `withdrawalStrategy = { type: 'percentCap', rate: 0.10 }`.
- **Verifica**:
  - Anno 0: vendita per ottenere $10.000\text{ €}$ netti $\implies G = 10.000 / (1 - 0{,}26 \times 0{,}5) = 11.494{,}25\text{ €}$; $P_{\text{pre-bollo}} = 188.505{,}75\text{ €}$; bollo $= 188.505{,}75 \times 0{,}002 = 377{,}01\text{ €}$.
  - Nell'anno 1 la frazione di plusvalenza $(P - B)/P$ prima della vendita è ancora esattamente $0{,}50$.

### Caso di Test 3: Aliquota Effettiva Mista (60% Azioni al 26% / 40% Titoli di Stato White List al 12,5%)
- **Setup**: `taxRate = 0.26`, `whitelistAllocation = 0.40`.
- **Verifica**:
  - `effectiveCapitalGainsTaxRate(0.26, 0.40)` restituisce $0{,}60 \times 0{,}26 + 0{,}40 \times 0{,}125 = 0{,}156 + 0{,}050 = 0{,}206$ ($20{,}6\%$).
  - Su un portafoglio con `initialPortfolio = 100_000`, `initialCostBasis = 0` ($g = 1$) e spesa netta $7.940\text{ €}$, la vendita lorda è esattamente $10.000\text{ €}$ e `taxPaid = 2_060`.

### Caso di Test 4: Pensione Pubblica INPS Post-Ritiro (`recurringIncome` Indicizzata all'Inflazione)
- **Setup**: Utente in ritiro a 50 anni (`startYear = 2026`, `birthYear = 1976`, `retirementAge = 50`, `lifeExpectancyAge = 70`), `annualExpenses = 30_000`, `inflationRate = 0.02`, evento `{ kind: 'recurringIncome', fromYear: 2043, amount: 20_000, inflationAdjusted: true }` (pensione INPS a 67 anni).
- **Verifica**:
  - Negli anni $0 \dots 16$ (età 50–66): `income = 0`, l'intero fabbisogno rivalutato $30.000 \times (1{,}02)^t$ viene prelevato dal portafoglio.
  - Dall'anno $t = 17$ (`calendarYear = 2043`, età 67): `income` è $20.000 \times (1{,}02)^{17}$, e il prelievo netto dal portafoglio scende a $(30.000 - 20.000) \times (1{,}02)^{17} = 10.000 \times (1{,}02)^{17}$.
  - Se `amount = 35_000` (pensione superiore alle spese), nell'anno 17 `withdrawal = 0` e `contribution = 5_000 * (1.02)^17`.

### Caso di Test 5: Tassazione Fondo Pensione e Ponte RITA (15% $\to$ 9%)
- **Setup**: Verifica di `pensionFundTaxRate(seniorityYears)` per $10, 15, 20, 35, 40$ anni.
- **Verifica**:
  - A 15 anni: $15{,}0\%$; a 20 anni: $13{,}5\%$; a 35+ anni: $9{,}0\%$.
  - Durante gli anni tra `ritaStartAge` e `ritaEndAge`, la rata RITA riduce il prelievo dal dossier titoli ETF evitando la deplezione precoce del portafoglio.

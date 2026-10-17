# 09 — Correzione e Arricchimento delle Strategie di Prelievo (Inflazione su Guardrails, SWR Costante, VPW)

## 1. Obiettivo e Motivazione

L'analisi del modulo `src/lib/engine/projection.ts` (righe 119–159) e della suite `src/lib/engine/__tests__/guardrails.test.ts` evidenzia un bug concettuale nell'attuale implementazione dei *Guardrails* e una carenza di strategie standard nella letteratura FIRE:

1. **Mancata Rivalutazione all'Inflazione nella Strategia `guardrails` (Bug di Erosione Reale)**:
   Attualmente in `projection.ts` (righe 134–143):
   ```typescript
   if (year === stop) {
     currentWithdrawal = strategy.initialRate * startPortfolio
   } else if (portfolio > 0) {
     const effectiveRate = currentWithdrawal / portfolio
     if (effectiveRate < strategy.lowerGuardrail) {
       currentWithdrawal *= 1 + strategy.increasePct
     } else if (effectiveRate > strategy.upperGuardrail) {
       currentWithdrawal *= 1 - strategy.decreasePct
     }
   }
   ```
   Quando il tasso di prelievo effettivo cade nella banda normale $[ \text{lowerGuardrail}, \text{upperGuardrail} ]$, `currentWithdrawal` rimane **nominalmente congelato** al valore dell'anno precedente, mentre `expenses` cresce ogni anno del fattore $(1 + \text{inflationRate})$.
   - **Conseguenza**: Con un'inflazione del 2–3% annuo, anche in un mercato perfettamente stabile che non tocca mai i guardrail, il potere d'acquisto di `currentWithdrawal` crolla del 45% in 20 anni, facendo scattare falsi positivi di `expensesNotCovered = true` nonostante il portafoglio sia in piena salute!
   - **Nella regola originale di Guyton-Klinger (2006)**: all'inizio di ogni anno successivo al primo ($t > \text{stop}$), il prelievo base viene **prima adeguato all'inflazione** (a meno che non si applichi la *Inflation Rule* di Guyton-Klinger che congela l'adeguamento inflattivo dopo un anno con rendimento di mercato negativo) e **poi** confrontato con `lowerGuardrail` e `upperGuardrail`.

2. **Assenza delle Tre Strategie Fondamentali di Confronto FIRE**:
   Attualmente `WithdrawalStrategy` offre solo `percentCap` (che è un ibrido tra bisogno di spesa e tetto SWR) e `guardrails`. Mancano le tre strategie di riferimento usate in tutti i simulatori FIRE internazionali:
   - **`constantDollar` (SWR Puro / Regola del 4% di Bengen)**: preleva esattamente $W_0 = \text{rate} \cdot P_{\text{stop}}$ il primo anno di ritiro e lo rivaluta ogni anno all'inflazione $W_t = W_{t-1} \cdot (1 + \pi_{t-1})$, indipendentemente dall'andamento delle spese base.
   - **`spendExpenses` (Cash-Flow / Expense-Driven)**: preleva esattamente quanto necessario per coprire le spese effettive dell'anno ($\text{expenses}_t + \text{oneTimeExpenses}_t$), senza imporre un tetto artificiale `cap` come fa `percentCap`. È la strategia più naturale per chi modella analiticamente il proprio stile di vita tramite `annualExpenses` e `setExpenses`.
   - **`vpw` (Variable Percentage Withdrawal — Bogleheads)**: calcola ogni anno la percentuale di prelievo ottima in funzione degli **anni di vita residui** $N_{\text{rem}} = \text{horizon} - \text{year}$ e del rendimento reale atteso, azzerando matematicamente il rischio di esaurire il capitale prima di `lifeExpectancyAge` e adattando dinamicamente il tenore di vita al valore corrente del portafoglio.

---

## 2. Valutazione della Complessità

| Dimensione | Valutazione | Note Tecniche |
| :--- | :--- | :--- |
| **Stima Effort** | **Bassa / Media** (1–1,5 giorni uomo) | La logica è interamente confinata nel blocco `if (retired)` di `src/lib/engine/projection.ts` e nelle definizioni di tipo in `src/lib/engine/types.ts`. |
| **Impatto Architetturale** | **Basso** | Si estende l'unione discriminata `WithdrawalStrategy` con 3 nuovi membri (`constantDollar`, `spendExpenses`, `vpw`) e un flag opzionale `skipInflationAfterNegativeReturn?: boolean` su `guardrails`. |
| **File Coinvolti** | `src/lib/engine/types.ts`<br>`src/lib/engine/projection.ts`<br>`src/lib/engine/__tests__/guardrails.test.ts`<br>`src/lib/engine/__tests__/withdrawal-strategies.test.ts` (nuovo) | Nessun impatto su `tax.ts` o `montecarlo.ts`. |
| **Compatibilità coi Test Esistenti** | **100% Compatibile** | In `src/lib/engine/__tests__/guardrails.test.ts`, tutti i test attuali usano `inflationRate: 0`. Poiché per $\pi = 0$ il fattore $(1 + \pi) = 1$, la correzione dell'adeguamento inflattivo nei guardrails **non altera nessuno dei 6 test esistenti** in `guardrails.test.ts`! |

---

## 3. Design Tecnico e Modello Matematico

### 3.1 Correzione della Strategia `guardrails` (Adeguamento Inflattivo + Regola Guyton-Klinger)

Sia $t_{\text{stop}} = \text{stop}$ l'anno di inizio ritiro e sia $\pi_{t-1}$ il tasso di inflazione tra l'anno $t-1$ e l'anno $t$ (pari a `inflations?.[t - 1] ?? plan.inflationRate`).

#### Passo 1: Anno di inizio ritiro ($t = t_{\text{stop}}$)
$$W_{t_{\text{stop}}} = \text{initialRate} \cdot P_{\text{start}, t_{\text{stop}}}$$

#### Passo 2: Anni successivi ($t > t_{\text{stop}}$) con portafoglio $P_t > 0$
1. **Adeguamento all'inflazione (*Guyton-Klinger Inflation Rule*)**:
   Se l'opzione `skipInflationAfterNegativeReturn` è attiva (`true`) e il rendimento del portafoglio nell'anno precedente (o corrente prima del prelievo) è stato negativo ($r_{\text{prev}} < 0$), oppure se l'inflazione è negativa e non si desidera tagliare nominalmente, l'adeguamento inflattivo viene saltato; altrimenti il prelievo viene rivalutato all'inflazione:
   $$\tilde{W}_t = \begin{cases}
   W_{t-1} & \text{se } \text{skipInflationAfterNegativeReturn} = \text{true} \land r_{t-1} < 0 \land \pi_{t-1} > 0 \\
   W_{t-1} \cdot (1 + \pi_{t-1}) & \text{altrimenti}
   \end{cases}$$
2. **Calcolo del tasso di prelievo corrente**:
   $$w_t = \frac{\tilde{W}_t}{P_t}$$
3. **Applicazione dei Guardrail (*Capital Preservation Rule* e *Prosperity Rule*)**:
   $$W_t = \begin{cases}
   \tilde{W}_t \cdot (1 + \text{increasePct}) & \text{se } w_t < \text{lowerGuardrail} \\
   \tilde{W}_t \cdot (1 - \text{decreasePct}) & \text{se } w_t > \text{upperGuardrail} \\
   \tilde{W}_t & \text{se } \text{lowerGuardrail} \le w_t \le \text{upperGuardrail}
   \end{cases}$$

> **Verifica di retrocompatibilità con `guardrails.test.ts`**: Quando `plan.inflationRate === 0` (come in `guardrailsPlan()`), $(1 + \pi_{t-1}) = 1$, quindi $\tilde{W}_t = W_{t-1}$, riproducendo al centesimo tutti i numeri attesi nei test esistenti. Quando invece `plan.inflationRate > 0`, il prelievo mantiene correttamente il potere d'acquisto reale all'interno del corridoio `[lowerGuardrail, upperGuardrail]`.

---

### 3.2 Strategia `constantDollar` (Regola del 4% di Bengen Pura)

A differenza di `percentCap` (che preleva $\min(\text{needed}, \text{cap})$), la strategia `constantDollar` preleva ogni anno l'intero importo previsto dalla regola di Bengen rivalutato all'inflazione, più eventuali spese straordinarie `oneTimeExpenses`:

- All'anno $t = t_{\text{stop}}$:
  $$W_{\text{base}} = \text{rate} \cdot P_{\text{start}, t_{\text{stop}}}$$
- Per ogni anno $t \ge t_{\text{stop}}$:
  $$W_{\text{target}, t} = W_{\text{base}} \cdot \Phi(t_{\text{stop}}, t) = W_{\text{base}} \cdot (1 + \pi)^{t - t_{\text{stop}}}$$
- Vendita dal portafoglio:
  - Si preleva `obtained = sell(W_target,t)` e, separatamente, `oneTimeObtained = sell(oneTimeExpenses)` (oppure in un'unica chiamata `sell(W_target,t + oneTimeExpenses)`).
  - `expensesNotCovered` è `true` se il prelievo ottenuto non riesce a coprire il fabbisogno reale totale:
    $$\text{obtained}_{\text{tot}} < (\text{expenses}_t + \text{oneTimeExpenses}_t) - 10^{-9}$$

---

### 3.3 Strategia `spendExpenses` (Prelievo Guidato dalle Spese Effettive)

La strategia più intuitiva per l'utente che imposta analiticamente il proprio budget annuale (`annualExpenses`, `setExpenses`, `oneTimeExpense`):
- In ogni anno di ritiro $t \ge t_{\text{stop}}$, il fabbisogno netto richiesto al portafoglio è esattamente:
  $$N_t = \text{expenses}_t + \text{oneTimeExpenses}_t$$
  (al netto di eventuali entrate previdenziali descritte nel Documento 07).
- Si esegue `const obtained = sell(N_t)` e si imposta `expensesNotCovered = obtained < N_t - 1e-9`.
- Non viene applicato alcun tetto percentuale né guardrail: il portafoglio soddisfa interamente il tenore di vita finché ha capienza.

---

### 3.4 Strategia `vpw` (Variable Percentage Withdrawal — Formula PMT Attuariale)

Il metodo **VPW (Variable Percentage Withdrawal)** calcola in ogni anno di ritiro $t \ge t_{\text{stop}}$ la frazione di portafoglio $v_t \in (0, 1]$ da prelevare in base a:
- **Anni residui di orizzonte**: $N_{\text{rem}} = \max(1, \text{horizon} - t)$;
- **Tasso di rendimento reale annuo atteso di riferimento** $r_{\text{real}}$: configurabile nella strategia (`realReturnRate`), oppure calcolato di default dal piano tramite l'equazione di Fisher:
  $$r_{\text{real}} = \frac{1 + \text{plan.meanReturn}}{1 + \text{plan.inflationRate}} - 1$$
- **Frazione di eredità / cuscinetto finale desiderata** $f_{\text{legacy}} \in [0, 1]$ (`legacyFraction`, default `0`, cioè ammortamento completo del capitale a `lifeExpectancyAge`).

Dalla formula matematica di una rendita anticipata (annuity-due) a rata reale costante su $N = N_{\text{rem}}$ periodi al tasso reale $r = r_{\text{real}}$:

$$v_t = \begin{cases}
1 - f_{\text{legacy}} & \text{se } N = 1 \\[6pt]
\dfrac{1 - f_{\text{legacy}}}{N} & \text{se } N > 1 \land |r| < 10^{-7} \\[10pt]
\dfrac{r \cdot \left(1 - \dfrac{f_{\text{legacy}}}{(1 + r)^N}\right)}{1 + r - (1 + r)^{-(N - 1)}} & \text{se } N > 1 \land |r| \ge 10^{-7}
\end{cases}$$

> **Nota algebrica**: La formula standard PMT con pagamento a inizio anno ($\text{PV} = 1$, $\text{FV} = 0$, $N$ anni, tasso $r$) è:
> $$v_t = \frac{r}{(1 + r) \cdot \left(1 - (1 + r)^{-N}\right)}$$
> Ad esempio, con $r = 3{,}5\%$ reale e $N = 30$ anni residui, $v_t = \frac{0{,}035}{1{,}035 \cdot (1 - 1{,}035^{-30})} \approx 5{,}25\%$; a $N = 10$ anni residui, $v_t \approx 11{,}62\%$; nell'ultimo anno ($N = 1$ e $f_{\text{legacy}} = 0$), $v_t = 100\%$.

Per evitare oscillazioni estreme nei mercati molto volatili, `vpw` supporta opzionalmente un pavimento `minRate` (es. `0.03`) e un soffitto `maxRate` (es. `0.15` o `1.0`):

$$v_{\text{eff}, t} = \max\big(\text{minRate} ?? 0,\; \min(\text{maxRate} ?? 1,\; v_t)\big), \qquad W_{\text{vpw}, t} = P_t \cdot v_{\text{eff}, t}$$

Come per `guardrails`, le eventuali `oneTimeExpense` sono prelevate separatamente e `expensesNotCovered` viene alzato se il prelievo ottenuto non copre `expenses` o `oneTimeExpenses`.

---

### 3.5 Modifiche alle Interfacce TypeScript (`src/lib/engine/types.ts`)

```typescript
export type WithdrawalStrategy =
  | { type: 'percentCap'; rate: number }
  | { type: 'constantDollar'; rate: number }
  | { type: 'spendExpenses' }
  | {
      type: 'guardrails'
      initialRate: number
      lowerGuardrail: number
      upperGuardrail: number
      increasePct: number
      decreasePct: number
      /** Se true, salta l'adeguamento all'inflazione dopo un anno con rendimento < 0 (Guyton-Klinger Inflation Rule) */
      skipInflationAfterNegativeReturn?: boolean
    }
  | {
      type: 'vpw'
      /** Rendimento reale atteso per la formula PMT (se omesso, usa Fisher su meanReturn e inflationRate) */
      realReturnRate?: number
      /** Frazione del portafoglio da preservare a fine orizzonte (0..1, default 0) */
      legacyFraction?: number
      /** Tasso minimo annuo di prelievo (default 0) */
      minRate?: number
      /** Tasso massimo annuo di prelievo (default 1) */
      maxRate?: number
    }
```

---

### 3.6 Implementazione in `src/lib/engine/projection.ts`

Esportiamo una funzione pura `computeVpwRate` (testabile anche in isolamento) e aggiorniamo il blocco `if (retired)` in `runProjection`:

```typescript
export function computeVpwRate(
  remainingYears: number,
  realReturnRate: number,
  legacyFraction = 0,
  minRate = 0,
  maxRate = 1
): number {
  const n = Math.max(1, Math.floor(remainingYears))
  const f = Math.max(0, Math.min(1, legacyFraction))
  let rate: number
  if (n === 1) {
    rate = 1 - f
  } else if (Math.abs(realReturnRate) < 1e-7) {
    rate = (1 - f) / n
  } else {
    const r = realReturnRate
    const discountN = Math.pow(1 + r, -n)
    rate = (r * (1 - f * discountN)) / ((1 + r) * (1 - discountN))
  }
  return Math.max(minRate, Math.min(maxRate, rate))
}
```

Nel blocco `if (retired)` di `runProjection`:
```typescript
if (retired) {
  let oneTimeExpenses = 0
  for (const event of plan.events) {
    if (event.kind === 'oneTimeExpense' && event.atYear - plan.startYear === year) {
      oneTimeExpenses += event.amount
    }
  }

  const strategy = plan.withdrawalStrategy

  if (strategy.type === 'percentCap') {
    if (year === stop) retirementBase = startPortfolio * strategy.rate
    const cap = retirementBase * Math.pow(1 + plan.inflationRate, year - stop)
    const needed = expenses + oneTimeExpenses
    const obtained = sell(Math.min(needed, cap))
    if (obtained < needed - 1e-9) expensesNotCovered = true
  } else if (strategy.type === 'spendExpenses') {
    const needed = expenses + oneTimeExpenses
    const obtained = sell(needed)
    if (obtained < needed - 1e-9) expensesNotCovered = true
  } else if (strategy.type === 'constantDollar') {
    if (year === stop) retirementBase = startPortfolio * strategy.rate
    const targetWithdrawal = retirementBase * Math.pow(1 + plan.inflationRate, year - stop)
    const obtained = sell(targetWithdrawal)
    const oneTimeObtained = oneTimeExpenses > 0 ? sell(oneTimeExpenses) : 0
    if (obtained < expenses - 1e-9 || oneTimeObtained < oneTimeExpenses - 1e-9) {
      expensesNotCovered = true
    }
  } else if (strategy.type === 'vpw') {
    const remainingYears = Math.max(1, horizon - year)
    const defaultRealReturn = (1 + plan.meanReturn) / (1 + plan.inflationRate) - 1
    const rReal = strategy.realReturnRate ?? defaultRealReturn
    const vpwRate = computeVpwRate(
      remainingYears,
      rReal,
      strategy.legacyFraction ?? 0,
      strategy.minRate ?? 0,
      strategy.maxRate ?? 1
    )
    const targetWithdrawal = portfolio * vpwRate
    const obtained = sell(targetWithdrawal)
    const oneTimeObtained = oneTimeExpenses > 0 ? sell(oneTimeExpenses) : 0
    if (obtained < expenses - 1e-9 || oneTimeObtained < oneTimeExpenses - 1e-9) {
      expensesNotCovered = true
    }
  } else if (strategy.type === 'guardrails') {
    if (year === stop) {
      currentWithdrawal = strategy.initialRate * startPortfolio
    } else if (portfolio > 0) {
      const prevReturn = returns[year - 1] ?? 0
      const skipInflation =
        Boolean(strategy.skipInflationAfterNegativeReturn) &&
        prevReturn < 0 &&
        plan.inflationRate > 0
      if (!skipInflation) {
        currentWithdrawal *= 1 + plan.inflationRate
      }
      const effectiveRate = currentWithdrawal / portfolio
      if (effectiveRate < strategy.lowerGuardrail) {
        currentWithdrawal *= 1 + strategy.increasePct
      } else if (effectiveRate > strategy.upperGuardrail) {
        currentWithdrawal *= 1 - strategy.decreasePct
      }
    }
    const obtained = sell(currentWithdrawal)
    const oneTimeObtained = oneTimeExpenses > 0 ? sell(oneTimeExpenses) : 0
    if (obtained < expenses - 1e-9 || oneTimeObtained < oneTimeExpenses - 1e-9) {
      expensesNotCovered = true
    }
  }
}
```

---

## 4. Step di Implementazione

1. **Aggiornamento di `src/lib/engine/types.ts`**:
   - Estendere `WithdrawalStrategy` con le varianti `'constantDollar'`, `'spendExpenses'`, `'vpw'` e la proprietà opzionale `skipInflationAfterNegativeReturn?: boolean` su `'guardrails'`.

2. **Aggiornamento di `src/lib/engine/projection.ts`**:
   - Esportare la funzione `computeVpwRate(...)`.
   - Nel blocco `if (retired)`, implementare l'adeguamento all'inflazione per `guardrails` prima del test `effectiveRate < lowerGuardrail` / `effectiveRate > upperGuardrail`.
   - Aggiungere i rami `spendExpenses`, `constantDollar` e `vpw`.

3. **Estensione dei Test (`src/lib/engine/__tests__/guardrails.test.ts` e `withdrawal-strategies.test.ts`)**:
   - Verificare che i 6 test esistenti in `guardrails.test.ts` passino senza modifiche.
   - Aggiungere i nuovi test per l'inflazione nei guardrails, la regola Guyton-Klinger `skipInflationAfterNegativeReturn`, `constantDollar`, `spendExpenses` e `vpw`.

---

## 5. Piano di Test e Verifica

Tutti i test sono deterministici e vanno eseguiti con `npx vitest run`.

### Caso di Test 1: `guardrails` con Inflazione Positiva entro il Corridoio (`[lowerGuardrail, upperGuardrail]`)
- **Setup**: `initialPortfolio = 100_000`, `annualExpenses = 4_800`, `inflationRate = 0.02`, `initialRate = 0.05` ($W_0 = 5.000$), `lowerGuardrail = 0.04`, `upperGuardrail = 0.06`, `returns = [0.07, 0.07, 0.07]`.
- **Verifica**:
  - Anno 0: `withdrawal = 5_000`.
  - Anno 1: il prelievo viene rivalutato del $+2\%$ a $5.100\text{ €}$; poiché $5.100 / P_1 \in [0{,}04, 0{,}06]$, non scatta alcun taglio/aumento e `withdrawal = 5_100`.
  - `expensesNotCovered` resta `false` in tutti gli anni perché `currentWithdrawal` tiene il passo con `expenses` ($4.800 \times 1{,}02^t$).

### Caso di Test 2: Regola Guyton-Klinger `skipInflationAfterNegativeReturn`
- **Setup**: Stesso piano del Caso 1, con `skipInflationAfterNegativeReturn: true`, `inflationRate = 0.03`, `returns = [-0.05, 0.06]`.
- **Verifica**:
  - Anno 0: rendimento $-5\%$, `withdrawal = 5_000`.
  - Anno 1: poiché `returns[0] = -0.05 < 0`, l'adeguamento inflattivo del $+3\%$ viene saltato e `currentWithdrawal` rimane $5.000\text{ €}$ (prima della verifica dei guardrail).

### Caso di Test 3: `constantDollar` vs `percentCap`
- **Setup**: `initialPortfolio = 100_000`, `annualExpenses = 3_000`, `inflationRate = 0.02`, `rate = 0.04`, `returns = [0, 0]`.
- **Verifica**:
  - Con `percentCap`: preleva $\min(3.000, 4.000) = 3.000\text{ €}$ all'anno 0.
  - Con `constantDollar`: preleva esattamente $4.000\text{ €}$ all'anno 0 e $4.080\text{ €}$ all'anno 1, anche se `expenses` è inferiore ($3.000\text{ €}$ e $3.060\text{ €}$).

### Caso di Test 4: `spendExpenses` senza Tetto Artificiale
- **Setup**: `initialPortfolio = 100_000`, `annualExpenses = 6_000`, `inflationRate = 0`, `withdrawalStrategy = { type: 'spendExpenses' }`, evento `oneTimeExpense` di $2.000\text{ €}$ all'anno 0.
- **Verifica**:
  - Anno 0: preleva esattamente $8.000\text{ €}$, `expensesNotCovered = false`.
  - Anno 1: preleva esattamente $6.000\text{ €}$, `expensesNotCovered = false`.

### Caso di Test 5: `vpw` (Variable Percentage Withdrawal) lungo l'Orizzonte Residuo
- **Setup**: `initialPortfolio = 100_000`, `retirementAge = 50`, `lifeExpectancyAge = 53` (`horizon = 3` anni), `realReturnRate = 0`, `legacyFraction = 0`, `returns = [0, 0, 0]`, `taxRate = 0`.
- **Verifica**:
  - Anno 0 ($N_{\text{rem}} = 3$): tasso VPW $= 1/3 \implies \text{withdrawal} = 33.333{,}33\text{ €}$, $P_{\text{end}} = 66.666{,}67\text{ €}$.
  - Anno 1 ($N_{\text{rem}} = 2$): tasso VPW $= 1/2 \implies \text{withdrawal} = 33.333{,}33\text{ €}$, $P_{\text{end}} = 33.333{,}33\text{ €}$.
  - Anno 2 ($N_{\text{rem}} = 1$): tasso VPW $= 1/1 \implies \text{withdrawal} = 33.333{,}33\text{ €}$, $P_{\text{end}} = 0\text{ €}$.
  - Con `legacyFraction = 0.25`, all'ultimo anno ($N_{\text{rem}} = 1$) viene prelevato il $75\%$ del portafoglio residuo lasciando esattamente il $25\%$ di eredità finale.

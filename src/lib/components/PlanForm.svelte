<script lang="ts">
  import { planStore } from '../stores/plan.svelte'
  import { effectiveCapitalGainsTaxRate } from '../engine/tax'
  import { HISTORICAL_DATASET_LABELS } from '../engine/historicalData'
  import type { AssetClassId, AssetWeights, MultiAssetConfig, SimulationMode } from '../engine/types'

  const plan = planStore.plan

  let currentAge = $derived(plan.startYear - plan.birthYear)
  let retirementYear = $derived(plan.birthYear + plan.retirementAge)
  let retirementInfo = $derived(
    retirementYear <= plan.startYear ? 'già in pensione' : `pensionamento nel ${retirementYear}`
  )
  let effectiveCgTax = $derived(
    effectiveCapitalGainsTaxRate(plan.taxRate, plan.whitelistAllocation ?? 0)
  )

  function setPercent(
    key:
      | 'incomeGrowthRate'
      | 'inflationRate'
      | 'meanReturn'
      | 'returnStdDev'
      | 'taxRate'
      | 'stampDutyRate'
      | 'whitelistAllocation'
  ) {
    return (e: Event) => {
      plan[key] = Number((e.currentTarget as HTMLInputElement).value) / 100
    }
  }

  function togglePensionFund(e: Event) {
    const checked = (e.currentTarget as HTMLInputElement).checked
    if (checked) {
      plan.pensionFund = {
        initialBalance: 20_000,
        initialSeniorityYears: 10,
        annualContribution: 5164.57,
        irpefMarginalRate: 0.35,
        ritaStartAge: 57,
        ritaEndAge: 67
      }
    } else {
      plan.pensionFund = undefined
    }
  }

  function toggleCashBuffer(e: Event) {
    const checked = (e.currentTarget as HTMLInputElement).checked
    if (checked) {
      plan.cashBuffer = {
        enabled: true,
        yearsOfExpenses: plan.cashBuffer?.yearsOfExpenses ?? 2,
        cashReturnRate: plan.cashBuffer?.cashReturnRate ?? 0.02,
        drawdownThreshold: plan.cashBuffer?.drawdownThreshold ?? 0
      }
    } else if (plan.cashBuffer) {
      plan.cashBuffer.enabled = false
    }
  }

  let ws = $derived(plan.withdrawalStrategy)
  let sm: SimulationMode = $derived(plan.simulationMode ?? { type: 'parametric' })
  let ma = $derived(plan.multiAsset)

  function defaultMultiAsset(): MultiAssetConfig {
    return {
      assets: {
        equity: { id: 'equity', meanReturn: 0.05, returnStdDev: 0.15, taxRate: 0.26 },
        bonds: { id: 'bonds', meanReturn: 0.02, returnStdDev: 0.06, taxRate: 0.125 },
        cash: { id: 'cash', meanReturn: 0.015, returnStdDev: 0.01, taxRate: 0.26 }
      },
      correlations: { equityBonds: -0.1, equityCash: 0, bondsCash: 0.1 },
      glidepath: { type: 'static', weights: { equity: 0.6, bonds: 0.3, cash: 0.1 } },
      rebalance: { mode: 'threshold', band: 0.05 }
    }
  }

  function toggleMultiAsset(e: Event) {
    const checked = (e.currentTarget as HTMLInputElement).checked
    plan.multiAsset = checked ? defaultMultiAsset() : undefined
  }

  function maAssetPercent(id: AssetClassId, key: 'meanReturn' | 'returnStdDev' | 'taxRate') {
    return (e: Event) => {
      if (plan.multiAsset) {
        plan.multiAsset.assets[id][key] = Number((e.currentTarget as HTMLInputElement).value) / 100
      }
    }
  }

  function maCorrPercent(key: 'equityBonds' | 'equityCash' | 'bondsCash') {
    return (e: Event) => {
      if (plan.multiAsset) {
        plan.multiAsset.correlations[key] = Number((e.currentTarget as HTMLInputElement).value) / 100
      }
    }
  }

  type GlidepathWeightsKey = 'weights' | 'accumulationWeights' | 'peakWeights' | 'postTentWeights'

  function setGlidepathType(type: string) {
    if (!plan.multiAsset) return
    if (type === 'bondTent') {
      plan.multiAsset.glidepath = {
        type: 'bondTent',
        accumulationWeights: { equity: 0.8, bonds: 0.2, cash: 0 },
        peakWeights: { equity: 0.4, bonds: 0.5, cash: 0.1 },
        postTentWeights: { equity: 0.7, bonds: 0.3, cash: 0 },
        yearsBeforeRetirement: 5,
        yearsAfterRetirement: 10
      }
    } else {
      plan.multiAsset.glidepath = {
        type: 'static',
        weights: { equity: 0.6, bonds: 0.3, cash: 0.1 }
      }
    }
  }

  function glidepathWeights(key: GlidepathWeightsKey): AssetWeights | null {
    const g = plan.multiAsset?.glidepath
    if (!g) return null
    if (g.type === 'static') return key === 'weights' ? g.weights : null
    return key === 'weights' ? null : g[key]
  }

  function maWeightPercent(key: GlidepathWeightsKey, id: AssetClassId) {
    return (e: Event) => {
      const w = glidepathWeights(key)
      if (w) {
        w[id] = Number((e.currentTarget as HTMLInputElement).value) / 100
      }
    }
  }

  function weightsSumPct(w: AssetWeights): string {
    return ((w.equity + w.bonds + w.cash) * 100).toFixed(0)
  }

  function tentYearsValue(key: 'yearsBeforeRetirement' | 'yearsAfterRetirement'): number {
    const g = plan.multiAsset?.glidepath
    return g?.type === 'bondTent' ? g[key] : 0
  }

  function setTentYears(key: 'yearsBeforeRetirement' | 'yearsAfterRetirement') {
    return (e: Event) => {
      const g = plan.multiAsset?.glidepath
      if (g?.type === 'bondTent') {
        g[key] = Math.max(0, Math.min(30, Math.round(Number((e.currentTarget as HTMLInputElement).value))))
      }
    }
  }

  function setRebalanceMode(mode: string) {
    if (!plan.multiAsset) return
    if (mode === 'cashflowOnly') {
      plan.multiAsset.rebalance = { mode: 'cashflowOnly' }
    } else if (mode === 'annual') {
      plan.multiAsset.rebalance = { mode: 'annual' }
    } else {
      plan.multiAsset.rebalance = { mode: 'threshold', band: 0.05 }
    }
  }

  function setSimulationMode(type: string) {
    const cur = plan.simulationMode
    const carry =
      cur?.type === 'historicalRolling' || cur?.type === 'blockBootstrap' ? cur : undefined
    if (type === 'historicalRolling') {
      plan.simulationMode = {
        type: 'historicalRolling',
        datasetId: carry?.datasetId ?? 'usa',
        stockAllocation: carry?.stockAllocation ?? 1
      }
    } else if (type === 'blockBootstrap') {
      plan.simulationMode = {
        type: 'blockBootstrap',
        datasetId: carry?.datasetId ?? 'usa',
        stockAllocation: carry?.stockAllocation ?? 1,
        blockSize: cur?.type === 'blockBootstrap' ? (cur.blockSize ?? 5) : 5,
        stationary: cur?.type === 'blockBootstrap' ? (cur.stationary ?? false) : false
      }
    } else {
      plan.simulationMode = undefined
    }
  }

  function setSimDataset(e: Event) {
    const val = (e.currentTarget as HTMLSelectElement).value
    const mode = plan.simulationMode
    if (
      (mode?.type === 'historicalRolling' || mode?.type === 'blockBootstrap') &&
      (val === 'usa' || val === 'italia')
    ) {
      mode.datasetId = val
    }
  }

  function setSimStockAllocation(e: Event) {
    const mode = plan.simulationMode
    if (mode?.type === 'historicalRolling' || mode?.type === 'blockBootstrap') {
      mode.stockAllocation = Number((e.currentTarget as HTMLInputElement).value) / 100
    }
  }

  function setSimBlockSize(e: Event) {
    const mode = plan.simulationMode
    if (mode?.type === 'blockBootstrap') {
      mode.blockSize = Math.max(
        1,
        Math.min(20, Math.round(Number((e.currentTarget as HTMLInputElement).value)))
      )
    }
  }

  function setSimStationary(e: Event) {
    const mode = plan.simulationMode
    if (mode?.type === 'blockBootstrap') {
      mode.stationary = (e.currentTarget as HTMLInputElement).checked
    }
  }

  function setStrategy(type: string) {
    if (type === plan.withdrawalStrategy.type) return
    if (type === 'guardrails') {
      plan.withdrawalStrategy = {
        type: 'guardrails',
        initialRate: 0.05,
        lowerGuardrail: 0.04,
        upperGuardrail: 0.06,
        increasePct: 0.1,
        decreasePct: 0.1,
        skipInflationAfterNegativeReturn: false
      }
    } else if (type === 'constantDollar') {
      plan.withdrawalStrategy = { type: 'constantDollar', rate: 0.04 }
    } else if (type === 'spendExpenses') {
      plan.withdrawalStrategy = { type: 'spendExpenses' }
    } else if (type === 'vpw') {
      plan.withdrawalStrategy = {
        type: 'vpw',
        legacyFraction: 0,
        minRate: 0,
        maxRate: 1
      }
    } else {
      plan.withdrawalStrategy = { type: 'percentCap', rate: 0.04 }
    }
  }

  function strategyPercent(
    key:
      | 'rate'
      | 'initialRate'
      | 'lowerGuardrail'
      | 'upperGuardrail'
      | 'increasePct'
      | 'decreasePct'
      | 'legacyFraction'
      | 'minRate'
      | 'maxRate'
  ) {
    return (e: Event) => {
      const strategy = plan.withdrawalStrategy
      const value = Number((e.currentTarget as HTMLInputElement).value) / 100
      if (key === 'rate' && (strategy.type === 'percentCap' || strategy.type === 'constantDollar')) {
        strategy.rate = value
      } else if (
        (key === 'initialRate' ||
          key === 'lowerGuardrail' ||
          key === 'upperGuardrail' ||
          key === 'increasePct' ||
          key === 'decreasePct') &&
        strategy.type === 'guardrails'
      ) {
        strategy[key] = value
      } else if (
        (key === 'legacyFraction' || key === 'minRate' || key === 'maxRate') &&
        strategy.type === 'vpw'
      ) {
        strategy[key] = value
      }
    }
  }
</script>

<section class="card">
  <h2>Piano</h2>

  <fieldset>
    <legend>Profilo</legend>
    <label>
      Anno di nascita
      <input type="number" bind:value={plan.birthYear} min="1900" step="1" />
    </label>
    <label>
      Età di pensionamento
      <input type="number" bind:value={plan.retirementAge} min="0" step="1" />
    </label>
    <label>
      Aspettativa di vita (anni)
      <input type="number" bind:value={plan.lifeExpectancyAge} min="1" step="1" />
    </label>
    <p class="derived">Età attuale: {currentAge} · {retirementInfo}</p>
  </fieldset>

  <fieldset>
    <legend>Patrimonio</legend>
    <label>
      Patrimonio iniziale (€)
      <input type="number" bind:value={plan.initialPortfolio} min="0" step="1000" />
    </label>
    <label>
      Cost basis iniziale (€)
      <input type="number" bind:value={plan.initialCostBasis} min="0" step="1000" />
    </label>
  </fieldset>

  <fieldset>
    <legend>Lavoro</legend>
    <label>
      Entrate annue nette (€)
      <input type="number" bind:value={plan.annualIncome} min="0" step="1000" />
    </label>
    <label>
      Crescita entrate (%/anno)
      <input type="number" value={plan.incomeGrowthRate * 100} oninput={setPercent('incomeGrowthRate')} step="0.5" />
    </label>
  </fieldset>

  <fieldset>
    <legend>Spese</legend>
    <label>
      Spese fisse annue (€)
      <input type="number" bind:value={plan.annualExpenses} min="0" step="500" />
    </label>
    <label>
      Inflazione (%/anno)
      <input type="number" value={plan.inflationRate * 100} oninput={setPercent('inflationRate')} step="0.5" />
    </label>
  </fieldset>

  <fieldset>
    <legend>Prelievo</legend>
    <label>
      Strategia di prelievo
      <select
        value={ws.type}
        onchange={(e) => setStrategy((e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="percentCap">Tetto percentuale</option>
        <option value="constantDollar">SWR costante (Regola 4%)</option>
        <option value="spendExpenses">Spese effettive (senza tetto)</option>
        <option value="guardrails">Guardrails (Guyton-Klinger)</option>
        <option value="vpw">VPW (Percentuale variabile)</option>
      </select>
    </label>
    {#if ws.type === 'percentCap'}
      <label>
        Tetto prelievo (%/anno)
        <input type="number" value={ws.rate * 100} oninput={strategyPercent('rate')} step="0.5" min="0" />
      </label>
    {:else if ws.type === 'constantDollar'}
      <label>
        Prelievo iniziale (%/anno)
        <input type="number" value={ws.rate * 100} oninput={strategyPercent('rate')} step="0.5" min="0" />
      </label>
    {:else if ws.type === 'spendExpenses'}
      <p class="derived">Preleva il fabbisogno netto annuo senza tetto percentuale</p>
    {:else if ws.type === 'vpw'}
      <label>
        Eredità finale (%)
        <input
          type="number"
          value={(ws.legacyFraction ?? 0) * 100}
          oninput={strategyPercent('legacyFraction')}
          step="5"
          min="0"
          max="100"
        />
      </label>
      <label>
        Prelievo minimo (%/anno)
        <input
          type="number"
          value={(ws.minRate ?? 0) * 100}
          oninput={strategyPercent('minRate')}
          step="0.5"
          min="0"
          max="100"
        />
      </label>
      <label>
        Prelievo massimo (%/anno)
        <input
          type="number"
          value={(ws.maxRate ?? 1) * 100}
          oninput={strategyPercent('maxRate')}
          step="1"
          min="0"
          max="100"
        />
      </label>
    {:else if ws.type === 'guardrails'}
      <label>
        Prelievo iniziale (%)
        <input type="number" value={ws.initialRate * 100} oninput={strategyPercent('initialRate')} step="0.5" min="0" />
      </label>
      <label>
        Guardrail inferiore (%)
        <input type="number" value={ws.lowerGuardrail * 100} oninput={strategyPercent('lowerGuardrail')} step="0.5" min="0" />
      </label>
      <label>
        Guardrail superiore (%)
        <input type="number" value={ws.upperGuardrail * 100} oninput={strategyPercent('upperGuardrail')} step="0.5" min="0" />
      </label>
      <label>
        Aumento spesa (%)
        <input type="number" value={ws.increasePct * 100} oninput={strategyPercent('increasePct')} step="1" min="0" />
      </label>
      <label>
        Riduzione spesa (%)
        <input type="number" value={ws.decreasePct * 100} oninput={strategyPercent('decreasePct')} step="1" min="0" />
      </label>
      <label>
        <span>
          <input
            type="checkbox"
            checked={Boolean(ws.skipInflationAfterNegativeReturn)}
            onchange={(e) => {
              if (plan.withdrawalStrategy.type === 'guardrails') {
                plan.withdrawalStrategy.skipInflationAfterNegativeReturn = (
                  e.currentTarget as HTMLInputElement
                ).checked
              }
            }}
          />
          Salta inflazione dopo anno negativo
        </span>
      </label>
    {/if}
  </fieldset>

  <fieldset>
    <legend>Mercato e tasse</legend>
    {#if !ma}
      <label>
        Rendimento medio (%/anno)
        <input type="number" value={plan.meanReturn * 100} oninput={setPercent('meanReturn')} step="0.5" />
      </label>
      <label>
        Deviazione standard (%/anno)
        <input type="number" value={plan.returnStdDev * 100} oninput={setPercent('returnStdDev')} step="0.5" min="0" />
      </label>
    {:else}
      <p class="derived">
        Rendimenti e volatilità sono configurati per asset class nella sezione "Portafoglio
        Multi-Asset".
      </p>
    {/if}
    <label>
      Aliquota plusvalenze ordinaria (%)
      <input type="number" value={plan.taxRate * 100} oninput={setPercent('taxRate')} step="1" min="0" />
    </label>
    {#if !ma}
      <label>
        Quota Titoli White List 12,5% (%)
        <input
          type="number"
          value={(plan.whitelistAllocation ?? 0) * 100}
          oninput={setPercent('whitelistAllocation')}
          step="5"
          min="0"
          max="100"
        />
      </label>
    {/if}
    <label>
      Imposta di bollo dossier (%/anno)
      <input
        type="number"
        value={Number(((plan.stampDutyRate ?? 0) * 100).toFixed(3))}
        oninput={setPercent('stampDutyRate')}
        step="0.05"
        min="0"
      />
    </label>
    {#if !ma && (plan.whitelistAllocation ?? 0) > 0}
      <p class="derived">Aliquota plusvalenze effettiva: {(effectiveCgTax * 100).toFixed(2)}%</p>
    {/if}
  </fieldset>

  <fieldset>
    <legend>Portafoglio Multi-Asset</legend>
    <label>
      <span>
        <input
          type="checkbox"
          checked={Boolean(ma)}
          onchange={toggleMultiAsset}
        />
        Attiva allocazione multi-asset (Azioni / Obbligazioni / Liquidità)
      </span>
    </label>
    {#if ma}
      <div class="ma-grid">
        <span class="ma-head"></span>
        <span class="ma-head">Rend. %/anno</span>
        <span class="ma-head">Dev.std %</span>
        <span class="ma-head">Aliquota %</span>
        <span class="ma-head">Azionario</span>
        <input type="number" value={ma.assets.equity.meanReturn * 100} oninput={maAssetPercent('equity', 'meanReturn')} step="0.5" />
        <input type="number" value={ma.assets.equity.returnStdDev * 100} oninput={maAssetPercent('equity', 'returnStdDev')} step="1" min="0" />
        <input type="number" value={ma.assets.equity.taxRate * 100} oninput={maAssetPercent('equity', 'taxRate')} step="0.5" min="0" />
        <span class="ma-head">Obbligazioni</span>
        <input type="number" value={ma.assets.bonds.meanReturn * 100} oninput={maAssetPercent('bonds', 'meanReturn')} step="0.5" />
        <input type="number" value={ma.assets.bonds.returnStdDev * 100} oninput={maAssetPercent('bonds', 'returnStdDev')} step="1" min="0" />
        <input type="number" value={ma.assets.bonds.taxRate * 100} oninput={maAssetPercent('bonds', 'taxRate')} step="0.5" min="0" />
        <span class="ma-head">Liquidità</span>
        <input type="number" value={ma.assets.cash.meanReturn * 100} oninput={maAssetPercent('cash', 'meanReturn')} step="0.25" />
        <input type="number" value={ma.assets.cash.returnStdDev * 100} oninput={maAssetPercent('cash', 'returnStdDev')} step="0.5" min="0" />
        <input type="number" value={ma.assets.cash.taxRate * 100} oninput={maAssetPercent('cash', 'taxRate')} step="0.5" min="0" />
      </div>
      <div class="ma-grid">
        <span class="ma-head">Correlazioni</span>
        <label>
          Az-Obbl %
          <input type="number" value={ma.correlations.equityBonds * 100} oninput={maCorrPercent('equityBonds')} step="5" min="-99" max="99" />
        </label>
        <label>
          Az-Liq %
          <input type="number" value={ma.correlations.equityCash * 100} oninput={maCorrPercent('equityCash')} step="5" min="-99" max="99" />
        </label>
        <label>
          Obbl-Liq %
          <input type="number" value={ma.correlations.bondsCash * 100} oninput={maCorrPercent('bondsCash')} step="5" min="-99" max="99" />
        </label>
      </div>
      <label>
        Glidepath
        <select
          value={ma.glidepath.type}
          onchange={(e) => setGlidepathType((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="static">Allocazione statica</option>
          <option value="bondTent">Bond Tent (de-risking intorno al FIRE)</option>
        </select>
      </label>
      {#if ma.glidepath.type === 'static'}
        {@const w = ma.glidepath.weights}
        <div class="ma-grid">
          <span class="ma-head">Pesi target</span>
          <label>
            Azioni %
            <input type="number" value={w.equity * 100} oninput={maWeightPercent('weights', 'equity')} step="5" min="0" max="100" />
          </label>
          <label>
            Obbligazioni %
            <input type="number" value={w.bonds * 100} oninput={maWeightPercent('weights', 'bonds')} step="5" min="0" max="100" />
          </label>
          <label>
            Liquidità %
            <input type="number" value={w.cash * 100} oninput={maWeightPercent('weights', 'cash')} step="5" min="0" max="100" />
          </label>
        </div>
        {#if weightsSumPct(w) !== '100'}
          <p class="derived">Somma pesi: {weightsSumPct(w)}% — verrà rinormalizzata a 100%</p>
        {/if}
      {:else}
        {#each [
          { key: 'accumulationWeights', label: 'Accumulo' },
          { key: 'peakWeights', label: 'Picco (anno FIRE)' },
          { key: 'postTentWeights', label: 'Post-tenda' }
        ] as row}
          {@const w = glidepathWeights(row.key as 'accumulationWeights')}
          {#if w}
            <div class="ma-grid">
              <span class="ma-head">{row.label}</span>
              <label>
                Az %
                <input type="number" value={w.equity * 100} oninput={maWeightPercent(row.key as 'accumulationWeights', 'equity')} step="5" min="0" max="100" />
              </label>
              <label>
                Obbl %
                <input type="number" value={w.bonds * 100} oninput={maWeightPercent(row.key as 'accumulationWeights', 'bonds')} step="5" min="0" max="100" />
              </label>
              <label>
                Liq %
                <input type="number" value={w.cash * 100} oninput={maWeightPercent(row.key as 'accumulationWeights', 'cash')} step="5" min="0" max="100" />
              </label>
            </div>
            {#if weightsSumPct(w) !== '100'}
              <p class="derived">Somma {row.label.toLowerCase()}: {weightsSumPct(w)}% — verrà rinormalizzata a 100%</p>
            {/if}
          {/if}
        {/each}
        <label>
          Anni di de-risking prima del FIRE
          <input type="number" value={tentYearsValue('yearsBeforeRetirement')} oninput={setTentYears('yearsBeforeRetirement')} min="0" max="30" step="1" />
        </label>
        <label>
          Anni di risalita azionaria dopo il FIRE
          <input type="number" value={tentYearsValue('yearsAfterRetirement')} oninput={setTentYears('yearsAfterRetirement')} min="0" max="30" step="1" />
        </label>
      {/if}
      <label>
        Ribilanciamento
        <select
          value={ma.rebalance.mode}
          onchange={(e) => setRebalanceMode((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="cashflowOnly">Solo tramite flussi (zero vendite tassate)</option>
          <option value="threshold">A soglia (vendita oltre la banda)</option>
          <option value="annual">Annuale integrale</option>
        </select>
      </label>
      {#if ma.rebalance.mode === 'threshold'}
        <label>
          Banda di tolleranza (±%)
          <input
            type="number"
            value={ma.rebalance.band * 100}
            oninput={(e) => {
              if (plan.multiAsset?.rebalance.mode === 'threshold') {
                plan.multiAsset.rebalance.band = Number((e.currentTarget as HTMLInputElement).value) / 100
              }
            }}
            step="1"
            min="0"
            max="50"
          />
        </label>
      {/if}
    {/if}
  </fieldset>

  <fieldset>
    <legend>Fondo Pensione / RITA</legend>
    <label>
      <span>
        <input
          type="checkbox"
          checked={Boolean(plan.pensionFund)}
          onchange={togglePensionFund}
        />
        Attiva Fondo Pensione / RITA
      </span>
    </label>
    {#if plan.pensionFund}
      <label>
        Montante iniziale (€)
        <input type="number" bind:value={plan.pensionFund.initialBalance} min="0" step="1000" />
      </label>
      <label>
        Anzianità pregressa (anni)
        <input type="number" bind:value={plan.pensionFund.initialSeniorityYears} min="0" step="1" />
      </label>
      <label>
        Versamento annuo in accumulo (€)
        <input type="number" bind:value={plan.pensionFund.annualContribution} min="0" step="100" />
      </label>
      <label>
        Aliquota marginale IRPEF (%)
        <input
          type="number"
          value={plan.pensionFund.irpefMarginalRate * 100}
          oninput={(e) => {
            if (plan.pensionFund) {
              plan.pensionFund.irpefMarginalRate = Number((e.currentTarget as HTMLInputElement).value) / 100
            }
          }}
          step="1"
          min="0"
          max="100"
        />
      </label>
      <label>
        Età avvio RITA
        <input type="number" bind:value={plan.pensionFund.ritaStartAge} min="0" step="1" />
      </label>
      <label>
        Età termine RITA
        <input type="number" bind:value={plan.pensionFund.ritaEndAge} min="0" step="1" />
      </label>
    {/if}
  </fieldset>

  <fieldset>
    <legend>Timing flussi e Cash Buffer</legend>
    <label>
      Timing dei flussi infra-annuali
      <select
        value={plan.cashflowTiming ?? 'legacy'}
        onchange={(e) => {
          const val = (e.currentTarget as HTMLSelectElement).value
          plan.cashflowTiming =
            val === 'startOfYear' || val === 'midYear' ? val : 'legacy'
        }}
      >
        <option value="legacy">Fine anno (Legacy)</option>
        <option value="midYear">Metà anno (Flussi mensili uniformi)</option>
        <option value="startOfYear">Inizio anno (Conservativo)</option>
      </select>
    </label>
    <label>
      <span>
        <input
          type="checkbox"
          checked={Boolean(plan.cashBuffer?.enabled)}
          onchange={toggleCashBuffer}
        />
        Attiva Cuscinetto di Liquidità (Cash Buffer)
      </span>
    </label>
    {#if plan.cashBuffer?.enabled}
      <label>
        Annualità di spese nel buffer
        <input
          type="number"
          bind:value={plan.cashBuffer.yearsOfExpenses}
          min="0.5"
          max="10"
          step="0.5"
        />
      </label>
      <label>
        Rendimento netto liquidità (%/anno)
        <input
          type="number"
          value={Number((plan.cashBuffer.cashReturnRate * 100).toFixed(2))}
          oninput={(e) => {
            if (plan.cashBuffer) {
              plan.cashBuffer.cashReturnRate =
                Number((e.currentTarget as HTMLInputElement).value) / 100
            }
          }}
          step="0.25"
        />
      </label>
      <label>
        Soglia attivazione rendimento azionario (%)
        <input
          type="number"
          value={Number((plan.cashBuffer.drawdownThreshold * 100).toFixed(2))}
          oninput={(e) => {
            if (plan.cashBuffer) {
              plan.cashBuffer.drawdownThreshold =
                Number((e.currentTarget as HTMLInputElement).value) / 100
            }
          }}
          step="1"
        />
      </label>
    {/if}
  </fieldset>

  <fieldset>
    <legend>Simulazione</legend>
    <label>
      Modalità
      <select
        value={sm.type}
        onchange={(e) => setSimulationMode((e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="parametric">Parametrica (Monte Carlo log-normale)</option>
        <option value="historicalRolling">Storico rolling (finestre reali)</option>
        <option value="blockBootstrap">Block bootstrap storico</option>
      </select>
    </label>
    {#if sm.type !== 'parametric'}
      <label>
        Serie storica
        <select value={sm.datasetId ?? 'usa'} onchange={setSimDataset}>
          <option value="usa">{HISTORICAL_DATASET_LABELS.usa}</option>
          <option value="italia">{HISTORICAL_DATASET_LABELS.italia}</option>
        </select>
      </label>
      <label>
        Quota azionaria (%)
        <input
          type="number"
          value={(sm.stockAllocation ?? 1) * 100}
          oninput={setSimStockAllocation}
          min="0"
          max="100"
          step="5"
        />
      </label>
    {/if}
    {#if sm.type === 'blockBootstrap'}
      <label>
        Dimensione blocco (anni)
        <input
          type="number"
          value={sm.blockSize ?? 5}
          oninput={setSimBlockSize}
          min="1"
          max="20"
          step="1"
        />
      </label>
      <label>
        <span>
          <input
            type="checkbox"
            checked={sm.stationary ?? false}
            onchange={setSimStationary}
          />
          Blocchi a lunghezza variabile (Politis-Romano)
        </span>
      </label>
    {/if}
    {#if sm.type === 'historicalRolling'}
      <p class="derived">Il numero di traiettorie è dato dalle finestre storiche disponibili</p>
    {:else}
      <label>
        Numero di run
        <input type="number" bind:value={plan.runs} min="1" max="20000" step="100" />
      </label>
      <label>
        Seed
        <input type="number" bind:value={plan.seed} step="1" />
      </label>
    {/if}
  </fieldset>
</section>

<style>
  .ma-grid {
    display: grid;
    grid-template-columns: minmax(78px, 1.15fr) repeat(3, minmax(0, 1fr));
    gap: 0.35rem 0.45rem;
    align-items: end;
    margin: 0.5rem 0;
  }
  .ma-grid label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.78rem;
    margin: 0;
    min-width: 0;
    white-space: nowrap;
  }
  .ma-grid input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 0.3rem 0.35rem;
    font-size: 0.85rem;
  }
  .ma-head {
    font-size: 0.78rem;
    font-weight: 600;
    color: #444;
    min-width: 0;
    white-space: nowrap;
  }
</style>

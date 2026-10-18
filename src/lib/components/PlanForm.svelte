<script lang="ts">
  import { planStore } from '../stores/plan.svelte'
  import { effectiveCapitalGainsTaxRate } from '../engine/tax'

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
    <label>
      Rendimento medio (%/anno)
      <input type="number" value={plan.meanReturn * 100} oninput={setPercent('meanReturn')} step="0.5" />
    </label>
    <label>
      Deviazione standard (%/anno)
      <input type="number" value={plan.returnStdDev * 100} oninput={setPercent('returnStdDev')} step="0.5" min="0" />
    </label>
    <label>
      Aliquota plusvalenze ordinaria (%)
      <input type="number" value={plan.taxRate * 100} oninput={setPercent('taxRate')} step="1" min="0" />
    </label>
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
    {#if (plan.whitelistAllocation ?? 0) > 0}
      <p class="derived">Aliquota plusvalenze effettiva: {(effectiveCgTax * 100).toFixed(2)}%</p>
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
    <legend>Simulazione Monte Carlo</legend>
    <label>
      Numero di run
      <input type="number" bind:value={plan.runs} min="1" max="20000" step="100" />
    </label>
    <label>
      Seed
      <input type="number" bind:value={plan.seed} step="1" />
    </label>
  </fieldset>
</section>

<script lang="ts">
  import { planStore } from '../stores/plan.svelte'
  import type { LifeEvent } from '../engine/types'
  import { formatEur } from '../format'

  let kind = $state<LifeEvent['kind']>('setExpenses')
  let age = $state(67)
  let toAge = $state<string>('')
  let amount = $state(18_000)
  let inflationAdjusted = $state(true)

  function addEvent() {
    const eventYear = planStore.plan.birthYear + Math.max(0, Math.round(age))
    const eventAmount = Math.max(0, amount)
    let event: LifeEvent
    if (kind === 'setExpenses') {
      event = { kind, fromYear: eventYear, amount: eventAmount }
    } else if (kind === 'oneTimeExpense') {
      event = { kind, atYear: eventYear, amount: eventAmount }
    } else if (kind === 'recurringIncome') {
      const parsedToAge = toAge.trim() !== '' ? Number(toAge) : NaN
      const toYear =
        !Number.isNaN(parsedToAge) && parsedToAge >= age
          ? planStore.plan.birthYear + Math.round(parsedToAge)
          : undefined
      event = {
        kind,
        fromYear: eventYear,
        ...(toYear !== undefined ? { toYear } : {}),
        amount: eventAmount,
        inflationAdjusted
      }
    } else {
      event = { kind, atYear: eventYear }
    }
    planStore.plan.events.push(event)
  }

  function removeEvent(index: number) {
    planStore.plan.events.splice(index, 1)
  }

  function ageOf(calendarYear: number): number {
    return calendarYear - planStore.plan.birthYear
  }

  function describe(event: LifeEvent): string {
    switch (event.kind) {
      case 'setExpenses':
        return `Dall'età ${ageOf(event.fromYear)} (${event.fromYear}): spese fisse a ${formatEur(event.amount)}/anno`
      case 'oneTimeExpense':
        return `Età ${ageOf(event.atYear)} (${event.atYear}): spesa una tantum di ${formatEur(event.amount)}`
      case 'stopWorking':
        return `Età ${ageOf(event.atYear)} (${event.atYear}): smetti di lavorare`
      case 'recurringIncome': {
        const range =
          event.toYear !== undefined
            ? `Età ${ageOf(event.fromYear)}–${ageOf(event.toYear)} (${event.fromYear}–${event.toYear})`
            : `Dall'età ${ageOf(event.fromYear)} (${event.fromYear})`
        const indexing = event.inflationAdjusted !== false ? 'rivalutata ISTAT' : 'nominale fissa'
        return `${range}: entrata ricorrente di ${formatEur(event.amount)}/anno (${indexing})`
      }
    }
  }
</script>

<section class="card">
  <h2>Eventi di vita</h2>

  {#if planStore.plan.events.length === 0}
    <p class="muted">Nessun evento configurato.</p>
  {:else}
    <ul class="events">
      {#each planStore.plan.events as event, i}
        <li>
          <span>{describe(event)}</span>
          <button type="button" class="remove" onclick={() => removeEvent(i)}>Rimuovi</button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="add-event">
    <label>
      Tipo
      <select bind:value={kind}>
        <option value="setExpenses">Cambia spese fisse</option>
        <option value="oneTimeExpense">Spesa una tantum</option>
        <option value="stopWorking">Smetti di lavorare</option>
        <option value="recurringIncome">Pensione INPS / Entrata ricorrente</option>
      </select>
    </label>
    <label>
      {kind === 'recurringIncome' || kind === 'setExpenses' ? 'Da età' : 'Età'}
      <input type="number" bind:value={age} min="0" step="1" />
    </label>
    {#if kind === 'recurringIncome'}
      <label>
        Fino a età (opz.)
        <input type="number" bind:value={toAge} min="0" step="1" placeholder="Vitalizio" />
      </label>
    {/if}
    {#if kind !== 'stopWorking'}
      <label>
        Importo (€)
        <input type="number" bind:value={amount} min="0" step="500" />
      </label>
    {/if}
    {#if kind === 'recurringIncome'}
      <label>
        <span>
          <input type="checkbox" bind:checked={inflationAdjusted} />
          Rivalutata ISTAT
        </span>
      </label>
    {/if}
    <button type="button" onclick={addEvent}>Aggiungi evento</button>
  </div>
</section>

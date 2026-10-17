<script lang="ts">
  import { planStore } from '../stores/plan.svelte'
  import type { LifeEvent } from '../engine/types'
  import { formatEur } from '../format'

  let kind = $state<LifeEvent['kind']>('setExpenses')
  let age = $state(50)
  let amount = $state(10_000)

  function addEvent() {
    const eventYear = planStore.plan.birthYear + Math.max(0, Math.round(age))
    const eventAmount = Math.max(0, amount)
    const event: LifeEvent =
      kind === 'setExpenses'
        ? { kind, fromYear: eventYear, amount: eventAmount }
        : kind === 'oneTimeExpense'
          ? { kind, atYear: eventYear, amount: eventAmount }
          : { kind, atYear: eventYear }
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
      </select>
    </label>
    <label>
      Età
      <input type="number" bind:value={age} min="0" step="1" />
    </label>
    {#if kind !== 'stopWorking'}
      <label>
        Importo (€)
        <input type="number" bind:value={amount} min="0" step="500" />
      </label>
    {/if}
    <button type="button" onclick={addEvent}>Aggiungi evento</button>
  </div>
</section>

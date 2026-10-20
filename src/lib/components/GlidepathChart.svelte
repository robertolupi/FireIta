<script lang="ts">
  import { planStore } from '../stores/plan.svelte'
  import { computeTargetWeights } from '../engine/allocation'
  import { effectiveStopYear, horizonYears } from '../engine/projection'
  import type { AssetClassId } from '../engine/types'

  const W = 640
  const H = 220
  const PAD_L = 40
  const PAD_R = 10
  const PAD_T = 14
  const PAD_B = 26

  const SERIES: { id: AssetClassId; label: string; color: string }[] = [
    { id: 'equity', label: 'Azionario', color: '#1a5fa8' },
    { id: 'bonds', label: 'Obbligazionario', color: '#d97706' },
    { id: 'cash', label: 'Liquidità', color: '#6b7280' }
  ]

  let plan = $derived(planStore.committedPlan)
  let ma = $derived(plan.multiAsset)

  let model = $derived.by(() => {
    if (!ma) return null
    const horizon = horizonYears(plan)
    const stop = effectiveStopYear(plan)
    const points: { calendarYear: number; weights: Record<AssetClassId, number> }[] = []
    for (let t = 0; t < horizon; t++) {
      points.push({ calendarYear: plan.startYear + t, weights: computeTargetWeights(ma.glidepath, t, stop) })
    }
    return { points, stop, horizon }
  })

  function xAt(i: number, horizon: number): number {
    return PAD_L + (i / Math.max(1, horizon - 1)) * (W - PAD_L - PAD_R)
  }
  function yAt(w: number): number {
    return PAD_T + (1 - w) * (H - PAD_T - PAD_B)
  }

  function polyline(points: { weights: Record<AssetClassId, number> }[], id: AssetClassId): string {
    return points.map((p, i) => `${xAt(i, points.length).toFixed(1)},${yAt(p.weights[id]).toFixed(1)}`).join(' ')
  }

  let xTicks = $derived.by(() => {
    if (!model) return []
    const step = Math.max(1, Math.round(model.horizon / 8))
    const ticks: { x: number; label: string }[] = []
    for (let t = 0; t < model.horizon; t += step) {
      ticks.push({ x: xAt(t, model.horizon), label: String(model.points[t].calendarYear) })
    }
    return ticks
  })
</script>

{#if model}
  <section class="card">
    <h2>Glidepath target — allocazione nel tempo</h2>
    <svg viewBox="0 0 {W} {H}" role="img" aria-label="Evoluzione dei pesi target del portafoglio">
      {#each [0, 0.25, 0.5, 0.75, 1] as tick}
        <line class="grid" x1={PAD_L} x2={W - PAD_R} y1={yAt(tick)} y2={yAt(tick)} />
        <text class="tick" x={PAD_L - 6} y={yAt(tick) + 3} text-anchor="end">{tick * 100}%</text>
      {/each}
      {#each xTicks as tick}
        <text class="tick" x={tick.x} y={H - 8} text-anchor="middle">{tick.label}</text>
      {/each}
      <line
        class="retirement"
        x1={xAt(model.stop, model.horizon)}
        x2={xAt(model.stop, model.horizon)}
        y1={PAD_T}
        y2={H - PAD_B}
      />
      <text class="tick retirement-label" x={xAt(model.stop, model.horizon) + 4} y={PAD_T + 10}>FIRE</text>
      {#each SERIES as s}
        <polyline fill="none" stroke={s.color} stroke-width="2" points={polyline(model.points, s.id)} />
      {/each}
    </svg>
    <p class="legend">
      {#each SERIES as s}
        <span class="chip"><span class="swatch" style="background:{s.color}"></span>{s.label}</span>
      {/each}
      <span class="note">Pesi target del glidepath (linea verticale: anno di pensionamento)</span>
    </p>
  </section>
{/if}

<style>
  svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .grid {
    stroke: #e5ecf3;
    stroke-width: 1;
  }
  .tick {
    font-size: 10px;
    fill: #666;
  }
  .retirement {
    stroke: #b3261e;
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
  }
  .retirement-label {
    fill: #b3261e;
    font-weight: 600;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.9rem;
    align-items: center;
    font-size: 0.8rem;
    color: #444;
    margin: 0.5rem 0 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .swatch {
    display: inline-block;
    width: 0.8rem;
    height: 0.25rem;
    border-radius: 2px;
  }
  .note {
    color: #666;
  }
</style>

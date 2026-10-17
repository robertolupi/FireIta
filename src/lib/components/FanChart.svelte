<script lang="ts">
  import type { YearBand } from '../engine/stats'
  import { formatEurCompact } from '../format'
  import { planStore } from '../stores/plan.svelte'

  let { bands }: { bands: YearBand[] } = $props()

  let logScale = $state(false)

  const W = 800
  const H = 320
  const PAD_X = 64
  const PAD_Y = 28

  let chart = $derived.by(() => {
    if (bands.length === 0) return null
    const maxValue = Math.max(1, ...bands.map((b) => b.p90))
    const x = (i: number) => PAD_X + (i / Math.max(1, bands.length - 1)) * (W - 2 * PAD_X)

    // Scala logaritmica: i valori sotto 1 € (patrimonio esaurito) sono clampati a 1
    const logMax = Math.max(1, Math.log10(maxValue))
    const y = logScale
      ? (v: number) => H - PAD_Y - (Math.log10(Math.max(1, v)) / logMax) * (H - 2 * PAD_Y)
      : (v: number) => H - PAD_Y - (v / maxValue) * (H - 2 * PAD_Y)

    const yTicks: { label: string; y: number }[] = logScale
      ? Array.from({ length: Math.floor(logMax) + 1 }, (_, k) => 10 ** k)
          .filter((v) => v <= maxValue)
          .map((v) => ({ label: formatEurCompact(v), y: y(v) }))
      : [0, maxValue / 2, maxValue].map((v) => ({
          label: v === 0 ? '0' : formatEurCompact(v),
          y: y(v)
        }))

    const band = (upper: 'p90' | 'p75', lower: 'p10' | 'p25') =>
      bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b[upper]).toFixed(1)}`).join(' ') +
      ' ' +
      [...bands]
        .reverse()
        .map((b) => `L${x(b.year).toFixed(1)},${y(b[lower]).toFixed(1)}`)
        .join(' ') +
      ' Z'

    const median = bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b.p50).toFixed(1)}`).join(' ')

    return {
      outer: band('p90', 'p10'),
      inner: band('p75', 'p25'),
      median,
      yTicks,
      firstAge: bands[0].age,
      lastAge: bands[bands.length - 1].age,
      yZero: y(0),
      xStart: x(0),
      xEnd: x(bands.length - 1)
    }
  })
</script>

<section class="card">
  <div class="header">
    <h2>
      Evoluzione del patrimonio ({planStore.valueMode === 'real'
        ? `€ reali ${planStore.plan.startYear}`
        : '€ nominali'})
    </h2>
    <div class="scale-toggle" role="group" aria-label="Scala asse Y">
      <button class:active={!logScale} onclick={() => (logScale = false)}>Lineare</button>
      <button class:active={logScale} onclick={() => (logScale = true)}>Log</button>
    </div>
  </div>

  {#if chart}
    <svg viewBox="0 0 {W} {H}" role="img" aria-label="Fan chart dei percentili di patrimonio">
      <line x1={PAD_X} y1={chart.yZero} x2={W - PAD_X} y2={chart.yZero} class="axis" />

      <path d={chart.outer} class="band-outer" />
      <path d={chart.inner} class="band-inner" />
      <path d={chart.median} class="median" fill="none" />

      {#each chart.yTicks as tick}
        <text x={PAD_X - 6} y={tick.y + 4} class="tick" text-anchor="end">{tick.label}</text>
      {/each}
      <text x={chart.xStart} y={H - 6} class="tick" text-anchor="middle">età {chart.firstAge}</text>
      <text x={chart.xEnd} y={H - 6} class="tick" text-anchor="middle">età {chart.lastAge}</text>
    </svg>

    <ul class="legend">
      <li><span class="swatch band-outer"></span> p10–p90</li>
      <li><span class="swatch band-inner"></span> p25–p75</li>
      <li><span class="swatch median-line"></span> mediana</li>
    </ul>
  {:else}
    <p class="muted">Nessun dato da visualizzare.</p>
  {/if}
</section>

<style>
  svg {
    width: 100%;
    height: auto;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .scale-toggle {
    display: inline-flex;
    border: 1px solid #c3d2e3;
    border-radius: 6px;
    overflow: hidden;
  }
  .scale-toggle button {
    border: none;
    background: #fff;
    color: #1a5fa8;
    padding: 0.25rem 0.7rem;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .scale-toggle button.active {
    background: #1a5fa8;
    color: #fff;
  }
  .axis {
    stroke: #999;
    stroke-width: 1;
  }
  .band-outer {
    fill: #4c9be0;
    opacity: 0.25;
  }
  .band-inner {
    fill: #4c9be0;
    opacity: 0.45;
  }
  .median {
    stroke: #1a5fa8;
    stroke-width: 2;
  }
  .tick {
    font-size: 11px;
    fill: #666;
  }
  .legend {
    display: flex;
    gap: 1.5rem;
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    font-size: 0.85rem;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .swatch {
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: 2px;
  }
  .swatch.band-outer {
    background: rgba(76, 155, 224, 0.25);
  }
  .swatch.band-inner {
    background: rgba(76, 155, 224, 0.45);
  }
  .swatch.median-line {
    background: #1a5fa8;
    height: 3px;
  }
</style>

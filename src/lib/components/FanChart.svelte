<script lang="ts">
  import type { YearBand } from '../engine/stats'
  import type { Plan } from '../engine/types'
  import type { ValueMode } from '../engine/deflate'
  import {
    computeFireTargetSeries,
    extractChartMarkers,
    resolveReferenceSwr,
    snapBandIndex
  } from '../engine/chart-helpers'
  import { formatEur, formatEurCompact, formatPct } from '../format'
  import { planStore } from '../stores/plan.svelte'

  interface Props {
    bands: YearBand[]
    baselineBands?: YearBand[] | null
    plan?: Plan
    valueMode?: ValueMode
    swrReference?: number
  }

  let {
    bands,
    baselineBands = null,
    plan = planStore.plan,
    valueMode = planStore.valueMode,
    swrReference
  }: Props = $props()

  let logScale = $state(false)
  let showFireTarget = $state(true)
  let showMarkers = $state(true)
  let hoveredIndex = $state<number | null>(null)
  let svgElement = $state<SVGSVGElement | null>(null)

  const W = 800
  const H = 320
  const PAD_X = 64
  const PAD_Y = 28

  let effectiveSwr = $derived(resolveReferenceSwr(plan, swrReference))
  let fireTargets = $derived(computeFireTargetSeries(plan, bands, valueMode, swrReference))
  let markers = $derived(extractChartMarkers(plan, bands, W, PAD_X))

  let chart = $derived.by(() => {
    if (bands.length === 0) return null
    const firstAge = bands[0].age
    const lastAge = bands[bands.length - 1].age
    const ageSpan = Math.max(1, lastAge - firstAge)

    const alignedBaseline = baselineBands
      ? baselineBands.filter((b) => b.age >= firstAge && b.age <= lastAge)
      : []

    const maxValue = Math.max(
      1,
      ...bands.map((b) => b.p90),
      ...(baselineBands ? baselineBands.map((b) => b.p90) : []),
      ...(showFireTarget ? fireTargets : [])
    )
    const x = (i: number) => PAD_X + (i / Math.max(1, bands.length - 1)) * (W - 2 * PAD_X)
    const xByAge = (age: number) => PAD_X + ((age - firstAge) / ageSpan) * (W - 2 * PAD_X)

    // Scala logaritmica: i valori sotto 1 € (patrimonio esaurito) sono clampati a 1
    const logMax = Math.max(1, Math.log10(maxValue))
    const rawY = logScale
      ? (v: number) => H - PAD_Y - (Math.log10(Math.max(1, v)) / logMax) * (H - 2 * PAD_Y)
      : (v: number) => H - PAD_Y - (Math.max(0, v) / maxValue) * (H - 2 * PAD_Y)
    const y = (v: number) => Math.max(PAD_Y, Math.min(H - PAD_Y, rawY(v)))

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
        .map((b, revIdx) => {
          const origIdx = bands.length - 1 - revIdx
          return `L${x(origIdx).toFixed(1)},${y(b[lower]).toFixed(1)}`
        })
        .join(' ') +
      ' Z'

    const median = bands
      .map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b.p50).toFixed(1)}`)
      .join(' ')

    const baselineMedian =
      alignedBaseline.length > 0
        ? alignedBaseline
            .map((b, i) => `${i === 0 ? 'M' : 'L'}${xByAge(b.age).toFixed(1)},${y(b.p50).toFixed(1)}`)
            .join(' ')
        : ''

    const fireTargetPath =
      fireTargets.length > 0
        ? fireTargets
            .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
            .join(' ')
        : ''

    return {
      outer: band('p90', 'p10'),
      inner: band('p75', 'p25'),
      median,
      baselineMedian,
      fireTargetPath,
      yTicks,
      firstAge,
      lastAge,
      yZero: y(0),
      xStart: x(0),
      xEnd: x(bands.length - 1),
      x,
      y
    }
  })

  function handlePointerMove(e: PointerEvent) {
    if (!svgElement || bands.length === 0) return
    const rect = svgElement.getBoundingClientRect()
    if (rect.width <= 0) return
    const xSvg = ((e.clientX - rect.left) / rect.width) * W
    hoveredIndex = snapBandIndex(xSvg, W, PAD_X, bands.length)
  }

  function handlePointerLeave() {
    hoveredIndex = null
  }

  let hoveredBand = $derived(
    hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < bands.length
      ? bands[hoveredIndex]
      : null
  )
  let hoveredBaselineBand = $derived(
    hoveredBand && baselineBands
      ? baselineBands.find((b) => b.age === hoveredBand.age) ?? null
      : null
  )
  let hoveredX = $derived(chart && hoveredIndex !== null ? chart.x(hoveredIndex) : null)
  let hoveredTarget = $derived(
    hoveredIndex !== null && hoveredIndex < fireTargets.length ? fireTargets[hoveredIndex] : null
  )
  let hoveredCalYear = $derived(
    hoveredBand
      ? (hoveredBand.calendarYear ??
          (hoveredBand.year >= plan.startYear
            ? hoveredBand.year
            : plan.startYear + hoveredBand.year))
      : null
  )
  let hoveredMarker = $derived(
    hoveredIndex !== null ? markers.find((m) => m.bandIndex === hoveredIndex) ?? null : null
  )
</script>

<section class="card">
  <div class="header">
    <h2>
      Evoluzione del patrimonio ({valueMode === 'real'
        ? `€ reali ${plan.startYear}`
        : '€ nominali'})
    </h2>
    <div class="chart-controls">
      <label class="inline-check">
        <input type="checkbox" bind:checked={showFireTarget} />
        Target FIRE ({formatPct(effectiveSwr)})
      </label>
      <label class="inline-check">
        <input type="checkbox" bind:checked={showMarkers} />
        Eventi
      </label>
      <div class="scale-toggle" role="group" aria-label="Scala asse Y">
        <button type="button" class:active={!logScale} onclick={() => (logScale = false)}>Lineare</button>
        <button type="button" class:active={logScale} onclick={() => (logScale = true)}>Log</button>
      </div>
    </div>
  </div>

  {#if chart}
    <div class="chart-wrapper">
      <svg
        bind:this={svgElement}
        viewBox="0 0 {W} {H}"
        role="img"
        aria-label="Fan chart dei percentili di patrimonio"
        onpointermove={handlePointerMove}
        onpointerleave={handlePointerLeave}
      >
        <line x1={PAD_X} y1={chart.yZero} x2={W - PAD_X} y2={chart.yZero} class="axis" />

        <path d={chart.outer} class="band-outer" />
        <path d={chart.inner} class="band-inner" />
        <path d={chart.median} class="median" fill="none" />

        {#if chart.baselineMedian}
          <path d={chart.baselineMedian} class="baseline-median" fill="none" stroke-dasharray="6 4" />
        {/if}

        {#if showFireTarget && chart.fireTargetPath}
          <path d={chart.fireTargetPath} class="fire-target-line" fill="none" stroke-dasharray="6 4" />
        {/if}

        {#if showMarkers}
          {#each markers as m (m.year)}
            <g class="event-marker" class:stop-work={m.isStopWork}>
              <line x1={m.x} y1={PAD_Y} x2={m.x} y2={H - PAD_Y} stroke-dasharray="3 3" />
              <text x={m.x} y={PAD_Y - 8} text-anchor="middle" class="marker-badge">
                {m.labels.join(' • ')}
              </text>
            </g>
          {/each}
        {/if}

        {#if hoveredBand && hoveredX !== null}
          <line x1={hoveredX} y1={PAD_Y} x2={hoveredX} y2={H - PAD_Y} class="crosshair-line" />
          {#each [hoveredBand.p90, hoveredBand.p75, hoveredBand.p50, hoveredBand.p25, hoveredBand.p10] as val, i}
            <circle
              cx={hoveredX}
              cy={chart.y(val)}
              r={i === 2 ? 4.5 : 3}
              class="crosshair-dot dot-{i}"
            />
          {/each}
        {/if}

        {#each chart.yTicks as tick}
          <text x={PAD_X - 6} y={tick.y + 4} class="tick" text-anchor="end">{tick.label}</text>
        {/each}
        <text x={chart.xStart} y={H - 6} class="tick" text-anchor="middle">età {chart.firstAge}</text>
        <text x={chart.xEnd} y={H - 6} class="tick" text-anchor="middle">età {chart.lastAge}</text>
      </svg>

      {#if hoveredBand && hoveredX !== null}
        <div
          class="chart-tooltip"
          class:flip-left={hoveredX > W * 0.62}
          style="left: {(hoveredX / W) * 100}%;"
        >
          <div class="tooltip-header">
            <strong>Anno {hoveredCalYear}</strong>
            <span>Età {hoveredBand.age}</span>
          </div>
          {#if hoveredMarker}
            <div class="tooltip-events">
              {hoveredMarker.labels.join(' • ')}
            </div>
          {/if}
          <ul class="tooltip-list">
            <li class="p90"><span>P90 (Ottimista):</span> <strong>{formatEur(hoveredBand.p90)}</strong></li>
            <li class="p75"><span>P75:</span> <strong>{formatEur(hoveredBand.p75)}</strong></li>
            <li class="p50"><span>P50 (Mediana):</span> <strong>{formatEur(hoveredBand.p50)}</strong></li>
            <li class="p25"><span>P25:</span> <strong>{formatEur(hoveredBand.p25)}</strong></li>
            <li class="p10"><span>P10 (Pessimista):</span> <strong>{formatEur(hoveredBand.p10)}</strong></li>
            {#if hoveredBaselineBand}
              <li class="baseline-row">
                <span>Mediana Base:</span>
                <strong>{formatEur(hoveredBaselineBand.p50)}</strong>
              </li>
            {/if}
            {#if showFireTarget && hoveredTarget !== null}
              <li class="target-row">
                <span>Target FIRE:</span>
                <strong>{formatEur(hoveredTarget)}</strong>
              </li>
            {/if}
            {#if hoveredBand.survivalRate !== undefined}
              <li class="survival-row">
                <span>Sopravvivenza:</span>
                <strong>{formatPct(hoveredBand.survivalRate)}</strong>
              </li>
            {/if}
          </ul>
        </div>
      {/if}
    </div>

    <ul class="legend">
      <li><span class="swatch band-outer"></span> p10–p90</li>
      <li><span class="swatch band-inner"></span> p25–p75</li>
      <li><span class="swatch median-line"></span> mediana</li>
      {#if chart.baselineMedian}
        <li><span class="swatch baseline-swatch"></span> mediana scenario base</li>
      {/if}
      {#if showFireTarget}
        <li><span class="swatch target-swatch"></span> Target FIRE ({formatPct(effectiveSwr)})</li>
      {/if}
      {#if showMarkers && markers.length > 0}
        <li><span class="swatch marker-swatch"></span> Eventi / Ritiro</li>
      {/if}
    </ul>
  {:else}
    <p class="muted">Nessun dato da visualizzare.</p>
  {/if}
</section>

<style>
  .chart-wrapper {
    position: relative;
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
    touch-action: pan-y;
  }
  .header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.25rem;
  }
  .header h2 {
    margin: 0;
  }
  .chart-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  .inline-check {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 0.3rem;
    margin: 0;
    font-size: 0.8rem;
    color: #444;
    cursor: pointer;
  }
  .inline-check input {
    margin: 0;
    padding: 0;
  }
  .scale-toggle {
    display: inline-flex;
    border: 1px solid #c3d2e3;
    border-radius: 6px;
    overflow: hidden;
  }
  .scale-toggle button {
    border: none;
    border-radius: 0;
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
  .baseline-median {
    stroke: #d97706;
    stroke-width: 2;
  }
  .fire-target-line {
    stroke: #137333;
    stroke-width: 1.75;
  }
  .event-marker line {
    stroke: #6b7280;
    stroke-width: 1.2;
  }
  .event-marker.stop-work line {
    stroke: #d97706;
    stroke-width: 1.5;
  }
  .marker-badge {
    font-size: 10px;
    font-weight: 600;
    fill: #4b5563;
  }
  .event-marker.stop-work .marker-badge {
    fill: #b45309;
  }
  .crosshair-line {
    stroke: #1f2937;
    stroke-width: 1;
    stroke-dasharray: 2 2;
    pointer-events: none;
  }
  .crosshair-dot {
    fill: #fff;
    stroke: #1a5fa8;
    stroke-width: 2;
    pointer-events: none;
  }
  .crosshair-dot.dot-2 {
    fill: #1a5fa8;
  }
  .tick {
    font-size: 11px;
    fill: #666;
  }
  .chart-tooltip {
    position: absolute;
    top: 12px;
    transform: translateX(12px);
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid #d0d7de;
    border-radius: 6px;
    padding: 0.5rem 0.65rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    font-size: 0.78rem;
    min-width: 195px;
    pointer-events: none;
    z-index: 10;
  }
  .chart-tooltip.flip-left {
    transform: translateX(calc(-100% - 12px));
  }
  .tooltip-header {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 0.25rem;
    margin-bottom: 0.3rem;
    color: #111827;
  }
  .tooltip-events {
    background: #fef3c7;
    color: #92400e;
    border-radius: 4px;
    padding: 0.15rem 0.35rem;
    margin-bottom: 0.3rem;
    font-weight: 600;
    font-size: 0.72rem;
  }
  .tooltip-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .tooltip-list li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .tooltip-list li.p50 {
    color: #1a5fa8;
  }
  .tooltip-list li.baseline-row {
    color: #b45309;
  }
  .tooltip-list li.target-row {
    border-top: 1px dashed #e5e7eb;
    padding-top: 0.2rem;
    margin-top: 0.1rem;
    color: #137333;
  }
  .tooltip-list li.survival-row {
    color: #4b5563;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
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
  .swatch.baseline-swatch {
    background: transparent;
    border-top: 2px dashed #d97706;
    height: 0;
  }
  .swatch.target-swatch {
    background: transparent;
    border-top: 2px dashed #137333;
    height: 0;
  }
  .swatch.marker-swatch {
    background: transparent;
    border-left: 2px dashed #d97706;
    width: 0;
    height: 12px;
  }
</style>

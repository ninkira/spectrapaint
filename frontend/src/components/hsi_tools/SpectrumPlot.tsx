import React, { useEffect, useMemo, useState } from 'react'
import Plot from 'react-plotly.js'
import type { Annotations, Data, Layout, Shape } from 'plotly.js'

export type Spectrum = {
  wavelengths_nm: number[]
  values: number[]
  x: number
  y: number
} | null

type RegionStats = {
  n_pixels: number
  mean: number[]
  std: number[]
}

type ComparisonSpectrum = {
  name: string
  values: number[]
  wavelengths_nm?: number[]
}

/** Inclusive band indices into the plotted wavelength axis. */
export type BandRange = { first: number; last: number }

interface SpectrumPlotProps {
  spectra?: Spectrum[]
  wavelengthsNm?: number[] // from API top-level
  stats?: RegionStats | null // from API region_stats
  comparisonSpectra?: ComparisonSpectrum[]
  title?: string
  /** The bands worth comparing. Outside it the detector was blind, so the trace is still drawn
   *  but shaded — the data is being ignored, not thrown away. */
  validBands?: BandRange | null
  /** Supplied only when the range is editable; its presence is what shows the control. */
  onValidBandsChange?: (next: BandRange | null) => void | Promise<void>
}

/** Index of the band closest to a wavelength — the control is in nm, the stored range in bands. */
const nearestBand = (targetNm: number, wl: number[]): number => {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < wl.length; i += 1) {
    const distance = Math.abs(wl[i] - targetNm)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

/** The wavelength spans a range excludes — at most one per dead detector edge.
 *
 *  Each span reaches the first kept band rather than stopping a band short, so the shading meets
 *  the sound part of the trace instead of leaving a misleading sliver of clear space beside it. */
const excludedSpans = (wl: number[], range: BandRange | null | undefined): [number, number][] => {
  if (!range || !wl.length || range.last >= wl.length) return []
  const spans: [number, number][] = []
  if (range.first > 0) spans.push([wl[0], wl[range.first]])
  if (range.last < wl.length - 1) spans.push([wl[range.last], wl[wl.length - 1]])
  return spans
}

const normalizeSeries = (values: number[]): number[] => {
  if (!values.length) return values
  let min = values[0]
  let max = values[0]
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < min) min = values[i]
    if (values[i] > max) max = values[i]
  }
  const range = max - min
  if (range <= Number.EPSILON) return values.map(() => 0)
  return values.map((v) => (v - min) / range)
}

const SpectrumPlot: React.FC<SpectrumPlotProps> = ({
  spectra = [],
  wavelengthsNm,
  stats,
  comparisonSpectra = [],
  title = 'Selected region spectra',
  validBands = null,
  onValidBandsChange,
}) => {
  const [showSignals, setShowSignals] = useState(false)
  const [showStdBand, setShowStdBand] = useState(true)
  const [normalizeSignals, setNormalizeSignals] = useState(false)
  const [editingRange, setEditingRange] = useState(false)
  const [rangeDraft, setRangeDraft] = useState<{ low: string; high: string }>({ low: '', high: '' })
  const [rangeError, setRangeError] = useState<string | null>(null)

  const nonNull = useMemo(
    () => spectra.filter((s): s is Exclude<Spectrum, null> => !!s),
    [spectra]
  )

  // Memoised so the fallback's fresh `[]` cannot give every derived value below a new identity
  // on each render — with six hooks depending on it, that was re-deriving the whole plot.
  const wl = useMemo(
    () => wavelengthsNm ?? nonNull[0]?.wavelengths_nm ?? [],
    [wavelengthsNm, nonNull]
  )

  const excluded = useMemo(() => excludedSpans(wl, validBands), [wl, validBands])

  // Keep the control's boxes in step with whatever is being plotted: selecting another cube must
  // not leave the previous one's range sitting in them.
  useEffect(() => {
    if (!wl.length) return
    const first = validBands ? Math.min(Math.max(validBands.first, 0), wl.length - 1) : 0
    const last = validBands ? Math.min(Math.max(validBands.last, 0), wl.length - 1) : wl.length - 1
    setRangeDraft({ low: wl[first].toFixed(1), high: wl[last].toFixed(1) })
    setRangeError(null)
  }, [validBands, wl])

  // Fallback compute on client if backend stats are not provided.
  const fallbackStats = useMemo(() => {
    if (!nonNull.length || !wl.length) return null
    const n = nonNull.length
    const nBands = wl.length
    const mean = new Array(nBands).fill(0)
    const std = new Array(nBands).fill(0)

    for (const s of nonNull) for (let i = 0; i < nBands; i += 1) mean[i] += s.values[i]
    for (let i = 0; i < nBands; i += 1) mean[i] /= n
    for (const s of nonNull) for (let i = 0; i < nBands; i += 1) std[i] += (s.values[i] - mean[i]) ** 2
    for (let i = 0; i < nBands; i += 1) std[i] = Math.sqrt(std[i] / (n > 1 ? n - 1 : 1))

    return { n_pixels: n, mean, std }
  }, [nonNull, wl])

  const usedStats = stats ?? fallbackStats

  const normalizedSignals = useMemo(
    () =>
      normalizeSignals
        ? nonNull.map((s) => ({
            ...s,
            values: normalizeSeries(s.values),
          }))
        : nonNull,
    [nonNull, normalizeSignals]
  )

  const normalizedStatsFromSignals = useMemo(() => {
    if (!normalizeSignals || !normalizedSignals.length || !wl.length) return null
    const n = normalizedSignals.length
    const nBands = wl.length
    const mean = new Array(nBands).fill(0)
    const std = new Array(nBands).fill(0)

    for (const s of normalizedSignals) for (let i = 0; i < nBands; i += 1) mean[i] += s.values[i]
    for (let i = 0; i < nBands; i += 1) mean[i] /= n
    for (const s of normalizedSignals) for (let i = 0; i < nBands; i += 1) std[i] += (s.values[i] - mean[i]) ** 2
    for (let i = 0; i < nBands; i += 1) std[i] = Math.sqrt(std[i] / (n > 1 ? n - 1 : 1))

    return { n_pixels: n, mean, std }
  }, [normalizeSignals, normalizedSignals, wl])

  const scaledBackendStats = useMemo(() => {
    if (!usedStats) return null
    if (!normalizeSignals) return usedStats
    const mean = normalizeSeries(usedStats.mean)
    const minMean = Math.min(...usedStats.mean)
    const maxMean = Math.max(...usedStats.mean)
    const range = Math.max(maxMean - minMean, Number.EPSILON)
    const std = usedStats.std.map((v) => v / range)
    return { n_pixels: usedStats.n_pixels, mean, std }
  }, [normalizeSignals, usedStats])

  const displayedStats = normalizedStatsFromSignals ?? scaledBackendStats

  const data: Data[] = useMemo(() => {
    if (!wl.length || !displayedStats) return []
    const d: Data[] = []

    if (showSignals) {
      for (const s of normalizedSignals) {
        d.push({
          x: wl,
          y: s.values,
          type: 'scatter',
          mode: 'lines',
          name: `(${s.x}, ${s.y})`,
          line: { color: 'rgba(120,120,120,0.35)', width: 1 },
          hoverinfo: 'skip',
          showlegend: false,
        })
      }
    }

    if (showStdBand) {
      const lower = displayedStats.mean.map((m, i) => m - displayedStats.std[i])
      const upper = displayedStats.mean.map((m, i) => m + displayedStats.std[i])

      d.push(
        { x: wl, y: lower, type: 'scatter', mode: 'lines', name: 'Mean - 1\u03C3', line: { width: 0 } },
        {
          x: wl,
          y: upper,
          type: 'scatter',
          mode: 'lines',
          name: '\u00B11\u03C3 band',
          line: { width: 0 },
          fill: 'tonexty',
          fillcolor: 'rgba(59,130,246,0.2)',
        }
      )
    }

    d.push({
      x: wl,
      y: displayedStats.mean,
      type: 'scatter',
      mode: 'lines',
      name: `Mean (n=${displayedStats.n_pixels})`,
      line: { color: '#111', width: 2 },
    })

    for (const match of comparisonSpectra) {
      const xAxis = match.wavelengths_nm && match.wavelengths_nm.length ? match.wavelengths_nm : wl
      if (xAxis.length !== match.values.length) continue
      d.push({
        x: xAxis,
        y: normalizeSignals ? normalizeSeries(match.values) : match.values,
        type: 'scatter',
        mode: 'lines',
        name: match.name,
        line: { width: 2 },
      })
    }

    return d
  }, [normalizedSignals, wl, displayedStats, showSignals, showStdBand, normalizeSignals, comparisonSpectra])

  // The excluded regions are shaded behind the trace rather than clipped off the axis. The
  // spectrum is still drawn there, and still visibly wrong there, which is the point: a reader
  // should see that the detector returned nothing usable at its edges, not find the wavelength
  // range quietly shortened and have to work out why.
  const excludedShapes: Partial<Shape>[] = useMemo(
    () =>
      excluded.map(([x0, x1]) => ({
        type: 'rect' as const,
        xref: 'x' as const,
        yref: 'paper' as const,
        x0,
        x1,
        y0: 0,
        y1: 1,
        fillcolor: 'rgba(220,38,38,0.09)',
        line: { width: 0 },
        layer: 'below' as const,
      })),
    [excluded]
  )

  const excludedLabels: Partial<Annotations>[] = useMemo(
    () =>
      excluded.map(([x0, x1]) => ({
        x: (x0 + x1) / 2,
        y: 1,
        xref: 'x' as const,
        yref: 'paper' as const,
        yanchor: 'bottom' as const,
        text: 'excluded',
        showarrow: false,
        font: { size: 9, color: '#b91c1c' },
      })),
    [excluded]
  )

  const layout: Partial<Layout> = useMemo(() => ({
    autosize: true,
    title: { text: title },
    margin: { l: 50, r: 20, t: 40, b: 50 },
    xaxis: {
      title: { text: 'Wavelength (nm)' },
      tickmode: 'linear',
      dtick: 100,
      tick0: wl.length ? Math.ceil(wl[0] / 100) * 100 : 0,
    },
    yaxis: { title: { text: normalizeSignals ? 'Normalized intensity (0-1)' : 'Intensity / Reflectance' } },
    shapes: excludedShapes,
    annotations: excludedLabels,
  }), [title, wl, normalizeSignals, excludedShapes, excludedLabels])

  const applyRange = async () => {
    if (!onValidBandsChange) return
    const low = Number.parseFloat(rangeDraft.low)
    const high = Number.parseFloat(rangeDraft.high)
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      setRangeError('Enter two wavelengths in nm.')
      return
    }
    if (low >= high) {
      setRangeError('The lower bound has to come first.')
      return
    }
    const first = nearestBand(low, wl)
    const last = nearestBand(high, wl)
    if (first === last) {
      setRangeError('That leaves only one band.')
      return
    }
    setRangeError(null)
    try {
      await onValidBandsChange({ first, last })
      setEditingRange(false)
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : 'Could not save the range.')
    }
  }

  const clearRange = async () => {
    if (!onValidBandsChange) return
    setRangeError(null)
    try {
      await onValidBandsChange(null)
      setEditingRange(false)
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : 'Could not clear the range.')
    }
  }

  if (!wl.length || !displayedStats) return <div style={{ padding: '1rem' }}>No spectra available.</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={() => setShowSignals((v) => !v)}>
          {showSignals ? 'Hide signals' : 'Show signals'}
        </button>
        <button onClick={() => setShowStdBand((v) => !v)}>
          {showStdBand ? 'Hide \u00B11\u03C3' : 'Show \u00B11\u03C3'}
        </button>
        <button onClick={() => setNormalizeSignals((v) => !v)}>
          {normalizeSignals ? 'Show raw values' : 'Normalise signals'}
        </button>
        {onValidBandsChange && wl.length > 1 && (
          <button onClick={() => setEditingRange((v) => !v)}>
            {editingRange ? 'Close band range' : 'Band range'}
          </button>
        )}
      </div>

      {editingRange && onValidBandsChange && wl.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 8,
            fontSize: '0.85rem',
          }}
        >
          <span>Usable range (nm):</span>
          <input
            type="number"
            step="1"
            value={rangeDraft.low}
            onChange={(e) => setRangeDraft((d) => ({ ...d, low: e.target.value }))}
            style={{ width: 80 }}
            aria-label="Lowest usable wavelength in nm"
          />
          <span>&ndash;</span>
          <input
            type="number"
            step="1"
            value={rangeDraft.high}
            onChange={(e) => setRangeDraft((d) => ({ ...d, high: e.target.value }))}
            style={{ width: 80 }}
            aria-label="Highest usable wavelength in nm"
          />
          <button onClick={applyRange}>Apply</button>
          <button onClick={clearRange} disabled={!validBands}>
            Use all bands
          </button>
          <span style={{ color: '#6b7280' }}>
            {validBands
              ? `Bands ${validBands.first}–${validBands.last} of ${wl.length}`
              : `All ${wl.length} bands in use`}
          </span>
          {rangeError && <span style={{ color: '#b91c1c' }}>{rangeError}</span>}
        </div>
      )}

      <Plot data={data} layout={layout} style={{ width: '100%', height: 280 }} useResizeHandler />
    </div>
  )
}

export default SpectrumPlot

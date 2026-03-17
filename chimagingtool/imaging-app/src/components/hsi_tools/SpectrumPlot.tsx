import React, { useMemo, useState } from 'react'
import Plot from 'react-plotly.js'
import type { Data, Layout } from 'plotly.js'

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

interface SpectrumPlotProps {
  spectra?: Spectrum[]
  wavelengthsNm?: number[] // from API top-level
  stats?: RegionStats | null // from API region_stats
  comparisonSpectra?: ComparisonSpectrum[]
  title?: string
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
}) => {
  const [showSignals, setShowSignals] = useState(false)
  const [showStdBand, setShowStdBand] = useState(true)
  const [normalizeSignals, setNormalizeSignals] = useState(false)

  const nonNull = useMemo(
    () => spectra.filter((s): s is Exclude<Spectrum, null> => !!s),
    [spectra]
  )

  const wl = wavelengthsNm ?? nonNull[0]?.wavelengths_nm ?? []

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
  if (!wl.length || !displayedStats) return <div style={{ padding: '1rem' }}>No spectra available.</div>

  const data: Data[] = useMemo(() => {
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

  const layout: Partial<Layout> = useMemo(() => ({
    autosize: true,
    title: { text: title },
    margin: { l: 50, r: 20, t: 40, b: 50 },
    xaxis: {
      title: { text: 'Wavelength (nm)' },
      tickmode: 'linear',
      dtick: 100,
      tick0: Math.ceil(wl[0] / 100) * 100,
    },
    yaxis: { title: { text: normalizeSignals ? 'Normalized intensity (0-1)' : 'Intensity / Reflectance' } },
  }), [title, wl, normalizeSignals])

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
      </div>

      <Plot data={data} layout={layout} style={{ width: '100%', height: 280 }} useResizeHandler />
    </div>
  )
}

export default SpectrumPlot

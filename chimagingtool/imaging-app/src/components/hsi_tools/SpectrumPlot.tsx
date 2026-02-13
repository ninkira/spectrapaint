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

interface SpectrumPlotProps {
  spectra?: Spectrum[]
  wavelengthsNm?: number[]      // from API top-level
  stats?: RegionStats | null    // from API region_stats
  title?: string
}

const SpectrumPlot: React.FC<SpectrumPlotProps> = ({
  spectra = [],
  wavelengthsNm,
  stats,
  title = 'Selected region spectra',
}) => {
  const [showSignals, setShowSignals] = useState(false)
  const [showStdBand, setShowStdBand] = useState(true)

  const nonNull = useMemo(
    () => spectra.filter((s): s is Exclude<Spectrum, null> => !!s),
    [spectra]
  )

  const wl = wavelengthsNm ?? nonNull[0]?.wavelengths_nm ?? []

  // fallback: compute mean/std client-side only if backend stats not provided
  const fallbackStats = useMemo(() => {
    if (!nonNull.length || !wl.length) return null
    const n = nonNull.length
    const nBands = wl.length
    const mean = new Array(nBands).fill(0)
    const std = new Array(nBands).fill(0)

    for (const s of nonNull) for (let i = 0; i < nBands; i++) mean[i] += s.values[i]
    for (let i = 0; i < nBands; i++) mean[i] /= n
    for (const s of nonNull) for (let i = 0; i < nBands; i++) std[i] += (s.values[i] - mean[i]) ** 2
    for (let i = 0; i < nBands; i++) std[i] = Math.sqrt(std[i] / (n > 1 ? n - 1 : 1))

    return { n_pixels: n, mean, std }
  }, [nonNull, wl])

  const usedStats = stats ?? fallbackStats
  if (!wl.length || !usedStats) return <div style={{ padding: '1rem' }}>No spectra available.</div>

  const data: Data[] = []

  if (showSignals) {
    for (const s of nonNull) {
      data.push({
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
    const lower = usedStats.mean.map((m, i) => m - usedStats.std[i])
    const upper = usedStats.mean.map((m, i) => m + usedStats.std[i])

    data.push(
      { x: wl, y: lower, type: 'scatter', mode: 'lines', name: 'Mean - 1σ', line: { width: 0 } },
      {
        x: wl,
        y: upper,
        type: 'scatter',
        mode: 'lines',
        name: '±1σ band',
        line: { width: 0 },
        fill: 'tonexty',
        fillcolor: 'rgba(59,130,246,0.2)',
      }
    )
  }

  data.push({
    x: wl,
    y: usedStats.mean,
    type: 'scatter',
    mode: 'lines',
    name: `Mean (n=${usedStats.n_pixels})`,
    line: { color: '#111', width: 2 },
  })

  const layout: Partial<Layout> = {
    autosize: true,
    title: { text: title },
    margin: { l: 50, r: 20, t: 40, b: 50 },
    xaxis: { title: { text: 'Wavelength (nm)' } },
    yaxis: { title: { text: 'Intensity / Reflectance' } },
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={() => setShowSignals((v) => !v)}>
          {showSignals ? 'Hide signals' : 'Show signals'}
        </button>
        <button onClick={() => setShowStdBand((v) => !v)}>
          {showStdBand ? 'Hide ±1σ' : 'Show ±1σ'}
        </button>
      </div>

      <Plot data={data} layout={layout} style={{ width: '100%', height: 400 }} useResizeHandler />
    </div>
  )
}

export default SpectrumPlot

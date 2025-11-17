import React, { useMemo, useState } from 'react'
import Plot from 'react-plotly.js'
import type { Data, Layout } from 'plotly.js'

export type Spectrum = {
  wavelengths_nm: number[]
  values: number[]
  x: number
  y: number
} | null

interface SpectrumPlotProps {
  spectrum: Spectrum
}

const SpectrumPlot: React.FC<SpectrumPlotProps> = ({ spectrum }) => {
  // hooks MUST be at the top level, before any returns
  const [showMean, setShowMean] = useState(false)
  const [showStd, setShowStd] = useState(false)

  const { mean, std } = useMemo(() => {
    if (!spectrum || !spectrum.values.length) {
      return { mean: NaN, std: NaN }
    }

    const vals = spectrum.values
    const n = vals.length
    const meanVal = vals.reduce((a, v) => a + v, 0) / n
    const variance =
      vals.reduce((acc, v) => acc + (v - meanVal) ** 2, 0) / (n - 1 || 1)
    const stdVal = Math.sqrt(variance)

    return { mean: meanVal, std: stdVal }
  }, [spectrum])

  // you can still short-circuit the UI here
  if (!spectrum) {
    return (
      <div style={{ padding: '1rem', color: '#666' }}>
        Click on the image to see a spectrum.
      </div>
    )
  }

  const { wavelengths_nm, values, x, y } = spectrum

  const baseTrace: Data = {
    x: wavelengths_nm,
    y: values,
    type: 'scatter',
    mode: 'lines+markers',
    name: `Pixel (${x}, ${y})`,
  }

  const statsTraces: Data[] = []

  if (showMean && Number.isFinite(mean)) {
    statsTraces.push({
      x: [wavelengths_nm[0], wavelengths_nm[wavelengths_nm.length - 1]],
      y: [mean, mean],
      type: 'scatter',
      mode: 'lines',
      name: `Mean = ${mean.toFixed(3)}`,
      line: { dash: 'dash' },
    })
  }

  if (showStd && Number.isFinite(mean) && Number.isFinite(std)) {
    const low = mean - std
    const high = mean + std
    statsTraces.push(
      {
        x: [wavelengths_nm[0], wavelengths_nm[wavelengths_nm.length - 1]],
        y: [low, low],
        type: 'scatter',
        mode: 'lines',
        name: 'Mean - 1σ',
        line: { dash: 'dot' },
      },
      {
        x: [wavelengths_nm[0], wavelengths_nm[wavelengths_nm.length - 1]],
        y: [high, high],
        type: 'scatter',
        mode: 'lines',
        name: 'Mean + 1σ',
        line: { dash: 'dot' },
      }
    )
  }

  const data: Data[] = [baseTrace, ...statsTraces]

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 50, r: 20, t: 40, b: 50 },
    title: { text: `Spectrum at pixel (x=${x}, y=${y})` },
    xaxis: { title: { text: 'Wavelength (nm)' } },
    yaxis: { title: { text: 'Intensity / Reflectance' } },
  }

  return (
    <div>
      <h3>Spectra Plot</h3>
      <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '1rem' }}>
        <label>
          <input
            type="checkbox"
            checked={showMean}
            onChange={(e) => setShowMean(e.target.checked)}
          />{' '}
          Show mean
        </label>
        <label>
          <input
            type="checkbox"
            checked={showStd}
            onChange={(e) => setShowStd(e.target.checked)}
          />{' '}
          Show ±1σ
        </label>

        <div style={{ marginLeft: 'auto', fontSize: '0.9rem', color: '#555' }}>
          <span style={{ marginRight: '1rem' }}>
            Mean: {Number.isFinite(mean) ? mean.toFixed(4) : '—'}
          </span>
          <span>
            Std dev: {Number.isFinite(std) ? std.toFixed(4) : '—'}
          </span>
        </div>
      </div>

      <Plot
        data={data}
        layout={layout}
        style={{ width: '100%', height: '400px' }}
        useResizeHandler={true}
      />

 
    </div>
  )
}

export default SpectrumPlot

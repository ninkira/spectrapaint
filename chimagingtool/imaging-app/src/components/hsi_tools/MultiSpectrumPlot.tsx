import React, { useMemo, useState } from 'react'
import Plot from 'react-plotly.js'
import type { Data, Layout } from 'plotly.js'
import type { Spectrum } from './SpectrumPlot'

interface MultiSpectrumPlotProps {
  spectra: Spectrum[]
}

type NonNullSpectrum = Exclude<Spectrum, null>

const MultiSpectrumPlot: React.FC<MultiSpectrumPlotProps> = ({ spectra }) => {
  const [showMean, setShowMean] = useState(true)
  const [showStd, setShowStd] = useState(true)

  // 1) always called
  const nonNullSpectra = useMemo(
    () => spectra.filter((s): s is NonNullSpectrum => s !== null),
    [spectra]
  )

  // 2) always called (even if nonNullSpectra is empty)
  const { wavelengths, meanSpectrum, stdSpectrum } = useMemo(() => {
    if (nonNullSpectra.length === 0) {
      return { wavelengths: [] as number[], meanSpectrum: [] as number[], stdSpectrum: [] as number[] }
    }

    const first = nonNullSpectra[0]
    const wl = first.wavelengths_nm
    const nPix = nonNullSpectra.length
    const nBands = wl.length

    const mean = new Array<number>(nBands).fill(0)
    const std = new Array<number>(nBands).fill(0)

    for (const spec of nonNullSpectra) {
      for (let i = 0; i < nBands; i++) {
        mean[i] += spec.values[i]
      }
    }
    for (let i = 0; i < nBands; i++) {
      mean[i] /= nPix
    }

    for (const spec of nonNullSpectra) {
      for (let i = 0; i < nBands; i++) {
        const diff = spec.values[i] - mean[i]
        std[i] += diff * diff
      }
    }
    for (let i = 0; i < nBands; i++) {
      std[i] = Math.sqrt(std[i] / (nPix - 1 || 1))
    }

    return { wavelengths: wl, meanSpectrum: mean, stdSpectrum: std }
  }, [nonNullSpectra])

  // ✅ NOW it is safe to early-return, all hooks above have run
  if (!nonNullSpectra.length) {
    return (
      <div style={{ padding: '1rem', color: '#666' }}>
        Click on the image in multi-selection mode to add spectra.
      </div>
    )
  }

  const data: Data[] = nonNullSpectra.map((spec) => ({
    x: spec.wavelengths_nm,
    y: spec.values,
    type: 'scatter',
    mode: 'lines',
    name: `(${spec.x}, ${spec.y})`,
  }))

  // std band (shaded with dotted edges), controlled by showStd
  if (showStd && wavelengths.length) {
    const lower = meanSpectrum.map((m, i) => m - stdSpectrum[i])
    const upper = meanSpectrum.map((m, i) => m + stdSpectrum[i])

    data.push(
      {
        x: wavelengths,
        y: lower,
        type: 'scatter',
        mode: 'lines',
        name: 'Mean - 1σ',
        line: { color: 'black', dash: 'dot', width: 1 },
      },
      {
        x: wavelengths,
        y: upper,
        type: 'scatter',
        mode: 'lines',
        name: 'Mean + 1σ',
        line: { color: 'black', dash: 'dot', width: 1 },
        fill: 'tonexty',
        fillcolor: 'rgba(100, 149, 237, 0.20)',
      }
    )
  }

  if (showMean && wavelengths.length) {
    data.push({
      x: wavelengths,
      y: meanSpectrum,
      type: 'scatter',
      mode: 'lines',
      name: 'Mean spectrum',
      line: { color: 'black', dash: 'dot', width: 2 },
    })
  }

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 50, r: 20, t: 40, b: 50 },
    title: { text: 'Multiple spectra (selected pixels)' },
    xaxis: { title: { text: 'Wavelength (nm)' } },
    yaxis: { title: { text: 'Intensity / Reflectance' } },
    showlegend: true,
    legend: { orientation: 'h', y: -0.2 },
  }

  const btnStyle: React.CSSProperties = {
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid #444',
    background: '#1b2431',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.8rem',
  }

  const activeStyle: React.CSSProperties = {
    ...btnStyle,
    background: '#3a4b63',
    border: '1px solid #4f6c9b',
  }

  return (
    <div>
      <h3>Spectra Plot (multiple)</h3>

      <div
        style={{
          marginBottom: '0.75rem',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
        }}
      >
        <button
          style={showMean ? activeStyle : btnStyle}
          onClick={() => setShowMean((v) => !v)}
        >
          Mean
        </button>

        <button
          style={showStd ? activeStyle : btnStyle}
          onClick={() => setShowStd((v) => !v)}
        >
          ±1σ
        </button>

        <div
          style={{
            marginLeft: 'auto',
            color: '#aaa',
            fontSize: '0.85rem',
          }}
        >
          n = {nonNullSpectra.length} spectra
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

export default MultiSpectrumPlot

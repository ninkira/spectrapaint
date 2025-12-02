import React, { useMemo } from 'react'
import Plot from 'react-plotly.js'
import type { Data, Layout } from 'plotly.js'

// reuse the same Spectrum type
import type { Spectrum } from './SpectrumPlot'

interface MultiSpectrumPlotProps {
  spectra: Spectrum[]  // may contain nulls, we'll filter them out
}

type NonNullSpectrum = Exclude<Spectrum, null>

const MultiSpectrumPlot: React.FC<MultiSpectrumPlotProps> = ({ spectra }) => {
  const nonNullSpectra = useMemo(
    () => spectra.filter((s): s is NonNullSpectrum => s !== null),
    [spectra]
  )

  if (!nonNullSpectra.length) {
    return (
      <div style={{ padding: '1rem', color: '#666' }}>
        Click on the image in multi-selection mode to add spectra.
      </div>
    )
  }

  // assume all spectra share the same wavelength axis (typical for HSI cubes)
  const data: Data[] = nonNullSpectra.map((spec, idx) => ({
    x: spec.wavelengths_nm,
    y: spec.values,
    type: 'scatter',
    mode: 'lines',
    name: `(${spec.x}, ${spec.y})`, // legend label
  }))

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 50, r: 20, t: 40, b: 50 },
    title: { text: 'Multiple spectra (selected pixels)' },
    xaxis: { title: { text: 'Wavelength (nm)' } },
    yaxis: { title: { text: 'Intensity / Reflectance' } },
    showlegend: true,
    legend: { orientation: 'h', y: -0.2 },
  }

  return (
    <div>
      <h3>Spectra Plot (multiple)</h3>
      <div
        style={{
          marginBottom: '0.5rem',
          fontSize: '0.9rem',
          color: '#555',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Selected spectra: {nonNullSpectra.length}</span>
        <span>
          Pixels:{' '}
          {nonNullSpectra
            .map((s) => `(${s.x},${s.y})`)
            .join(', ')}
        </span>
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
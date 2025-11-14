// HSITool.tsx
import React from 'react'
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
  if (!spectrum) {
    return (
      <div style={{ padding: '1rem', color: '#666' }}>
        Click on the image to see a spectrum.
      </div>
    )
  }

  const { wavelengths_nm, values, x, y } = spectrum

  const data: Data[] = [
    {
      x: wavelengths_nm,
      y: values,
      type: 'scatter',
      mode: 'lines+markers',
      name: `Pixel (${x}, ${y})`,
    },
  ]

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 50, r: 20, t: 40, b: 50 },
    title: { text: `Spectrum at pixel (x=${x}, y=${y})` },
    xaxis: { title: { text: 'Wavelength (nm)' } },
    yaxis: { title: { text: 'Intensity / Reflectance' } },
  }

  return (
    <Plot
      data={data}
      layout={layout}
      style={{ width: '100%', height: '400px' }}
      useResizeHandler={true}
    />
  )
}

export default SpectrumPlot
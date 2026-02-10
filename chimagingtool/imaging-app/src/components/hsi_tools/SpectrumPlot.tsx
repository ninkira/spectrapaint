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
  spectra: Spectrum[]
}

const SpectrumPlot: React.FC<SpectrumPlotProps> = ({ spectra }) => {
  if (!spectra) {
    return (
      <div style={{ padding: '1rem', color: '#666' }}>
        Click on the image or ROI to see a spectrum.
      </div>
    )
  }

  const data: Data[] = spectra
  .filter((s): s is Exclude<Spectrum, null> => !!s)
  .map((s) => ({
    x: s.wavelengths_nm,
    y: s.values,
    type: 'scatter',
    mode: 'lines',
    name: `Pixel (${s.x}, ${s.y})`,
  }))


  const layout: Partial<Layout> = {
  autosize: true,
  margin: { l: 50, r: 20, t: 40, b: 50 },
  title: { text: `Spectra in selected ROI` },
  xaxis: { title: { text: 'Wavelength (nm)' } },
  yaxis: { title: { text: 'Intensity / Reflectance' } },
}


  return (
    <div>

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

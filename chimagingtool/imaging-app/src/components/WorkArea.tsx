// src/components/WorkArea.tsx

import { useState } from 'react'
import { useApp } from '../state/AppContext'
import PrimaryDisplay from './PrimaryDisplay'
import SpectrumPlot, { type Spectrum } from './hsi_tools/SpectrumPlot'
import MultiSpectrumPlot from './hsi_tools/MultiSpectrumPlot'
import DatasetList from './ui/DatasetList'

export default function WorkArea() {
  const { selectionMode, selectedSpectra } = useApp()

  const [spectrum, setSpectrum] = useState<Spectrum>(null)
  const [regionSpectra, setRegionSpectra] = useState<Spectrum[]>([])

  const isRegionMode =
    selectionMode === 'rect' || selectionMode === 'ellipse'
  const isMultiPixelMode =
    selectionMode === 'multiple' || selectionMode === 'line'

  let plot: React.ReactNode = null

  if (selectionMode === 'single') {
    plot = <SpectrumPlot spectrum={spectrum} />
  } else if (isMultiPixelMode) {
    plot = (
      <MultiSpectrumPlot
        spectra={selectedSpectra}
        title="Multiple spectra (clicked pixels)"
        emptyMessage="Click on the image to add spectra in multi-selection mode."
      />
    )
  } else if (isRegionMode) {
    plot = (
      <MultiSpectrumPlot
        spectra={regionSpectra}
        title="Region spectra (rectangle / ellipse)"
        emptyMessage="Drag a rectangle or ellipse on the image to select a region."
      />
    )
  }

  return (
    <div className="viewer-layout">
      {/* LEFT: image display */}
      <PrimaryDisplay
        onSpectrum={setSpectrum}
        onRegionSpectra={setRegionSpectra}
      />

      {/* RIGHT: dataset list + exactly one plot */}
      <section className="work-area" aria-label="Work Area">
        <DatasetList />
        {plot}
      </section>
    </div>
  )
}

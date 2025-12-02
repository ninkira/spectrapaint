// src/components/WorkArea.tsx (or similar)

import { useState } from 'react'
import { useApp } from '../state/AppContext'
import PrimaryDisplay from './PrimaryDisplay'
import SpectrumPlot, { type Spectrum } from './hsi_tools/SpectrumPlot'
import MultiSpectrumPlot from './hsi_tools/MultiSpectrumPlot'
import DatasetList from './ui/DatasetList'

export default function WorkArea() {
  const { selectionMode, selectedSpectra } = useApp()

  // local state: used only for SINGLE selection mode
  const [spectrum, setSpectrum] = useState<Spectrum>(null)

  return (
    <div className="viewer-layout">
      {/* LEFT: image display */}
      <PrimaryDisplay onSpectrum={setSpectrum} />

      {/* RIGHT: dataset list + plot(s) */}
      <section className="work-area" aria-label="Work Area">
        <DatasetList />

        {selectionMode === 'single' ? (
          <SpectrumPlot spectrum={spectrum} />
        ) : (
          <MultiSpectrumPlot spectra={selectedSpectra} />
        )}
      </section>
    </div>
  )
}

// src/components/WorkArea.tsx

import { useState } from 'react'
import { useApp } from '../state/AppContext'
import PrimaryDisplay from './PrimaryDisplay'
import SpectrumPlot, { type Spectrum } from './hsi_tools/SpectrumPlot'
import DatasetInfo from './Dataset/DatasetInfo'
import PigmentClassificationModal from './hsi_tools/PigmentClassification'

export default function WorkArea() {
  const {
    selectionMode,
    dataset,
    selectedRoiId,
    roiSpectraById,
    selectedProbeGroupId,
    probeSpectraByGroupId,
  } = useApp()

  const [spectrum, setSpectrum] = useState<Spectrum>(null)
  const [regionSpectra, setRegionSpectra] = useState<Spectrum[]>([])
  const [isOpen, setIsOpen] = useState(false)

  const isRegionMode =
    selectionMode === 'rect' || selectionMode === 'ellipse'
  const isMultiPixelMode =
    selectionMode === 'multiple' || selectionMode === 'line'

  const selectedSpectra =
    selectionMode === 'multiple' && selectedProbeGroupId
      ? probeSpectraByGroupId[selectedProbeGroupId] ?? []
      : selectedRoiId
        ? roiSpectraById[selectedRoiId] ?? []
        : []


  let plot: React.ReactNode = null

  if (selectionMode === 'single') {
    plot = <SpectrumPlot spectra={selectedSpectra} />
  } else if (isMultiPixelMode) {
    plot = (
      <SpectrumPlot
        spectra={selectedSpectra}
        title="Multiple spectra (clicked pixels)"
      
      />
    )
  } else if (isRegionMode) {
    plot = (
      <SpectrumPlot
        spectra={selectedSpectra}
        title="Region spectra (rectangle / ellipse)"
       
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
        <DatasetInfo />
        {plot}



        <div className="buttonRow">
          <button className="btn btn-primary" onClick={() => setIsOpen(true)}>
            Material Classification
          </button>


          <button className="btn btn-secondary">
            Export Region
          </button>
        </div>


        <PigmentClassificationModal
          isOpen={isOpen}
          title={dataset ? `Pigment Classification - ${dataset.name}` : 'Pigment Classification'}
          onClose={() => setIsOpen(false)}
          selectedRoiId={selectedRoiId}
          roiSpectraById={roiSpectraById}
        >
          {/* children */}
        </PigmentClassificationModal>




      </section>


    </div>
  )
}

// src/components/WorkArea.tsx

import { useState } from 'react'
import { useApp } from '../state/AppContext'
import PrimaryDisplay from './PrimaryDisplay'
import SpectrumPlot, { type Spectrum } from './hsi_tools/SpectrumPlot'
import MultiSpectrumPlot from './hsi_tools/MultiSpectrumPlot'
import DatasetInfo from './Dataset/DatasetInfo'
import PigmentClassificationModal from './hsi_tools/PigmentClassification'

export default function WorkArea() {
    const { selectionMode, selectedSpectra, dataset } = useApp()

  const [spectrum, setSpectrum] = useState<Spectrum>(null)
  const [regionSpectra, setRegionSpectra] = useState<Spectrum[]>([])
    const [isOpen, setIsOpen] = useState(false)

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
        <DatasetInfo />
        {plot}


        
        <div className="buttonRow">
          <button className="btn btn-primary" onClick={() => setIsOpen(true)}>
            Material Classification
          </button>


    <button className="btn btn-secondary">
    Export Region
  </button>

    
        <PigmentClassificationModal
          isOpen={isOpen}
          title={dataset ? `Pigment Classification – ${dataset.name}` : 'Pigment Classification'}
          onClose={() => setIsOpen(false)}
        >
          {dataset ? (
            <div style={{ fontSize: '0.9rem' }}>
              <p><strong>ID:</strong> {dataset.id}</p>
              <p><strong>Size:</strong> {dataset.width} × {dataset.height} pixels</p>
              <p><strong>Bands:</strong> {dataset.wavelengths_nm.length}</p>

              {/* Optional: show context */}
              <p><strong>Selection mode:</strong> {selectionMode}</p>
            </div>
          ) : (
            <p style={{ fontSize: '0.9rem' }}>
              No dataset loaded. Select a dataset to run pigment classification.
            </p>
          )}
        </PigmentClassificationModal>
    </div>



      </section>

               
    </div>
  )
}

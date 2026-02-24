// src/components/WorkArea.tsx

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import PrimaryDisplay from './PrimaryDisplay'
import SpectrumPlot, { type Spectrum } from './hsi_tools/SpectrumPlot'
import DatasetInfo from './Dataset/DatasetInfo'
import PigmentClassificationModal from './hsi_tools/PigmentClassification'

export default function WorkArea() {
  const {
    selectionMode,
    showSignalProcessing,
    dataset,
    selectedSpectra: globalSelectedSpectra,
    selectedRoiId,
    roiSpectraById,
    selectedProbePointId,
    selectedProbeGroupId,
    probeSpectraByGroupId,
    annotations,
    setAnnotationsForDataset,
    saveAnnotationsForDataset,
    setSelectedRoiId,
    setSelectedProbePointId,
  } = useApp()

  const [regionSpectra, setRegionSpectra] = useState<Spectrum[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [annotationTitle, setAnnotationTitle] = useState('')
  const [annotationDescription, setAnnotationDescription] = useState('')

  const isRegionMode =
    selectionMode === 'rect' || selectionMode === 'ellipse' || selectionMode === 'polygon'
  const isMultiPixelMode =
    selectionMode === 'multiple' || selectionMode === 'line'

  const selectedSpectra = useMemo(() => {
    if (selectionMode === 'multiple' && selectedProbeGroupId) {
      return probeSpectraByGroupId[selectedProbeGroupId] ?? []
    }
    if (selectionMode === 'multiple') {
      return globalSelectedSpectra
    }
    if (selectedRoiId) {
      return roiSpectraById[selectedRoiId] ?? []
    }
    return regionSpectra.length ? regionSpectra : globalSelectedSpectra
  }, [selectionMode, globalSelectedSpectra, selectedProbeGroupId, probeSpectraByGroupId, selectedRoiId, roiSpectraById, regionSpectra])

  const activeAnnotationId = selectedRoiId ?? selectedProbePointId
  const activeAnnotation = useMemo(
    () => annotations.find((a) => a.id === activeAnnotationId) ?? null,
    [annotations, activeAnnotationId]
  )

  useEffect(() => {
    setAnnotationTitle(activeAnnotation?.title ?? activeAnnotation?.label ?? '')
    setAnnotationDescription(activeAnnotation?.description ?? '')
  }, [activeAnnotationId, activeAnnotation?.title, activeAnnotation?.label, activeAnnotation?.description])

  const saveAnnotationMeta = async () => {
    if (!activeAnnotation || !dataset) return
    try {
      const cleanTitle = annotationTitle.trim()
      const cleanDescription = annotationDescription.trim()
      const nextForDataset = annotations
        .filter((a) => a.datasetId === dataset.id)
        .map((a) => (
          a.id === activeAnnotation.id
            ? {
              ...a,
              title: cleanTitle || undefined,
              label: cleanTitle || a.label,
              description: cleanDescription || undefined,
              updatedAt: new Date().toISOString(),
            }
            : a
        ))

      setAnnotationsForDataset(dataset.id, nextForDataset)
      await saveAnnotationsForDataset(dataset.id, nextForDataset)
    } catch (err) {
      console.error('Failed to save annotation', err)
    }
  }

  const deleteActiveAnnotation = async () => {
    if (!activeAnnotation || !dataset) return
    try {
      const nextForDataset = annotations
        .filter((a) => a.datasetId === dataset.id && a.id !== activeAnnotation.id)

      setAnnotationsForDataset(dataset.id, nextForDataset)
      if (activeAnnotation.kind === 'probe') {
        setSelectedProbePointId(null)
      } else {
        setSelectedRoiId(null)
      }
      await saveAnnotationsForDataset(dataset.id, nextForDataset)
    } catch (err) {
      console.error('Failed to delete annotation', err)
    }
  }


  let plot: React.ReactNode = null

  if (showSignalProcessing) {
    const title =
      isMultiPixelMode
        ? 'Multiple spectra (clicked pixels)'
        : isRegionMode
          ? 'Region spectra (rectangle / ellipse)'
          : 'Selected spectra'

    plot = <SpectrumPlot spectra={selectedSpectra} title={title} />
  }

  return (
    <div className="viewer-layout">
      {/* LEFT: image display */}
      <PrimaryDisplay
        onRegionSpectra={setRegionSpectra}
      />

      {/* RIGHT: dataset list + exactly one plot */}
      <section className="work-area" aria-label="Work Area">
        <DatasetInfo />
        {plot}



        {showSignalProcessing && (
          <div className="buttonRow">
            <button className="btn btn-primary" onClick={() => setIsOpen(true)}>
              Material Classification
            </button>

            <button className="btn btn-secondary">
              Export Region
            </button>
          </div>
        )}

        {activeAnnotation && (
          <section
            aria-label="Annotation metadata"
            style={{
              marginTop: '1rem',
              border: '1px solid #2a3445',
              borderRadius: '8px',
              padding: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Annotation Metadata</h3>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              Title
              <input
                type="text"
                value={annotationTitle}
                onChange={(e) => setAnnotationTitle(e.target.value)}
                placeholder="Annotation title"
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #3a465c' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              Description
              <textarea
                value={annotationDescription}
                onChange={(e) => setAnnotationDescription(e.target.value)}
                placeholder="Annotation description"
                rows={3}
                style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #3a465c' }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn btn-secondary" type="button" onClick={() => void deleteActiveAnnotation()}>
                Delete Annotation
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void saveAnnotationMeta()}>
                Save Annotation
              </button>
            </div>
          </section>
        )}


        <PigmentClassificationModal
          isOpen={isOpen}
          title={dataset ? `Pigment Classification - ${dataset.name}` : 'Pigment Classification'}
          onClose={() => setIsOpen(false)}
          datasetId={dataset?.id ?? null}
          selectedRoiId={selectedRoiId}
          roiSpectraById={roiSpectraById}
        >
          {/* children */}
        </PigmentClassificationModal>




      </section>


    </div>
  )
}

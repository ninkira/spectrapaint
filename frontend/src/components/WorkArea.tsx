// src/components/WorkArea.tsx

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppContext'
import PrimaryDisplay from './PrimaryDisplay'
import SpectrumPlot, { type Spectrum } from './hsi_tools/SpectrumPlot'
import DatasetInfo from './Dataset/DatasetInfo'
import PigmentClassificationModal from './hsi_tools/PigmentClassification'

// The 13 standard W3C WADM motivations, plus `analysis` (app-specific: covers
// classification / analysis operations). Users can also type their own via "Custom…".
const MOTIVATION_OPTIONS = [
  'assessing',
  'bookmarking',
  'classifying',
  'commenting',
  'describing',
  'editing',
  'highlighting',
  'identifying',
  'linking',
  'moderating',
  'questioning',
  'replying',
  'tagging',
  'analysis',
] as const

export default function WorkArea() {
  const {
    selectionMode,
    showSignalProcessing,
    dataset,
    selectedSpectra: globalSelectedSpectra,
    selectedRoiId,
    roiSpectraById,
    roiExtractionById,
    loadRoiExtraction,
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
  const [annotationCreator, setAnnotationCreator] = useState('')
  const [annotationMotivations, setAnnotationMotivations] = useState<string[]>([])
  const [addingCustomMotivation, setAddingCustomMotivation] = useState(false)
  const [customMotivationText, setCustomMotivationText] = useState('')

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

  // An ROI drawn in this session already has its per-pixel spectra in memory. One loaded from
  // the database has none, so fetch the statistics measured when it was saved. Done here rather
  // than in each shape's click handler so there is one trigger instead of five.
  useEffect(() => {
    if (!dataset || !selectedRoiId) return
    if ((roiSpectraById[selectedRoiId] ?? []).length) return
    void loadRoiExtraction(dataset.id, selectedRoiId)
  }, [dataset, selectedRoiId, roiSpectraById, loadRoiExtraction])

  const roiExtraction = selectedRoiId ? (roiExtractionById[selectedRoiId] ?? null) : null

  const activeAnnotationId = selectedRoiId ?? selectedProbePointId
  const activeAnnotation = useMemo(
    () => annotations.find((a) => a.id === activeAnnotationId) ?? null,
    [annotations, activeAnnotationId]
  )

  useEffect(() => {
    setAnnotationTitle(activeAnnotation?.title ?? activeAnnotation?.label ?? '')
    setAnnotationDescription(activeAnnotation?.description ?? '')
    setAnnotationCreator(
      activeAnnotation?.creator ?? localStorage.getItem('spectrapaint.lastCreator') ?? ''
    )
    const motivation = activeAnnotation?.motivation
    setAnnotationMotivations(
      Array.isArray(motivation) ? motivation : motivation ? [motivation] : []
    )
    setAddingCustomMotivation(false)
    setCustomMotivationText('')
  }, [activeAnnotationId, activeAnnotation?.title, activeAnnotation?.label, activeAnnotation?.description, activeAnnotation?.creator, activeAnnotation?.motivation])

  const addMotivation = (m: string) => {
    const value = m.trim()
    if (!value) return
    setAnnotationMotivations((prev) => (prev.includes(value) ? prev : [...prev, value]))
  }
  const removeMotivation = (m: string) => {
    setAnnotationMotivations((prev) => prev.filter((x) => x !== m))
  }
  const commitCustomMotivation = () => {
    addMotivation(customMotivationText)
    setCustomMotivationText('')
    setAddingCustomMotivation(false)
  }

  const saveAnnotationMeta = async () => {
    if (!activeAnnotation || !dataset) return
    try {
      const cleanTitle = annotationTitle.trim()
      const cleanDescription = annotationDescription.trim()
      const cleanCreator = annotationCreator.trim()
      if (cleanCreator) localStorage.setItem('spectrapaint.lastCreator', cleanCreator)
      const nextForDataset = annotations
        .filter((a) => a.datasetId === dataset.id)
        .map((a) => (
          a.id === activeAnnotation.id
            ? {
              ...a,
              title: cleanTitle || undefined,
              label: cleanTitle || a.label,
              description: cleanDescription || undefined,
              creator: cleanCreator || undefined,
              motivation: annotationMotivations.length ? annotationMotivations : undefined,
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
        ? 'Multiple spectra (selected pixels)'
        : isRegionMode
          ? 'Region spectra (rectangle / ellipse / polygon)'
          : 'Selected spectra'

    // `stats` wins over recomputing from per-pixel spectra, and is the only source a saved ROI
    // has — its individual signals are not shipped to the browser.
    plot = (
      <SpectrumPlot
        spectra={selectedSpectra}
        stats={roiExtraction?.stats ?? null}
        wavelengthsNm={roiExtraction?.wavelengths_nm}
        title={title}
      />
    )
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Annotation Metadata</h3>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                title="Creator of this annotation"
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="#3b82f6"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-2.76-3.58-5-8-5Z" />
                </svg>
                <input
                  type="text"
                  value={annotationCreator}
                  onChange={(e) => setAnnotationCreator(e.target.value)}
                  placeholder="Creator"
                  aria-label="Annotation creator"
                  style={{
                    width: '9rem',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '6px',
                    border: '1px solid #3a465c',
                    background: 'transparent',
                    color: 'inherit',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
            </div>
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

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              Motivation
              {annotationMotivations.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {annotationMotivations.map((m) => (
                    <span
                      key={m}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '999px',
                        border: '1px solid #3a465c',
                        background: '#1b2434',
                        fontSize: '0.8rem',
                      }}
                    >
                      {m}
                      <button
                        type="button"
                        onClick={() => removeMotivation(m)}
                        title={`Remove ${m}`}
                        aria-label={`Remove ${m}`}
                        style={{
                          display: 'inline-flex',
                          border: 'none',
                          background: 'transparent',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: 0,
                          lineHeight: 1,
                          fontSize: '1rem',
                          opacity: 0.7,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {addingCustomMotivation ? (
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <input
                    type="text"
                    value={customMotivationText}
                    onChange={(e) => setCustomMotivationText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitCustomMotivation()
                      }
                    }}
                    placeholder="Type a motivation, press Enter"
                    aria-label="Custom motivation"
                    autoFocus
                    style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid #3a465c' }}
                  />
                  <button
                    type="button"
                    onClick={commitCustomMotivation}
                    style={{ padding: '0 0.7rem', borderRadius: '6px', border: '1px solid #3a465c', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomMotivationText('')
                      setAddingCustomMotivation(false)
                    }}
                    title="Cancel"
                    aria-label="Cancel"
                    style={{ padding: '0 0.7rem', borderRadius: '6px', border: '1px solid #3a465c', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <select
                  value=""
                  onChange={(e) => {
                    const value = e.target.value
                    if (!value) return
                    if (value === '__custom__') {
                      setAddingCustomMotivation(true)
                    } else {
                      addMotivation(value)
                    }
                  }}
                  style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #3a465c' }}
                >
                  <option value="">Add motivation…</option>
                  {MOTIVATION_OPTIONS.filter((m) => !annotationMotivations.includes(m)).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
              )}
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
          roiExtraction={roiExtraction}
        >
          {/* children */}
        </PigmentClassificationModal>




      </section>


    </div>
  )
}

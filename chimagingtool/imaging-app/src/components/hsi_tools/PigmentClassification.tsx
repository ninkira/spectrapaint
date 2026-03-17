// imaging-app/src/components/hsi_tools/PigmentClassification.tsx
import React, { useEffect, useState } from 'react'
import SpectrumPlot, { type Spectrum } from './SpectrumPlot'
import InfoModal from '../Dataset/DatasetInfoModal'

interface PigmentClassificationModalProps {
  isOpen: boolean
  title: string
  onClose: () => void
  children?: React.ReactNode
  datasetId: string | null
  selectedRoiId: string | null
  roiSpectraById: Record<string, Spectrum[]>
}

type TopMatch = {
  rank: number
  pigment_name: string
  spectra_name_prefix?: string
  label_name?: string
  label_group?: string
  score: number
  values: number[]
}

const getTopMatchDisplayName = (m: TopMatch): string => {
  const label = (m.label_name ?? '').trim()
  const raw = (m.pigment_name ?? '').trim()
  if (label && label.toLowerCase() !== raw.toLowerCase()) return label
  return (m.spectra_name_prefix ?? m.pigment_name).trim()
}

const PigmentClassificationModal: React.FC<PigmentClassificationModalProps> = ({
  isOpen,
  title,
  onClose,
  children,
  datasetId,
  selectedRoiId,
  roiSpectraById,
}) => {
  const [methods, setMethods] = useState<{ id: string; label: string }[]>([])
  const [libraries, setLibraries] = useState<{ id: string; label: string }[]>([])
  const [classificationMethodId, setClassificationMethodId] = useState('')
  const [referenceLibraryId, setReferenceLibraryId] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultJson, setResultJson] = useState<string | null>(null)
  const [topMatches, setTopMatches] = useState<TopMatch[]>([])
  const [libraryWavelengths, setLibraryWavelengths] = useState<number[]>([])

  useEffect(() => {
    if (!isOpen) return

    const loadOptions = async () => {
      try {
        setError(null)
        const [methodsRes, libsRes] = await Promise.all([
          fetch('/api/classification/methods'),
          fetch('/api/classification/libraries'),
        ])
        if (!methodsRes.ok) throw new Error(`Methods failed (${methodsRes.status})`)
        if (!libsRes.ok) throw new Error(`Libraries failed (${libsRes.status})`)

        const methodsData = await methodsRes.json()
        const libsData = await libsRes.json()

        const loadedMethods = methodsData.methods ?? []
        const loadedLibs = (libsData.libraries ?? []).map((lib: { id: string; label: string }) => ({
          id: lib.id,
          label: lib.label,
        }))

        setMethods(loadedMethods)
        setLibraries(loadedLibs)
        setClassificationMethodId(loadedMethods[0]?.id ?? '')
        setReferenceLibraryId(loadedLibs[0]?.id ?? '')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load classification options')
      }
    }

    loadOptions()
  }, [isOpen])

  const selectedSpectra = selectedRoiId ? (roiSpectraById[selectedRoiId] ?? []) : []

  const computeMeanSignal = (spectra: Spectrum[]) => {
    const nonNull = spectra.filter((s): s is Exclude<Spectrum, null> => !!s)
    if (!nonNull.length) return null
    const wavelengths = nonNull[0].wavelengths_nm
    const nBands = wavelengths.length
    const sums = new Array(nBands).fill(0)

    for (const s of nonNull) {
      if (s.values.length !== nBands) return null
      for (let i = 0; i < nBands; i += 1) sums[i] += s.values[i]
    }

    const meanValues = sums.map((v) => v / nonNull.length)
    return { wavelengths_nm: wavelengths, values: meanValues }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!datasetId || !selectedRoiId || !classificationMethodId || !referenceLibraryId) return

    const meanSignal = computeMeanSignal(selectedSpectra)
    if (!meanSignal) {
      setError('No valid ROI spectra available for classification.')
      return
    }

    try {
      setIsRunning(true)
      setError(null)
      setResultJson(null)
      setTopMatches([])
      setLibraryWavelengths([])

      const res = await fetch('/api/classification/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId,
          roi_id: selectedRoiId,
          preprocessing_method_id: null,
          classification_method_id: classificationMethodId,
          reference_library_id: referenceLibraryId,
          mean_signal: meanSignal,
          top_k: 5
        }),
      })

      if (!res.ok) throw new Error(`Run failed (${res.status})`)
      const data = await res.json()
      setResultJson(JSON.stringify(data, null, 2))
      const matches = (data?.results?.top_matches ?? []) as TopMatch[]
      const wl = Array.isArray(data?.library?.wavelengths_nm)
        ? (data.library.wavelengths_nm as number[])
        : []
      setTopMatches(matches)
      setLibraryWavelengths(wl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setIsRunning(false)
    }
  }

  const comparisonSpectra = topMatches.map((m) => ({
    name: `${m.rank}. ${getTopMatchDisplayName(m)}`,
    values: m.values,
    wavelengths_nm: libraryWavelengths.length ? libraryWavelengths : undefined,
  }))

  if (!isOpen) return null

  return (
    <InfoModal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      panelStyle={{
        width: 'min(1100px, 95vw)',
        maxWidth: '95vw',
        maxHeight: '90vh',
        color: '#111',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(360px, 1fr) minmax(280px, 360px)',
          gap: '1rem',
          alignItems: 'start',
        }}
      >
        <div>
          {children}
          <h3>Result Display</h3>
          <SpectrumPlot
            spectra={selectedSpectra}
            comparisonSpectra={comparisonSpectra}
            title="ROI mean and identified pigment signals"
          />
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <h2>Pigment Classification Options</h2>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Analysis Method
            <select value={classificationMethodId} onChange={(e) => setClassificationMethodId(e.target.value)}>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Reference Library
            <select value={referenceLibraryId} onChange={(e) => setReferenceLibraryId(e.target.value)}>
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </label>

          <button type="submit" disabled={isRunning || !datasetId || !selectedRoiId || !classificationMethodId || !referenceLibraryId}>
            {isRunning ? 'Running...' : 'Run classification'}
          </button>

          {error && <div style={{ color: 'crimson' }}>{error}</div>}
          {topMatches.length > 0 && (
            <section
              aria-label="Top 3 classification matches"
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: '0.5rem 0.75rem',
                background: '#fafafa',
              }}
            >
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: 14 }}>Top 3 Matches</h3>
              <ol style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {topMatches.slice(0, 3).map((m) => (
                  <li key={`${m.rank}-${m.pigment_name}`} style={{ marginBottom: '0.4rem' }}>
                    <strong>{getTopMatchDisplayName(m)}</strong>
                    {` (${m.spectra_name_prefix ?? m.pigment_name}) - similarity score ${m.score.toFixed(4)}`}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {resultJson && (
            <pre style={{ margin: 0, fontSize: 12, background: '#f4f4f4', padding: '0.5rem', borderRadius: 6, maxHeight: 240, overflow: 'auto' }}>
              {resultJson}
            </pre>
          )}
        </form>
      </div>
    </InfoModal>
  )
}

export default PigmentClassificationModal

// frontend/src/components/hsi_tools/PigmentClassification.tsx
import React, { useEffect, useState } from 'react'
import SpectrumPlot, { type Spectrum } from './SpectrumPlot'
import InfoModal from '../Dataset/DatasetInfoModal'
import type { RoiExtraction } from '../../lib/api'

interface PigmentClassificationModalProps {
  isOpen: boolean
  title: string
  onClose: () => void
  children?: React.ReactNode
  datasetId: string | null
  selectedRoiId: string | null
  roiSpectraById: Record<string, Spectrum[]>
  /** Statistics measured when the ROI was saved. The only source for an ROI restored from the
   *  database, whose per-pixel spectra are not held in the browser. */
  roiExtraction: RoiExtraction | null
}

/** How the query and the library were put on a common wavelength grid. Recorded per run. */
type AlignmentInfo = {
  mode: 'resample' | 'truncate'
  n_bands: number
  overlap_nm: [number, number] | null
  warnings: string[]
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
  roiExtraction,
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
  const [alignment, setAlignment] = useState<AlignmentInfo | null>(null)
  const [querySource, setQuerySource] = useState<string | null>(null)

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

    // An ROI drawn in this session has its per-pixel spectra here; one restored from the
    // database does not. In that case send no mean_signal at all — the backend then classifies
    // the spectrum measured when the ROI was saved, which is the authoritative one regardless.
    const meanSignal = computeMeanSignal(selectedSpectra)
    if (!meanSignal && !roiExtraction) {
      setError('This ROI has no spectra yet. Save the annotation, then try again.')
      return
    }

    try {
      setIsRunning(true)
      setError(null)
      setResultJson(null)
      setTopMatches([])
      setLibraryWavelengths([])
      setAlignment(null)
      setQuerySource(null)

      const res = await fetch('/api/classification/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId,
          roi_id: selectedRoiId,
          preprocessing_method_id: null,
          classification_method_id: classificationMethodId,
          reference_library_id: referenceLibraryId,
          ...(meanSignal ? { mean_signal: meanSignal } : {}),
          top_k: 5
        }),
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail ?? `Run failed (${res.status})`)
      }
      const data = await res.json()
      setResultJson(JSON.stringify(data, null, 2))
      const matches = (data?.results?.top_matches ?? []) as TopMatch[]
      const wl = Array.isArray(data?.library?.wavelengths_nm)
        ? (data.library.wavelengths_nm as number[])
        : []
      setTopMatches(matches)
      setLibraryWavelengths(wl)
      setAlignment((data?.results?.alignment ?? null) as AlignmentInfo | null)
      setQuerySource((data?.results?.query_source ?? null) as string | null)
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
            stats={roiExtraction?.stats ?? null}
            wavelengthsNm={roiExtraction?.wavelengths_nm}
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

          {/* What is actually being classified — measured server-side when the ROI was saved. */}
          {roiExtraction && (
            <section
              aria-label="Region statistics"
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: '0.5rem 0.75rem',
                background: '#fafafa',
                fontSize: 13,
              }}
            >
              <h3 style={{ margin: '0 0 0.35rem 0', fontSize: 14 }}>Region statistics</h3>
              <div>{roiExtraction.stats.n_pixels.toLocaleString()} pixels</div>
              <div>{roiExtraction.stats.mean.length} bands · {roiExtraction.wavelength_range ?? 'unknown range'}</div>
              <div style={{ color: '#555' }}>
                Mean spectral variance across the region is shown as the ±1σ band on the plot.
              </div>
            </section>
          )}

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
          {alignment && (
            <section
              aria-label="How the spectra were compared"
              style={{
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: '0.5rem 0.75rem',
                fontSize: 12,
                color: '#444',
              }}
            >
              <h3 style={{ margin: '0 0 0.35rem 0', fontSize: 13 }}>How this was compared</h3>
              <div>
                {alignment.mode === 'resample'
                  ? `Library resampled onto ${alignment.n_bands} query bands`
                  : `Compared band-by-band over ${alignment.n_bands} bands`}
                {alignment.overlap_nm &&
                  ` (${alignment.overlap_nm[0].toFixed(1)}–${alignment.overlap_nm[1].toFixed(1)} nm)`}
              </div>
              <div>
                Query spectrum from {querySource === 'extraction' ? 'the saved region' : 'the current selection'}
              </div>
              {alignment.warnings.map((w) => (
                <div key={w} style={{ color: '#a15c00', marginTop: '0.25rem' }}>{w}</div>
              ))}
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

// imaging-app/src/components/hsi_tools/PigmentClassification.tsx
import React, { useEffect, useMemo, useState } from 'react'
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

const PigmentClassificationModal: React.FC<PigmentClassificationModalProps> = ({
  isOpen,
  title,
  onClose,
  children,
  datasetId,
  selectedRoiId,
  roiSpectraById,
}) => {
  type TopMatch = {
    rank: number
    index: number
    pigment_name: string
    score: number
    values: number[]
    label_name?: string
    label_group?: string
  }

  const [methods, setMethods] = useState<{ id: string; label: string }[]>([])
  const [libraries, setLibraries] = useState<
    { id: string; label: string; group?: string; variant?: string }[]
  >([])
  const [classificationMethodId, setClassificationMethodId] = useState('')
  const [referenceLibraryId, setReferenceLibraryId] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [topMatches, setTopMatches] = useState<TopMatch[]>([])
  const [matchWavelengths, setMatchWavelengths] = useState<number[] | null>(null)
  const groupedLibraries = useMemo(() => {
    const grouped: Record<string, { id: string; label: string; variant?: string }[]> = {}
    for (const lib of libraries) {
      const key = lib.group ?? 'Libraries'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(lib)
    }
    return grouped
  }, [libraries])

  useEffect(() => {
    if (!isOpen) return

    const loadData = async () => {
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
        const loadedLibraries = libsData.libraries ?? []
        setMethods(loadedMethods)
        setLibraries(loadedLibraries)
        setClassificationMethodId(loadedMethods[0]?.id ?? '')
        setReferenceLibraryId(loadedLibraries[0]?.id ?? '')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load classification options')
      }
    }

    loadData()
  }, [isOpen])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!datasetId || !selectedRoiId || !classificationMethodId || !referenceLibraryId) return

    const nonNullSpectra = (roiSpectraById[selectedRoiId] ?? []).filter(
      (s): s is Exclude<Spectrum, null> => !!s
    )
    if (nonNullSpectra.length === 0) {
      setError('No spectra available for selected ROI')
      return
    }

    const first = nonNullSpectra[0]
    const nBands = first.values.length
    const sums = new Array<number>(nBands).fill(0)
    for (const spec of nonNullSpectra) {
      for (let i = 0; i < nBands; i += 1) sums[i] += spec.values[i]
    }
    const meanValues = sums.map((v) => v / nonNullSpectra.length)

    try {
      setIsRunning(true)
      setError(null)
      setResultMessage(null)
      setTopMatches([])

      const res = await fetch('/api/classification/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId,
          roi_id: selectedRoiId,
          preprocessing_method_id: null,
          classification_method_id: classificationMethodId,
          reference_library_id: referenceLibraryId,
          mean_signal: {
            wavelengths_nm: first.wavelengths_nm,
            values: meanValues,
          },
          top_k: 3,
        }),
      })

      if (!res.ok) throw new Error(`Run failed (${res.status})`)
      const data = await res.json()
      const method = data?.results?.classification_method ?? classificationMethodId
      const library = data?.results?.reference_library_label ?? referenceLibraryId
      setTopMatches((data?.results?.top_matches ?? []) as TopMatch[])
      setMatchWavelengths(Array.isArray(data?.library?.wavelengths_nm) ? data.library.wavelengths_nm : null)
      setResultMessage(`Pipeline ran with "${method}" against "${library}".`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setIsRunning(false)
    }
  }

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
            spectra={selectedRoiId ? (roiSpectraById[selectedRoiId] ?? []) : []}
            comparisonSpectra={topMatches.map((m) => ({
              name: `${m.rank}) ${m.label_name ?? m.pigment_name} (score=${m.score.toFixed(4)})`,
              values: m.values,
              wavelengths_nm: matchWavelengths ?? undefined,
            }))}
            title="ROI mean and top-3 pigment matches"
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
              {Object.entries(groupedLibraries).map(([group, libs]) => (
                <optgroup key={group} label={group}>
                  {libs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.variant ?? l.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={isRunning || !datasetId || !selectedRoiId || !classificationMethodId || !referenceLibraryId}
          >
            {isRunning ? 'Running...' : 'Run classification'}
          </button>

          {error && <div style={{ color: 'crimson' }}>{error}</div>}
          {resultMessage && <div style={{ color: '#14532d' }}>{resultMessage}</div>}
          {topMatches.length > 0 && (
            <div style={{ fontSize: '0.9rem' }}>
              <strong>Top matches:</strong>
              <ol style={{ margin: '0.4rem 0 0 1.2rem' }}>
                {topMatches.map((m) => (
                  <li key={`${m.rank}-${m.index}`}>
                    {m.label_name ?? m.pigment_name}
                    {m.label_group ? ` - ${m.label_group}` : ''}
                    {` (${m.score.toFixed(6)})`}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </form>
      </div>
    </InfoModal>
  )


}

export default PigmentClassificationModal

// imaging-app/src/components/hsi_tools/PigmentClassification.tsx
import React, { useEffect, useState } from 'react'
import SpectrumPlot, { type Spectrum } from './SpectrumPlot'
import InfoModal from '../Dataset/DatasetInfoModal'

interface PigmentClassificationModalProps {
  isOpen: boolean
  title: string
  onClose: () => void
  children?: React.ReactNode
  selectedRoiId: string | null
  roiSpectraById: Record<string, Spectrum[]>
}

const PigmentClassificationModal: React.FC<PigmentClassificationModalProps> = ({
  isOpen,
  title,
  onClose,
  children,
  selectedRoiId,
  roiSpectraById,
}) => {
  const [methods, setMethods] = useState<{ id: string; label: string }[]>([])
  const [methodId, setMethodId] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const loadMethods = async () => {
      try {
        setError(null)
        const r = await fetch('/api/classification/methods')
        if (!r.ok) throw new Error(`Methods failed (${r.status})`)
        const data = await r.json()
        const loaded = data.methods ?? []
        setMethods(loaded)
        setMethodId(loaded[0]?.id ?? '')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load methods')
      }
    }

    loadMethods()
  }, [isOpen])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedRoiId || !methodId) return

    try {
      setIsRunning(true)
      setError(null)

      const res = await fetch('/api/classification/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          methodId,
          roiId: selectedRoiId,
          spectra: roiSpectraById[selectedRoiId] ?? [],
        }),
      })

      if (!res.ok) throw new Error(`Run failed (${res.status})`)
      // TODO: handle response payload if needed
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
          <SpectrumPlot spectra={selectedRoiId ? (roiSpectraById[selectedRoiId] ?? []) : []} />
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
            Preprocessing Method
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>



          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Analysis Method
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>

          <button type="submit" disabled={isRunning || !selectedRoiId || !methodId}>
            {isRunning ? 'Running...' : 'Run classification'}
          </button>

          {error && <div style={{ color: 'crimson' }}>{error}</div>}
        </form>
      </div>
    </InfoModal>
  )


}

export default PigmentClassificationModal

import React, { useEffect, useState } from 'react'
import InfoModal from './DatasetInfoModal'
import { FiInfo } from 'react-icons/fi'


export interface DatasetMeta {
  id: string
  name: string
  width: number
  height: number
  wavelengths_nm: number[]
}

interface DatasetInfoProps {
  apiBaseUrl?: string
}

const DatasetInfo: React.FC<DatasetInfoProps> = ({ apiBaseUrl = '/api' }) => {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DatasetMeta | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const fetchDatasets = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${apiBaseUrl}/datasets`)
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`)
        const data: DatasetMeta[] = await res.json()
        setDatasets(data)
        setSelected(data[0] ?? null) // pick default (optional)
      } catch (err: any) {
        setError(err.message ?? 'Failed to load datasets')
      } finally {
        setLoading(false)
      }
    }
    fetchDatasets()
  }, [apiBaseUrl])

  if (loading) return <div style={{ padding: '1rem' }}>Loading datasets…</div>
  if (error) return <div style={{ padding: '1rem', color: 'red' }}>Error: {error}</div>
  if (!datasets.length) return <div style={{ padding: '1rem' }}>No datasets found.</div>

  return (
    <div style={{ padding: '1rem' }}>
      {selected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 style={{ margin: 0 }}>{selected.name}</h2>
          <button type="button" onClick={() => setIsOpen(true)}>
 <FiInfo aria-hidden="true" />
          </button>
        </div>
      ) : (
        <p>No dataset selected.</p>
      )}

      <InfoModal
        isOpen={isOpen}
        title={selected?.name ?? ''}
        onClose={() => setIsOpen(false)}
      >
        {selected && (
          <div style={{ fontSize: '0.9rem' }}>
            <p><strong>ID:</strong> {selected.id}</p>
            <p><strong>Size:</strong> {selected.width} × {selected.height} pixels</p>
            <p><strong>Number of bands:</strong> {selected.wavelengths_nm.length}</p>
          </div>
        )}
      </InfoModal>
    </div>
  )
}

export default DatasetInfo

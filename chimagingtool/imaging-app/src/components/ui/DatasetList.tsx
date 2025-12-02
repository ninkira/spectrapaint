// components/DatasetList.tsx
import React, { useEffect, useState } from 'react'
import InfoModal from './DatasetInfoModal'

export interface DatasetMeta {
  id: string
  name: string
  width: number
  height: number
  wavelengths_nm: number[]
}

interface DatasetListProps {
  apiBaseUrl?: string // optional to override base URL
}

const DatasetList: React.FC<DatasetListProps> = ({ apiBaseUrl = 'http://localhost:8000' }) => {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DatasetMeta | null>(null)

  useEffect(() => {
    const fetchDatasets = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${apiBaseUrl}/datasets`)
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`)
        }
        const data: DatasetMeta[] = await res.json()
        setDatasets(data)
      } catch (err: any) {
        setError(err.message ?? 'Failed to load datasets')
      } finally {
        setLoading(false)
      }
    }

    fetchDatasets()
  }, [apiBaseUrl])

  if (loading) return <div style={{ padding: '1rem' }}>Loading datasets…</div>
  if (error)
    return (
      <div style={{ padding: '1rem', color: 'red' }}>
        Error loading datasets: {error}
      </div>
    )
  if (!datasets.length)
    return <div style={{ padding: '1rem' }}>No datasets found.</div>

  return (
    <div style={{ padding: '1rem' }}>
      <h2>Available datasets</h2>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Name</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>Size</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>
              # bands
            </th>
            <th style={{ borderBottom: '1px solid #ccc' }} />
          </tr>
        </thead>
        <tbody>
          {datasets.map((ds) => (
            <tr key={ds.id}>
              <td style={{ padding: '0.35rem 0.5rem' }}>{ds.name}</td>
              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>
                {ds.width} × {ds.height}
              </td>
              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>
                {ds.wavelengths_nm.length}
              </td>
              <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>
                <button onClick={() => setSelected(ds)}>Details</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Generic modal, dataset-specific content */}
      <InfoModal
        isOpen={!!selected}
        title={selected ? selected.name : ''}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div style={{ fontSize: '0.9rem' }}>
            <p>
              <strong>ID:</strong> {selected.id}
            </p>
            <p>
              <strong>Size:</strong> {selected.width} × {selected.height} pixels
            </p>
            <p>
              <strong>Number of bands:</strong> {selected.wavelengths_nm.length}
            </p>
            <p>
              <strong>Wavelength range:</strong>{' '}
              {selected.wavelengths_nm.length > 0
                ? `${selected.wavelengths_nm[0]} – ${
                    selected.wavelengths_nm[selected.wavelengths_nm.length - 1]
                  } nm`
                : 'n/a'}
            </p>

            {/* you can add more meta fields here, or even a mini plot */}
          </div>
        )}
      </InfoModal>
    </div>
  )
}

export default DatasetList

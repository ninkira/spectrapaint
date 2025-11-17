// PrimaryDisplay.tsx
import { useRef, type MouseEvent } from 'react'
import { useApp } from '../state/AppContext'
import BandPicker from './hsi_tools/BandPicker'
import type { Spectrum } from './hsi_tools/SpectrumPlot'

interface PrimaryDisplayProps {
  onSpectrum?: (s: Spectrum) => void
}

export default function PrimaryDisplay({ onSpectrum }: PrimaryDisplayProps) {
  const { layers, rgbImgUrl, dataset } = useApp()
  const show = layers.find(l => l.id === 'rgb')?.on
  const imgRef = useRef<HTMLImageElement | null>(null)

  const handleImageClick = async (e: MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current
    if (!img || !dataset || !onSpectrum) return

    const rect = img.getBoundingClientRect()
    const xDisplay = e.clientX - rect.left
    const yDisplay = e.clientY - rect.top

    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height
    const xImg = Math.floor(xDisplay * scaleX)
    const yImg = Math.floor(yDisplay * scaleY)

    const params = new URLSearchParams({
      x: xImg.toString(),
      y: yImg.toString(),
    })

    const res = await fetch(`/api/datasets/${dataset.id}/spectra?${params}`)
    if (!res.ok) {
      console.error('Failed to fetch spectrum', await res.text())
      return
    }

    const data = await res.json()
    onSpectrum(data)
  }

  return (
    <section className="primary-display" aria-label="Primary Display">
      {show && rgbImgUrl ? (
        <img
          ref={imgRef}
          src={rgbImgUrl}
          alt={`RGB composite ${dataset ? `– ${dataset.name}` : ''}`}
          style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
          onClick={handleImageClick}
        />
      ) : (
        <div className="placeholder">No layer visible</div>
      )}
<br/>
      <BandPicker />
    </section>
  )
}

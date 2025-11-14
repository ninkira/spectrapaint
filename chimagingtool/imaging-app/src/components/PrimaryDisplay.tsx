// PrimaryDisplay.tsx
import { useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { useApp } from '../state/AppContext'
import SpectrumPlot from './HSITool'

type Spectrum = {
  wavelengths_nm: number[]
  values: number[]
  x: number
  y: number
} | null

export default function PrimaryDisplay() {
  const { layers, rgbImgUrl, dataset } = useApp()
  const show = layers.find(l => l.id === 'rgb')?.on

  const imgRef = useRef<HTMLImageElement | null>(null)
  const [spectrum, setSpectrum] = useState<Spectrum>(null)
  const [selectedDisplayPixel, setSelectedDisplayPixel] = useState<{ x: number; y: number } | null>(null)

  const handleImageClick = async (e: MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current
    if (!img) return

    const rect = img.getBoundingClientRect()

    // Click position relative to the rendered image
    const xDisplay = e.clientX - rect.left
    const yDisplay = e.clientY - rect.top

    // Map to image pixel coordinates (natural resolution of the image)
    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height

    const xImg = Math.floor(xDisplay * scaleX)
    const yImg = Math.floor(yDisplay * scaleY)

    // Store for marker overlay
    setSelectedDisplayPixel({ x: xDisplay, y: yDisplay })

    try {
      const params = new URLSearchParams({ x: xImg.toString(), y: yImg.toString() })
      const res = await fetch(`/api/spectrum?${params.toString()}`)

      if (!res.ok) {
        console.error('Failed to fetch spectrum', await res.text())
        return
      }

      const data = await res.json()
      setSpectrum(data)
    } catch (err) {
      console.error('Error fetching spectrum', err)
    }
  }

  return (
    <section className="primary-display" aria-label="Primary Display">
      {show && rgbImgUrl ? (
        <>
          <div
            className="image-wrapper"
            style={{ position: 'relative', width: '100%', maxHeight: '60vh', overflow: 'hidden' }}
          >
            <img
              ref={imgRef}
              src={rgbImgUrl}
              alt={`RGB composite ${dataset ? `– ${dataset.name}` : ''}`}
              style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
              onClick={handleImageClick}
            />

            {/* Marker at clicked position (in displayed coords) */}
            {selectedDisplayPixel && (
              <div
                style={{
                  position: 'absolute',
                  left: selectedDisplayPixel.x - 5,
                  top: selectedDisplayPixel.y - 5,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  border: '2px solid #ff0000',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>

     

          {/* Spectrum plot below the image */}
          <div style={{ marginTop: '1rem' }}>
            <SpectrumPlot spectrum={spectrum} />
          </div>
        </>
      ) : (
        <div className="placeholder">No layer visible</div>
      )}
    </section>
  )
}
import { useRef, type MouseEvent } from 'react'
import { useApp } from '../state/AppContext'
import BandPicker from './hsi_tools/BandPicker'
import type { Spectrum } from './hsi_tools/SpectrumPlot'

interface PrimaryDisplayProps {
  onSpectrum?: (s: Spectrum) => void
}

export default function PrimaryDisplay({ onSpectrum }: PrimaryDisplayProps) {
  const {
    layers,
    rgbImgUrl,
    dataset,
    selectionMode,
    selectedSpectra,
    addSpectrum,
    clearSpectra,
  } = useApp()

  const show = layers.find((l) => l.id === 'rgb')?.on
  const imgRef = useRef<HTMLImageElement | null>(null)

  // ---------------------------------------------
  // CLICK HANDLER (single + multi modes)
  // ---------------------------------------------
  const handleImageClick = async (e: MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current
    if (!img || !dataset) return

    // Convert click → image coordinates
    const rect = img.getBoundingClientRect()
    const xDisplay = e.clientX - rect.left
    const yDisplay = e.clientY - rect.top

    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height
    const xImg = Math.floor(xDisplay * scaleX)
    const yImg = Math.floor(yDisplay * scaleY)

    // Fetch spectrum from backend
    const params = new URLSearchParams({
      x: xImg.toString(),
      y: yImg.toString(),
    })
    const res = await fetch(`/api/datasets/${dataset.id}/spectra?${params}`)
    if (!res.ok) {
      console.error('Failed to fetch spectrum', await res.text())
      return
    }

    const spec: Spectrum = await res.json()

    // -----------------------------
    // SINGLE vs MULTI selection
    // -----------------------------
    if (selectionMode === 'single') {
      clearSpectra()       // ensure only one marker is visible
      addSpectrum(spec)    // add new selected pixel marker
      onSpectrum?.(spec)   // update single-spectrum plot
    } else {
      addSpectrum(spec)    // accumulate selected pixels
    }
  }

  // ---------------------------------------------
  // RENDER
  // ---------------------------------------------
  return (
    <section className="primary-display" aria-label="Primary Display">
      {show && rgbImgUrl ? (
        <div
          style={{
            position: 'relative',
            width: '100%',
            display: 'inline-block',
          }}
        >
          {/* Hyperspectral RGB preview */}
          <img
            ref={imgRef}
            src={rgbImgUrl}
            alt={`Hyperspectral Image${
              dataset ? ` – ${dataset.name}` : ''
            }`}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              cursor: 'crosshair',
            }}
            onClick={handleImageClick}
          />

          {/* ---------------------------------------------
              PIXEL MARKERS OVERLAY
             --------------------------------------------- */}
          {imgRef.current &&
            selectedSpectra
              ?.filter((s): s is NonNullable<Spectrum> => s !== null)
              .map((s, idx) => {
                const img = imgRef.current
                const leftPct = ((s.x + 0.5) / img.naturalWidth) * 100
                const topPct = ((s.y + 0.5) / img.naturalHeight) * 100

                return (
                  <div
                    key={idx}
                    style={{
                      position: 'absolute',
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      transform: 'translate(-50%, -50%)',
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      border: '2px solid red',
                      backgroundColor: 'white',
                      boxShadow: '0 0 4px rgba(0, 0, 0, 0.6)',
                      pointerEvents: 'none', // don't block clicking
                    }}
                  />
                )
              })}
        </div>
      ) : (
        <div className="placeholder">No layer visible</div>
      )}

      {/* Band Picker below the image */}
      <BandPicker />
    </section>
  )
}

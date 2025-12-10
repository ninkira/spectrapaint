// PrimaryDisplay.tsx
import { useRef, useState, type MouseEvent } from 'react'
import { useApp } from '../state/AppContext'
import BandPicker from './hsi_tools/BandPicker'
import type { Spectrum } from './hsi_tools/SpectrumPlot'

interface PrimaryDisplayProps {
  onSpectrum?: (s: Spectrum) => void
  onRegionSpectra?: (specs: Spectrum[]) => void // optional
}

type NonNullSpectrum = Exclude<Spectrum, null>
type Point = { x: number; y: number }

type RegionOverlay = {
  x0: number
  y0: number
  x1: number
  y1: number
  shape: 'rect' | 'ellipse'
}

export default function PrimaryDisplay({
  onSpectrum,
  onRegionSpectra,
}: PrimaryDisplayProps) {
  const {
    layers,
    selectionMode, // 'single' | 'multiple' | 'rect' | 'ellipse' | 'line'
    addSpectrum,
    rgbImgUrl,
    dataset,
    selectedSpectra,
  } = useApp()

  const show = layers.find((l) => l.id === 'rgb')?.on
  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null)
  const [lastRegion, setLastRegion] = useState<RegionOverlay | null>(null)

  const isShapeMode = selectionMode === 'rect' || selectionMode === 'ellipse'

  // ---- helper: wrapper coords -> image coords ----
  const toImageCoords = (display: Point): Point | null => {
    const img = imgRef.current
    const wrapper = wrapperRef.current
    if (!img || !wrapper) return null

    const rect = wrapper.getBoundingClientRect()
    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height

    return {
      x: Math.floor(display.x * scaleX),
      y: Math.floor(display.y * scaleY),
    }
  }

  const fetchSpectrumAtImagePoint = async (xImg: number, yImg: number) => {
    if (!dataset) return null

    const params = new URLSearchParams({
      x: xImg.toString(),
      y: yImg.toString(),
    })

    const res = await fetch(`/api/datasets/${dataset.id}/spectra?${params}`)
    if (!res.ok) {
      console.error('Failed to fetch spectrum', await res.text())
      return null
    }
    return (await res.json()) as Spectrum
  }

  const handlePixelClickAtDisplayPoint = async (displayPt: Point) => {
    const imgCoords = toImageCoords(displayPt)
    if (!imgCoords) return

    const spec = await fetchSpectrumAtImagePoint(imgCoords.x, imgCoords.y)
    if (!spec) return

    if (selectionMode === 'single') {
      onSpectrum?.(spec)
    } else {
      addSpectrum(spec)
    }
  }

  // ---- mouse handlers on wrapper ----
  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    e.preventDefault()

    const rect = wrapper.getBoundingClientRect()
    const displayPt: Point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }

    if (!isShapeMode) {
      // normal click → pixel spectrum
      void handlePixelClickAtDisplayPoint(displayPt)
      return
    }

    // start drag for rect/ellipse
    setDragStart(displayPt)
    setDragCurrent(displayPt)
  }

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!dragStart || !isShapeMode) return
    const wrapper = wrapperRef.current
    if (!wrapper) return

    e.preventDefault()

    const rect = wrapper.getBoundingClientRect()
    setDragCurrent({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  const handleMouseUp = async (e: MouseEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (!wrapper || !dragStart || !dragCurrent) {
      setDragStart(null)
      setDragCurrent(null)
      return
    }

    if (!isShapeMode || !dataset) {
      setDragStart(null)
      setDragCurrent(null)
      return
    }

    const xMinDisp = Math.min(dragStart.x, dragCurrent.x)
    const xMaxDisp = Math.max(dragStart.x, dragCurrent.x)
    const yMinDisp = Math.min(dragStart.y, dragCurrent.y)
    const yMaxDisp = Math.max(dragStart.y, dragCurrent.y)

    const topLeftImg = toImageCoords({ x: xMinDisp, y: yMinDisp })
    const bottomRightImg = toImageCoords({ x: xMaxDisp, y: yMaxDisp })

    if (!topLeftImg || !bottomRightImg) {
      setDragStart(null)
      setDragCurrent(null)
      return
    }

    const params = new URLSearchParams()
    params.set('shape', selectionMode === 'ellipse' ? 'ellipse' : 'rect')
    params.set('x0', topLeftImg.x.toString())
    params.set('y0', topLeftImg.y.toString())
    params.set('x1', bottomRightImg.x.toString())
    params.set('y1', bottomRightImg.y.toString())

    try {
      const res = await fetch(
        `/api/datasets/${dataset.id}/spectra-region?${params.toString()}`,
      )
      if (!res.ok) {
        console.error('Failed to fetch region spectra', await res.text())
      } else {
        const data = (await res.json()) as { spectra: Spectrum[] }

        if (onRegionSpectra && Array.isArray(data.spectra)) {
          onRegionSpectra(data.spectra)
        }

        // OPTIONAL: remove this block if you don't want region pixels
        // added into the global multi-selection plot.
        if (Array.isArray(data.spectra)) {
          for (const s of data.spectra) {
            addSpectrum(s)
          }
        }

        // keep region visible
        setLastRegion({
          x0: xMinDisp,
          y0: yMinDisp,
          x1: xMaxDisp,
          y1: yMaxDisp,
          shape: selectionMode === 'ellipse' ? 'ellipse' : 'rect',
        })
      }
    } catch (err) {
      console.error('Error fetching region spectra', err)
    }

    setDragStart(null)
    setDragCurrent(null)
  }

  // ---- overlay while dragging OR last region ----
  let selectionOverlay: JSX.Element | null = null

  if (dragStart && dragCurrent && isShapeMode) {
    const left = Math.min(dragStart.x, dragCurrent.x)
    const top = Math.min(dragStart.y, dragCurrent.y)
    const width = Math.abs(dragCurrent.x - dragStart.x)
    const height = Math.abs(dragCurrent.y - dragStart.y)

    selectionOverlay = (
      <div
        className={`selection-overlay ${
          selectionMode === 'ellipse' ? 'selection-ellipse' : 'selection-rect'
        }`}
        style={{ left, top, width, height }}
      />
    )
  } else if (lastRegion) {
    const { x0, y0, x1, y1, shape } = lastRegion
    const left = Math.min(x0, x1)
    const top = Math.min(y0, y1)
    const width = Math.abs(x1 - x0)
    const height = Math.abs(y1 - y0)

    selectionOverlay = (
      <div
        className={`selection-overlay ${
          shape === 'ellipse' ? 'selection-ellipse' : 'selection-rect'
        }`}
        style={{ left, top, width, height }}
      />
    )
  }

  return (
    <section className="primary-display" aria-label="Primary Display">
      {show && rgbImgUrl ? (
        <div
          ref={wrapperRef}
          className="image-wrapper"
          style={{
            position: 'relative',
            width: '100%',
            display: 'inline-block',
            userSelect: 'none',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <img
            ref={imgRef}
            src={rgbImgUrl}
            alt={`Hyperspectral Image${
              dataset ? `– ${dataset.name}` : ''
            }`}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              cursor: isShapeMode ? 'crosshair' : 'pointer',
            }}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
          />

          {/* shape overlay */}
          {selectionOverlay}

          {/* pixel markers */}
          {imgRef.current &&
            selectedSpectra
              ?.filter((s): s is NonNullSpectrum => s !== null)
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
                      boxShadow: '0 0 4px rgba(0,0,0,0.6)',
                      pointerEvents: 'none',
                    }}
                  />
                )
              })}
        </div>
      ) : (
        <div className="placeholder">No layer visible</div>
      )}

      <BandPicker />
    </section>
  )
}

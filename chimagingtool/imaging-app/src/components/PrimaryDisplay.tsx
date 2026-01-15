// PrimaryDisplay.tsx
import { useRef, useState, type MouseEvent } from 'react'
import { useApp } from '../state/AppContext'
import BandPicker from './hsi_tools/BandPicker'
import type { Spectrum } from './hsi_tools/SpectrumPlot'

interface PrimaryDisplayProps {
  onSpectrum?: (s: Spectrum) => void
  onRegionSpectra?: (specs: Spectrum[]) => void // optional
}

/* types for selection forms and shapes */
type NonNullSpectrum = Exclude<Spectrum, null>
type DisplayPoint = { x: number; y: number } /* Image Render Coord */
type ImagePoint = { x: number; y: number } /* Actual HSI Coors */

type Line = { p0: ImagePoint; p1: ImagePoint }
type Polygon = { vertices: ImagePoint[] }



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
    selectionMode, // 'single' | 'multiple' | 'rect' | 'ellipse' | 'line'  | 'polygon' 
    addSpectrum,
    rgbImgUrl,
    dataset,
    selectedSpectra,
  } = useApp()

  const show = layers.find((l) => l.id === 'rgb')?.on
  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
 {/* Circle/Retangle Selection */}
  const [dragStart, setDragStart] = useState<DisplayPoint | null>(null)
  const [dragCurrent, setDragCurrent] = useState<DisplayPoint | null>(null)

   {/* Lines */}
  const [lines, setLines] = useState<Line[]>([])
  const [lineStart, setLineStart] = useState<DisplayPoint | null>(null)
  const [lineCurrent, setLineCurrent] = useState<DisplayPoint | null>(null)

  
  const [polygons, setPolygons] = useState<Polygon[]>([]) /* if lines are connected */
  {/*OVerlay */}
  const [lastRegion, setLastRegion] = useState<RegionOverlay | null>(null)

  // Draft polyline vertices while drawing (Display space)
const [draftVertices, setDraftVertices] = useState<DisplayPoint[] | null>(null)
// Current mouse position for preview edge (Display space)
const [draftHover, setDraftHover] = useState<DisplayPoint | null>(null)

const CLOSE_RADIUS_PX = 10

const dist2 = (a: DisplayPoint, b: DisplayPoint) => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

const isCloseToStart = (pt: DisplayPoint, verts: DisplayPoint[]) => {
  if (verts.length === 0) return false
  return dist2(pt, verts[0]) <= CLOSE_RADIUS_PX * CLOSE_RADIUS_PX
}

const finalizePolygonFromDraft = (verts: DisplayPoint[]) => {
  if (verts.length < 3) return

  const imgVerts: ImagePoint[] = []
  for (const v of verts) {
    const iv = toImageCoords(v)
    if (!iv) return
    imgVerts.push(iv)
  }

  setPolygons((prev) => [...prev, { vertices: imgVerts }])
void (async () => {
  const data = await fetchSpectraInPolygon(imgVerts /*, 20000 optional */)
  if (!data?.spectra) return

  // keep callback (optional)
  onRegionSpectra?.(data.spectra)

  // IMPORTANT: add to global selection so Plotly updates (same as other modes)
  for (const s of data.spectra) {
    if (s) addSpectrum(s)
  }
})()


  setDraftVertices(null)
  setDraftHover(null)
  setLineStart(null)
  setLineCurrent(null)
}


  



  const isBoxMode = selectionMode === 'rect' || selectionMode === 'ellipse'  
  const isPointMode = selectionMode === 'single' || selectionMode === 'multiple'  
  const isLineMode = selectionMode === 'line'
  const isPolygonMode = selectionMode === 'polygon'  


  // ---- helper: wrapper coords -> image coords ----
 const toImageCoords = (display: DisplayPoint): ImagePoint | null => {
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


const fetchSpectraAlongLine = async (p0: ImagePoint, p1: ImagePoint, step = 1) => {
  if (!dataset) return null

  const params = new URLSearchParams({
    x0: p0.x.toString(),
    y0: p0.y.toString(),
    x1: p1.x.toString(),
    y1: p1.y.toString(),
    step: step.toString(),
  })

  const res = await fetch(`/api/datasets/${dataset.id}/spectra-line?${params}`)
  if (!res.ok) {
    console.error('Failed to fetch line spectra', await res.text())
    return null
  }
  return (await res.json()) as { spectra: Spectrum[] }
}

const fetchSpectraInPolygon = async (vertices: ImagePoint[], maxPoints?: number) => {
  if (!dataset) return null

  const res = await fetch(`/api/datasets/${dataset.id}/spectra-polygon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vertices,
      ...(maxPoints !== undefined ? { max_points: maxPoints } : {}),
    }),
  })

  if (!res.ok) {
    console.error('Failed to fetch polygon spectra', await res.text())
    return null
  }

  return (await res.json()) as {
    spectra: Spectrum[]
    truncated?: boolean
    count?: number
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

  const handlePixelClickAtDisplayPoint = async (displayPt: DisplayPoint) => {
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
  const toDisplayCoords = (imgPt: ImagePoint): DisplayPoint | null => {
  const img = imgRef.current
  const wrapper = wrapperRef.current
  if (!img || !wrapper) return null

  const rect = wrapper.getBoundingClientRect()
  const scaleX = rect.width / img.naturalWidth
  const scaleY = rect.height / img.naturalHeight

  return { x: imgPt.x * scaleX, y: imgPt.y * scaleY }
}

  // ---- mouse handlers on wrapper ----
  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    e.preventDefault()

    const rect = wrapper.getBoundingClientRect()
    const displayPt: DisplayPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }

    if (isPointMode) {
      // normal click → pixel spectrum
      void handlePixelClickAtDisplayPoint(displayPt)
      return
    }
    else if(isBoxMode){
       // start drag for rect/ellipse
    setDragStart(displayPt)
    setDragCurrent(displayPt)
    
    }  else if (isLineMode) {
  // Start a new draft polyline on first click
    if (!draftVertices) {
      setDraftVertices([displayPt])
      setDraftHover(displayPt)
      // for your existing preview line overlay
      setLineStart(displayPt)
      setLineCurrent(displayPt)
    return
  }

  // If click is near start and we have enough vertices -> close polygon
  if (isCloseToStart(displayPt, draftVertices)) {
    finalizePolygonFromDraft(draftVertices)
    
    return
  }

  // Otherwise: add a new segment from last vertex to this click
  const last = draftVertices[draftVertices.length - 1]

  const startImg = toImageCoords(last)
  const endImg = toImageCoords(displayPt)
  if (startImg && endImg) {
    setLines((prev) => [...prev, { p0: startImg, p1: endImg }])
  
  // API call belongs HERE (segment exists here)
  void (async () => {
    const data = await fetchSpectraAlongLine(startImg, endImg, 1)
    if (!data?.spectra) return
    onRegionSpectra?.(data.spectra)
    // or addSpectrum(...) if you prefer
  })()
  }

  // Append vertex to draft
  setDraftVertices((prev) => (prev ? [...prev, displayPt] : [displayPt]))
  setDraftHover(displayPt)

  // keep your preview anchored at new point
  setLineStart(displayPt)
  setLineCurrent(displayPt)
  return
}


   else if (isPolygonMode) {
  if (!draftVertices) {
    setDraftVertices([displayPt])
    setDraftHover(displayPt)
    return
  }

  if (isCloseToStart(displayPt, draftVertices)) {
    finalizePolygonFromDraft(draftVertices)
    return
  }

  setDraftVertices((prev) => (prev ? [...prev, displayPt] : [displayPt]))
  setDraftHover(displayPt)
  return
}

  }

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {

    const wrapper = wrapperRef.current
    if (!wrapper) return
    e.preventDefault()

    const rect = wrapper.getBoundingClientRect()
    const displayPt: DisplayPoint = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    }

      // box preview
    if (isBoxMode && dragStart) {
      setDragCurrent(displayPt)
    }

    // line preview
    if (isLineMode && lineStart) {
      setLineCurrent(displayPt)
    }

    // Draft hover for both line and polygon modes
if ((isLineMode || isPolygonMode) && draftVertices) {
  setDraftHover(displayPt)
}

// Keep your existing line preview line working too (optional)
if (isLineMode && lineStart) {
  setLineCurrent(displayPt)
}

  }


   

  const handleMouseUp = async (e: MouseEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (!wrapper || !dragStart || !dragCurrent) {
      setDragStart(null)
      setDragCurrent(null)
      return
    }

    if (!isBoxMode || !dataset) {
      setDragStart(null)
      setDragCurrent(null)
      return
    }
    /*this creates a bounding box for the shape selection*/
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

  let lineOverlay: JSX.Element | null = null

  let polygonOverlay: JSX.Element | null = null


  if (polygons.length > 0 || (draftVertices && draftVertices.length > 0)) {
  polygonOverlay = (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      {/* finished polygons */}
      {polygons.map((poly, idx) => {
        const pts = poly.vertices
          .map(toDisplayCoords)
          .filter((p): p is DisplayPoint => !!p)
          .map((p) => `${p.x},${p.y}`)
          .join(' ')

        if (!pts) return null

        return (
          <polygon
            key={idx}
            points={pts}
            fill="rgba(255,0,0,0.12)"
            stroke="red"
            strokeWidth={2}
          />
        )
      })}

      {/* draft polyline (in-progress) */}
      {draftVertices && draftVertices.length > 0 && (
        <>
          {/* polyline through fixed vertices */}
          <polyline
            points={draftVertices.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="red"
            strokeWidth={2}
          />

          {/* preview edge to cursor */}
          {draftHover && (
            <line
              x1={draftVertices[draftVertices.length - 1].x}
              y1={draftVertices[draftVertices.length - 1].y}
              x2={draftHover.x}
              y2={draftHover.y}
              stroke="red"
              strokeWidth={2}
              strokeDasharray="4,4"
            />
          )}

          {/* start vertex handle (click to close) */}
          <circle
            cx={draftVertices[0].x}
            cy={draftVertices[0].y}
            r={6}
            fill="white"
            stroke="red"
            strokeWidth={2}
          />
        </>
      )}
    </svg>
  )
}


if ((isLineMode && lineStart && lineCurrent) || lines.length > 0) {
  lineOverlay = (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      {/* preview line */}
      {isLineMode && lineStart && lineCurrent && (
        <line
          x1={lineStart.x}
          y1={lineStart.y}
          x2={lineCurrent.x}
          y2={lineCurrent.y}
          stroke="red"
          strokeWidth={2}
          strokeDasharray="4,4"
        />
      )}

      {/* stored lines */}
      {lines.map((line, idx) => {
        const p0 = toDisplayCoords(line.p0)
        const p1 = toDisplayCoords(line.p1)
        if (!p0 || !p1) return null

        return (
          <line
            key={idx}
            x1={p0.x}
            y1={p0.y}
            x2={p1.x}
            y2={p1.y}
            stroke="red"
            strokeWidth={2}
          />
        )
      })}
    </svg>
  )
}


  if (dragStart && dragCurrent && isBoxMode) {
    const left = Math.min(dragStart.x, dragCurrent.x)
    const top = Math.min(dragStart.y, dragCurrent.y)
    const width = Math.abs(dragCurrent.x - dragStart.x)
    const height = Math.abs(dragCurrent.y - dragStart.y)

    selectionOverlay = (
      <div
        className={`selection-overlay ${
          selectionMode === 'ellipse' ? 'selection-ellipse' : 'selection-rect'
        }`}
        style={{ left, top, width, height,  border: '2px solid red' }}
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
        style={{ left, top, width, height,  border: '2px solid red' }}
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
        cursor: (isBoxMode || isLineMode || isPolygonMode) ? 'crosshair' : 'pointer',
            }}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
          />

          {/* shape overlay */}
          {selectionOverlay}
          {polygonOverlay}
         {/* line overlay */}
          {lineOverlay}


          {/* pixel markers */}
          {/* pixel markers */}
{isPointMode &&
  imgRef.current &&
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

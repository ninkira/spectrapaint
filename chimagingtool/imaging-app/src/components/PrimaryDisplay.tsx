// PrimaryDisplay.tsx
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useApp } from '../state/AppContext'
import BandPicker from './hsi_tools/BandPicker'
import type { Spectrum } from './hsi_tools/SpectrumPlot'
import type { RectAnn, EllipseAnn, PolygonAnn } from '../models/annotations'

interface PrimaryDisplayProps {
  onSpectrum?: (s: Spectrum) => void
  onRegionSpectra?: (specs: Spectrum[]) => void // optional
}


type DisplayPoint = { x: number; y: number } /* Image Render Coord */
type ImagePoint = { x: number; y: number } /* Actual HSI Coors */

type Polygon = { vertices: ImagePoint[] }


export default function PrimaryDisplay({
  onSpectrum,
  onRegionSpectra,
}: PrimaryDisplayProps) {
  const {
    fileLayers,
    selectionMode, // 'single' | 'multiple' | 'rect' | 'ellipse' | 'line'  | 'polygon' 
    addSpectrum,
    rgbImgUrl,
    dataset,
    annotations,
    addAnnotation,
    clearProbePointsForDataset,
    selectedRoiId,
    setRoiSpectraForId,
    setSelectedRoiId,
    selectedProbeGroupId,
    probeSpectraByGroupId,
    setProbeSpectraForGroup,
    setSelectedProbeGroupId
  } = useApp()

  const show = fileLayers.some((l) => l.on)
  const isHsiDataset = dataset?.type === 'hsi'
  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  /* Circle/Retangle Selection */
  const [dragStart, setDragStart] = useState<DisplayPoint | null>(null)
  const [dragCurrent, setDragCurrent] = useState<DisplayPoint | null>(null)

  const [polygons, setPolygons] = useState<Polygon[]>([]) /* if lines are connected */

  // Draft polyline vertices while drawing (Display space)
  const [draftVertices, setDraftVertices] = useState<DisplayPoint[] | null>(null)
  // Current mouse position for preview edge (Display space)
  const [draftHover, setDraftHover] = useState<DisplayPoint | null>(null)

  const [probeGroupId, setProbeGroupId] = useState<string | null>(null)

  useEffect(() => {
    if (selectionMode === 'multiple') {
      setProbeGroupId(crypto.randomUUID())
    } else {
      setProbeGroupId(null)
    }
  }, [selectionMode])


  const CLOSE_RADIUS_PX = 10

  const dist2 = (a: DisplayPoint, b: DisplayPoint) => {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return dx * dx + dy * dy
  }

  /** functions */
  const isCloseToStart = (pt: DisplayPoint, verts: DisplayPoint[]) => {
    if (verts.length === 0) return false
    return dist2(pt, verts[0]) <= CLOSE_RADIUS_PX * CLOSE_RADIUS_PX
  }

  const cancelActiveSelection = () => {
    // cancel rect/ellipse drag preview
    setDragStart(null)
    setDragCurrent(null)

    // cancel line/poly drafting
    setDraftVertices(null)
    setDraftHover(null)

  }

  const addProbePoint = (x: number, y: number) => {
    if (!dataset) return

    addAnnotation({
      id: crypto.randomUUID(),
      datasetId: dataset.id,
      kind: 'probe',
      type: 'point',
      createdAt: new Date().toISOString(),
      geometry: { x, y },
      label: selectionMode === 'single' ? 'Probe' : 'Probe (multi)',
      ...(probeGroupId ? { groupId: probeGroupId } : {}),
    })
  }

  const finalizePolygonFromDraft = (verts: DisplayPoint[]) => {
    if (!dataset) return
    if (verts.length < 3) return

    const imgVerts: ImagePoint[] = []
    for (const v of verts) {
      const iv = toImageCoords(v)
      if (!iv) return
      imgVerts.push(iv)
    }

    setPolygons((prev) => [...prev, { vertices: imgVerts }])

    const ann: PolygonAnn = {
      id: crypto.randomUUID(),
      datasetId: dataset.id,
      kind: 'roi',
      type: 'polygon',
      createdAt: new Date().toISOString(),
      geometry: { vertices: imgVerts },
      label: 'ROI',
    }

    addAnnotation(ann)

    if (!isHsiDataset) {
      setSelectedRoiId(ann.id)
      setDraftVertices(null)
      setDraftHover(null)
      return
    }

    void (async () => {
      const data = await fetchSpectraInPolygon(imgVerts /*, 20000 optional */)

      if (!data?.spectra) return



      // keep callback (optional)
      onRegionSpectra?.(data.spectra)

      // IMPORTANT: add to global selection so Plotly updates (same as other modes)
      for (const s of data.spectra) {
        if (s) addSpectrum(s)

      }




      setRoiSpectraForId(ann.id, data.spectra)
      setSelectedRoiId(ann.id)

    })()

    setDraftVertices(null)
    setDraftHover(null)

  }






  const isBoxMode = selectionMode === 'rect' || selectionMode === 'ellipse'
  const isPointMode = selectionMode === 'single' || selectionMode === 'multiple'
  const isPolygonLikeMode = selectionMode === 'polygon' || selectionMode === 'line'



  // ---- helper: wrapper coords -> image coords ----
  const toImageCoords = (display: DisplayPoint): ImagePoint | null => {
    const img = imgRef.current
    const wrapper = wrapperRef.current
    if (!img || !wrapper) return null

    const rect = wrapper.getBoundingClientRect()
    if (!img.naturalWidth || !img.naturalHeight) return null
    if (!rect.width || !rect.height) return null

    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null

    const x = Math.floor(display.x * scaleX)
    const y = Math.floor(display.y * scaleY)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null

    return {
      x,
      y,
    }
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
    if (!imgCoords || !dataset) return

    if (!isHsiDataset) {
      if (selectionMode === 'single') {
        clearProbePointsForDataset(dataset.id)
      }
      addProbePoint(imgCoords.x, imgCoords.y)
      return
    }

    // fetch spectrum
    const spec = await fetchSpectrumAtImagePoint(imgCoords.x, imgCoords.y)
    if (!spec) return

    // update plot data (existing behavior)
    if (selectionMode === 'single') {
      onSpectrum?.(spec)
    } else {
      addSpectrum(spec)
    }

    // store probe annotation (NEW)
    if (selectionMode === 'single') {
      clearProbePointsForDataset(dataset.id)  // clear old probes
    }
    addProbePoint(imgCoords.x, imgCoords.y)   // save this probe point


    if (selectionMode === 'multiple' && probeGroupId) {
      const groupSpectra = probeSpectraByGroupId[probeGroupId] ?? []
      setProbeSpectraForGroup(probeGroupId, [...groupSpectra, spec])
      setSelectedProbeGroupId(probeGroupId)
    }

  }

  const toDisplayCoords = (imgPt: ImagePoint): DisplayPoint | null => {
    const img = imgRef.current
    const wrapper = wrapperRef.current
    if (!img || !wrapper) return null

    const rect = wrapper.getBoundingClientRect()
    if (!img.naturalWidth || !img.naturalHeight) return null
    if (!rect.width || !rect.height) return null

    const scaleX = rect.width / img.naturalWidth
    const scaleY = rect.height / img.naturalHeight
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null

    const x = imgPt.x * scaleX
    const y = imgPt.y * scaleY
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null

    return { x, y }
  }
  const hasActiveDraft =
    dragStart !== null ||
    draftVertices !== null

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!hasActiveDraft) return
      e.preventDefault()

      setDragStart(null)
      setDragCurrent(null)
      setDraftVertices(null)
      setDraftHover(null)

    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasActiveDraft])

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
    else if (isBoxMode) {
      // start drag for rect/ellipse
      setDragStart(displayPt)
      setDragCurrent(displayPt)

    }

    else if (isPolygonLikeMode) {
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

    // polygon preview: update hover point while drawing
    if (isPolygonLikeMode && draftVertices) {
      setDraftHover(displayPt)
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

    const x = Math.min(topLeftImg.x, bottomRightImg.x)
    const y = Math.min(topLeftImg.y, bottomRightImg.y)
    const w = Math.abs(bottomRightImg.x - topLeftImg.x)
    const h = Math.abs(bottomRightImg.y - topLeftImg.y)


    const MIN_SIZE = 3
    let ann: RectAnn | EllipseAnn | null = null
    if (w >= MIN_SIZE && h >= MIN_SIZE) {
      if (selectionMode === 'rect') {
        ann = {
          id: crypto.randomUUID(),
          datasetId: dataset.id,
          kind: 'roi',
          type: 'rect',
          createdAt: new Date().toISOString(),
          geometry: { x, y, w, h },
          label: 'ROI',
        }
      }

      if (selectionMode === 'ellipse') {
        ann = {
          id: crypto.randomUUID(),
          datasetId: dataset.id,
          kind: 'roi',
          type: 'ellipse',
          createdAt: new Date().toISOString(),
          geometry: {
            cx: x + w / 2,
            cy: y + h / 2,
            rx: w / 2,
            ry: h / 2,
          },
          label: 'ROI',
        }

      }
      if (ann) addAnnotation(ann)
    }

    if (!isHsiDataset) {
      if (ann) setSelectedRoiId(ann.id)
      setDragStart(null)
      setDragCurrent(null)
      return
    }


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
        const data = (await res.json()) as {
          wavelengths_nm?: number[]
          spectra?: Spectrum[]
          region_spectra?: Array<{ x: number; y: number; values: number[] }>
        }

        const spectra: Spectrum[] = Array.isArray(data.spectra)
          ? data.spectra
          : Array.isArray(data.region_spectra)
            ? data.region_spectra.map((s) => ({
              x: s.x,
              y: s.y,
              values: s.values,
              wavelengths_nm: data.wavelengths_nm ?? [],
            }))
            : []

        if (onRegionSpectra && spectra.length > 0) {
          onRegionSpectra(spectra)
        }
        if (ann && spectra.length > 0) {
          setRoiSpectraForId(ann.id, spectra)
          setSelectedRoiId(ann.id)
        }
      }
    } catch (err) {
      console.error('Error fetching region spectra', err)
    }

    setDragStart(null)
    setDragCurrent(null)
  }

  // ---- overlay while dragging OR last region ----
  let selectionOverlay: JSX.Element | null = null

  let polygonOverlay: JSX.Element | null = null

  const activeBox =
    isBoxMode && dragStart && dragCurrent
      ? {
        left: Math.min(dragStart.x, dragCurrent.x),
        top: Math.min(dragStart.y, dragCurrent.y),
        width: Math.abs(dragCurrent.x - dragStart.x),
        height: Math.abs(dragCurrent.y - dragStart.y),
      }
      : null

  if (activeBox) {
    selectionOverlay = (
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        {selectionMode === 'rect' ? (
          <rect
            x={activeBox.left}
            y={activeBox.top}
            width={activeBox.width}
            height={activeBox.height}
            fill="rgba(255,0,0,0.08)"
            stroke="red"
            strokeWidth={2}
          />
        ) : (
          <ellipse
            cx={activeBox.left + activeBox.width / 2}
            cy={activeBox.top + activeBox.height / 2}
            rx={activeBox.width / 2}
            ry={activeBox.height / 2}
            fill="rgba(255,0,0,0.08)"
            stroke="red"
            strokeWidth={2}
          />
        )}
      </svg>
    )
  }


  const savedOverlay = (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'auto',
      }}
    >
      {annotations
        .filter(a => dataset && a.datasetId === dataset.id)
        .map(a => {
          if (a.type === 'rect') {
            const p0 = toDisplayCoords({ x: a.geometry.x, y: a.geometry.y })
            const p1 = toDisplayCoords({ x: a.geometry.x + a.geometry.w, y: a.geometry.y + a.geometry.h })
            if (!p0 || !p1) return null

            const left = Math.min(p0.x, p1.x)
            const top = Math.min(p0.y, p1.y)
            const width = Math.abs(p1.x - p0.x)
            const height = Math.abs(p1.y - p0.y)

            return (
              <rect
                key={a.id}
                x={left}
                y={top}
                width={width}
                height={height}
                fill="rgba(255,0,0,0.12)"
                stroke={a.id === selectedRoiId ? 'lime' : 'red'}
                strokeWidth={a.id === selectedRoiId ? 3 : 2}
                onClick={() => setSelectedRoiId(a.id)}
                style={{ cursor: 'pointer' }}
              />
            )
          }

          if (a.type === 'polygon') {
            const pts = a.geometry.vertices
              .map(toDisplayCoords)
              .filter((p): p is DisplayPoint => !!p)
              .map((p) => `${p.x},${p.y}`)
              .join(' ')

            if (!pts) return null

            return (
              <polygon
                key={a.id}
                points={pts}
                fill="rgba(255,0,0,0.12)"
                stroke={a.id === selectedRoiId ? 'lime' : 'red'}
                strokeWidth={a.id === selectedRoiId ? 3 : 2}
                onClick={() => setSelectedRoiId(a.id)}
                style={{ cursor: 'pointer' }}

              />
            )
          }

          if (a.kind === 'probe' && a.type === 'point') {
            const p = toDisplayCoords({ x: a.geometry.x, y: a.geometry.y })
            if (!p) return null

            return (
              <circle
                key={a.id}
                cx={p.x}
                cy={p.y}
                r={5}
                fill="white"
                stroke={a.groupId === selectedProbeGroupId ? 'lime' : 'red'}
                strokeWidth={a.groupId === selectedProbeGroupId ? 3 : 2}
                onClick={() => setSelectedProbeGroupId(a.groupId ?? null)}
                style={{ cursor: 'pointer' }}

              />
            )
          }


          if (a.type === 'ellipse') {
            const c = toDisplayCoords({ x: a.geometry.cx, y: a.geometry.cy })
            const rxPt = toDisplayCoords({ x: a.geometry.cx + a.geometry.rx, y: a.geometry.cy })
            const ryPt = toDisplayCoords({ x: a.geometry.cx, y: a.geometry.cy + a.geometry.ry })
            if (!c || !rxPt || !ryPt) return null

            const rx = Math.abs(rxPt.x - c.x)
            const ry = Math.abs(ryPt.y - c.y)

            return (
              <ellipse
                key={a.id}
                cx={c.x}
                cy={c.y}
                rx={rx}
                ry={ry}
                fill="rgba(255,0,0,0.10)"
                stroke={a.id === selectedRoiId ? 'lime' : 'red'}
                strokeWidth={a.id === selectedRoiId ? 3 : 2}
                onClick={() => setSelectedRoiId(a.id)}
                style={{ cursor: 'pointer' }}
              />
            )
          }

          return null
        })}
    </svg>
  )

  if (polygons.length > 0 || (draftVertices && draftVertices.length > 0)) {
    polygonOverlay = (
      <svg
        style={{
          position: 'absolute',
          inset: 0,
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


  return (
    <section className="primary-display" aria-label="Primary Display">
      {show && rgbImgUrl ? (
        <div
          ref={wrapperRef}
          className="image-wrapper"
          style={{
            position: 'relative',
            width: '100%',
            overflow: 'hidden',
            userSelect: 'none',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <img
            ref={imgRef}
            src={rgbImgUrl}
            alt={`Hyperspectral Image${dataset ? ` ${dataset.name}` : ''
              }`}
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              cursor: isHsiDataset && (isBoxMode || isPolygonLikeMode) ? 'crosshair' : 'pointer',
            }}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
          />
          {savedOverlay}
          {selectionOverlay}
          {polygonOverlay}






        </div>
      ) : (
        <div className="placeholder">No layer visible</div>
      )}

      {isHsiDataset ? <BandPicker /> : null}

    </section>
  )
}

// PrimaryDisplay.tsx
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from 'react'
import { useApp } from '../state/AppContext'
import BandPicker from './hsi_tools/BandPicker'
import type { Spectrum } from './hsi_tools/SpectrumPlot'
import type { Annotation, RectAnn, EllipseAnn, PolygonAnn, LineAnn } from '../models/annotations'

interface PrimaryDisplayProps {
  onRegionSpectra?: (specs: Spectrum[]) => void // optional
}


type DisplayPoint = { x: number; y: number } /* Image Render Coord */
type ImagePoint = { x: number; y: number } /* Actual HSI Coors */

type Polygon = { id: string; vertices: ImagePoint[] }

const polygonArea = (vertices: { x: number; y: number }[]): number => {
  if (!vertices.length) return 0
  let sum = 0
  for (let i = 0; i < vertices.length; i += 1) {
    const j = (i + 1) % vertices.length
    sum += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y
  }
  return Math.abs(sum) * 0.5
}

const annotationArea = (ann: Annotation): number => {
  if (ann.type === 'rect') return Math.max(0, ann.geometry.w) * Math.max(0, ann.geometry.h)
  if (ann.type === 'ellipse') return Math.PI * Math.max(0, ann.geometry.rx) * Math.max(0, ann.geometry.ry)
  if (ann.type === 'polygon') return polygonArea(ann.geometry.vertices)
  return 0
}


export default function PrimaryDisplay({
  onRegionSpectra,
}: PrimaryDisplayProps) {
  const {
    fileLayers,
    selectionMode, // 'multiple' | 'rect' | 'ellipse' | 'line'  | 'polygon' 
    addSpectrum,
    rgbImgUrl,
    dataset,
    annotations,
    addAnnotation,
    selectedRoiId,
    setRoiSpectraForId,
    setSelectedRoiId,
    selectedProbeGroupId,
    selectedProbePointId,
    probeSpectraByGroupId,
    setProbeSpectraForGroup,
    setSelectedProbeGroupId,
    setSelectedProbePointId,
    view,
    setView,
    navigationMode,
  } = useApp()

  const show = fileLayers.some((l) => l.on)
  const isHsiDataset = dataset?.type === 'hsi'
  const imgRef = useRef<HTMLImageElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  /* Circle/Retangle Selection */
  const [dragStart, setDragStart] = useState<DisplayPoint | null>(null)
  const [dragCurrent, setDragCurrent] = useState<DisplayPoint | null>(null)

  // Draft polyline vertices while drawing (Display space)
  const [draftVertices, setDraftVertices] = useState<DisplayPoint[] | null>(null)
  // Current mouse position for preview edge (Display space)
  const [draftHover, setDraftHover] = useState<DisplayPoint | null>(null)
  const [polygons, setPolygons] = useState<Polygon[]>([])

  const [probeGroupId, setProbeGroupId] = useState<string | null>(null)
  const rafId = useRef(0)
  const cachedRect = useRef<DOMRect | null>(null)

  // Keep cachedRect in sync with wrapper size
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const updateRect = () => { cachedRect.current = wrapper.getBoundingClientRect() }
    updateRect()
    const ro = new ResizeObserver(updateRect)
    ro.observe(wrapper)
    return () => ro.disconnect()
  })

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
    const closeRadius = CLOSE_RADIUS_PX / Math.max(0.0001, view.zoom)
    return dist2(pt, verts[0]) <= closeRadius * closeRadius
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

    const annotationId = crypto.randomUUID()
    addAnnotation({
      id: annotationId,
      datasetId: dataset.id,
      kind: 'probe',
      type: 'point',
      createdAt: new Date().toISOString(),
      geometry: { x, y },
      label: 'Probe (multi)',
      ...(probeGroupId ? { groupId: probeGroupId } : {}),
    })
    setSelectedRoiId(null)
    setSelectedProbePointId(annotationId)
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

    setPolygons((prev) => [...prev, { id: crypto.randomUUID(), vertices: imgVerts }])

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
      const data = await fetchSpectraInPolygon(imgVerts, 20000)

      if (!data?.spectra) return

      // Attach top-level wavelengths_nm to each spectrum (avoids N copies in payload)
      const wl = data.wavelengths_nm ?? []
      const spectra = data.spectra.map((s) => ({ ...s, wavelengths_nm: wl }))

      // keep callback (optional)
      onRegionSpectra?.(spectra)

      // IMPORTANT: add to global selection so Plotly updates (same as other modes)
      for (const s of spectra) {
        if (s) addSpectrum(s)
      }




      setRoiSpectraForId(ann.id, spectra)
      setSelectedRoiId(ann.id)

    })()

    setDraftVertices(null)
    setDraftHover(null)

  }

  const fetchSpectraOnLine = async (start: ImagePoint, end: ImagePoint) => {
    if (!dataset) return null

    const params = new URLSearchParams({
      x0: start.x.toString(),
      y0: start.y.toString(),
      x1: end.x.toString(),
      y1: end.y.toString(),
    })

    const res = await fetch(`/api/datasets/${dataset.id}/spectra-line?${params.toString()}`)
    if (!res.ok) {
      console.error('Failed to fetch line spectra', await res.text())
      return null
    }
    return (await res.json()) as { spectra: Spectrum[] }
  }

  const finalizeLineFromDraft = (verts: DisplayPoint[]) => {
    if (!dataset) return
    if (verts.length < 2) return

    const imgPoints: ImagePoint[] = []
    for (const v of verts) {
      const iv = toImageCoords(v)
      if (!iv) return
      imgPoints.push(iv)
    }

    const ann: LineAnn = {
      id: crypto.randomUUID(),
      datasetId: dataset.id,
      kind: 'roi',
      type: 'line',
      createdAt: new Date().toISOString(),
      geometry: { points: imgPoints },
      label: 'ROI',
    }

    addAnnotation(ann)
    setSelectedProbePointId(null)
    setSelectedRoiId(ann.id)

    if (!isHsiDataset) {
      setDraftVertices(null)
      setDraftHover(null)
      return
    }

    void (async () => {
      const allSpectra: Spectrum[] = []
      for (let i = 0; i < imgPoints.length - 1; i += 1) {
        const segment = await fetchSpectraOnLine(imgPoints[i], imgPoints[i + 1])
        if (!segment?.spectra) continue

        const seg = segment.spectra
        if (allSpectra.length > 0 && seg.length > 0) {
          // Avoid duplicating shared vertex spectra between adjacent segments.
          allSpectra.push(...seg.slice(1))
        } else {
          allSpectra.push(...seg)
        }
      }

      if (allSpectra.length === 0) return

      onRegionSpectra?.(allSpectra)
      for (const s of allSpectra) {
        if (s) addSpectrum(s)
      }
      setRoiSpectraForId(ann.id, allSpectra)
      setSelectedRoiId(ann.id)
    })()

    setDraftVertices(null)
    setDraftHover(null)
  }






  const isBoxMode = selectionMode === 'rect' || selectionMode === 'ellipse'
  const isPointMode = selectionMode === 'multiple'
  const isPolygonLikeMode = selectionMode === 'polygon' || selectionMode === 'line'



  const toContentCoords = (display: DisplayPoint): DisplayPoint => {
    const z = Math.max(0.0001, view.zoom)
    return {
      x: (display.x - view.panX) / z,
      y: (display.y - view.panY) / z,
    }
  }

  // ---- helper: wrapper coords -> image coords ----
  const toImageCoords = (display: DisplayPoint): ImagePoint | null => {
    const img = imgRef.current
    const rect = cachedRect.current
    if (!img || !rect) return null

    if (!img.naturalWidth || !img.naturalHeight) return null
    if (!rect.width || !rect.height) return null

    const scaleX = img.naturalWidth / rect.width
    const scaleY = img.naturalHeight / rect.height
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null

    const x = Math.floor(display.x * scaleX)
    const y = Math.floor(display.y * scaleY)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null

    return { x, y }
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
      spectra: Array<{ x: number; y: number; values: number[] }>
      wavelengths_nm: number[]
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
      addProbePoint(imgCoords.x, imgCoords.y)
      return
    }

    // fetch spectrum
    const spec = await fetchSpectrumAtImagePoint(imgCoords.x, imgCoords.y)
    if (!spec) return

    // update plot data
    addSpectrum(spec)

    // store probe annotation (NEW)
    addProbePoint(imgCoords.x, imgCoords.y)   // save this probe point


    if (selectionMode === 'multiple' && probeGroupId) {
      const groupSpectra = probeSpectraByGroupId[probeGroupId] ?? []
      setProbeSpectraForGroup(probeGroupId, [...groupSpectra, spec])
      setSelectedProbeGroupId(probeGroupId)
    }

  }

  const toDisplayCoords = useCallback((imgPt: ImagePoint): DisplayPoint | null => {
    const img = imgRef.current
    const rect = cachedRect.current
    if (!img || !rect) return null

    if (!img.naturalWidth || !img.naturalHeight) return null
    if (!rect.width || !rect.height) return null

    const scaleX = rect.width / img.naturalWidth
    const scaleY = rect.height / img.naturalHeight
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null

    const x = imgPt.x * scaleX
    const y = imgPt.y * scaleY
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null

    return { x, y }
  }, [])
  const hasActiveDraft =
    dragStart !== null ||
    draftVertices !== null

  // Clean up pending RAF on unmount
  useEffect(() => () => cancelAnimationFrame(rafId.current), [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && selectionMode === 'line' && draftVertices && draftVertices.length >= 2) {
        e.preventDefault()
        finalizeLineFromDraft(draftVertices)
        return
      }
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
  }, [hasActiveDraft, selectionMode, draftVertices])

  // ---- mouse handlers on wrapper ----
  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const rect = cachedRect.current
    if (!rect) return

    e.preventDefault()

    const displayPt: DisplayPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
    const contentPt = toContentCoords(displayPt)

    if (navigationMode) {
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: view.panX,
        panY: view.panY,
      }
      setIsPanning(true)
      return
    }

    if (isPointMode) {
      // normal click → pixel spectrum
      void handlePixelClickAtDisplayPoint(contentPt)
      return
    }
    else if (isBoxMode) {
      // start drag for rect/ellipse
      setDragStart(contentPt)
      setDragCurrent(contentPt)

    }

    else if (isPolygonLikeMode) {
      if (selectionMode === 'line' && draftVertices && draftVertices.length >= 2 && e.detail >= 2) {
        finalizeLineFromDraft(draftVertices)
        return
      }

      if (!draftVertices) {
        setDraftVertices([contentPt])
        setDraftHover(contentPt)
        return
      }

      if (selectionMode === 'polygon' && isCloseToStart(contentPt, draftVertices)) {
        finalizePolygonFromDraft(draftVertices)
        return
      }

      setDraftVertices((prev) => (prev ? [...prev, contentPt] : [contentPt]))
      setDraftHover(contentPt)
      return
    }

  }

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()

    const rect = cachedRect.current
    if (!rect) return

    // Capture values from the synthetic event before it's recycled
    const clientX = e.clientX
    const clientY = e.clientY
    const displayPt: DisplayPoint = {
      x: clientX - rect.left,
      y: clientY - rect.top,
    }

    cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => {
      const contentPt = toContentCoords(displayPt)

      if (navigationMode && panStartRef.current) {
        const dx = clientX - panStartRef.current.x
        const dy = clientY - panStartRef.current.y
        setView({
          zoom: view.zoom,
          panX: panStartRef.current.panX + dx,
          panY: panStartRef.current.panY + dy,
        })
        return
      }

      // box preview
      if (isBoxMode && dragStart) {
        setDragCurrent(contentPt)
      }

      // polygon preview: update hover point while drawing
      if (isPolygonLikeMode && draftVertices) {
        setDraftHover(contentPt)
      }
    })
  }




  const handleMouseUp = async (e: MouseEvent<HTMLDivElement>) => {
    if (navigationMode) {
      panStartRef.current = null
      setIsPanning(false)
      return
    }

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

  const handleMouseLeave = () => {
    panStartRef.current = null
    setIsPanning(false)
  }

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!navigationMode) return
    const rect = cachedRect.current
    if (!rect) return

    e.preventDefault()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const oldZoom = view.zoom
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    const nextZoom = Math.min(8, Math.max(0.25, +(oldZoom * factor).toFixed(4)))
    if (nextZoom === oldZoom) return

    const contentX = (mouseX - view.panX) / oldZoom
    const contentY = (mouseY - view.panY) / oldZoom

    setView({
      zoom: nextZoom,
      panX: mouseX - contentX * nextZoom,
      panY: mouseY - contentY * nextZoom,
    })
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


  const savedOverlay = useMemo(() => (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: navigationMode ? 'none' : 'auto',
      }}
    >
      {(() => {
        const SELECTED_STROKE = '#D00000'
        const INACTIVE_STROKE = '#E3B505'
        const SELECTED_FILL = 'rgba(208,0,0,0.12)'
        const INACTIVE_FILL = 'rgba(227,181,5,0.12)'
        const selectedId = selectedRoiId ?? selectedProbePointId

        const drawOrderedAnnotations = annotations
          .filter((a) => dataset && a.datasetId === dataset.id)
          .slice()
          // Draw large ROIs first so smaller ROIs remain clickable on top.
          .sort((a, b) => annotationArea(b) - annotationArea(a))

        return drawOrderedAnnotations
          .map(a => {
            const isSelected = a.id === selectedId
            const stroke = isSelected ? SELECTED_STROKE : INACTIVE_STROKE
            const strokeWidth = isSelected ? 3 : 2
            const fill = isSelected ? SELECTED_FILL : INACTIVE_FILL

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
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  onClick={() => {
                    setSelectedProbePointId(null)
                    setSelectedRoiId(a.id)
                  }}
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
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  onClick={() => {
                    setSelectedProbePointId(null)
                    setSelectedRoiId(a.id)
                  }}
                  style={{ cursor: 'pointer' }}

                />
              )
            }

            if (a.type === 'line') {
              const pts = a.geometry.points
                .map(toDisplayCoords)
                .filter((p): p is DisplayPoint => !!p)
                .map((p) => `${p.x},${p.y}`)
                .join(' ')
              if (!pts) return null

              return (
                <polyline
                  key={a.id}
                  points={pts}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  onClick={() => {
                    setSelectedProbePointId(null)
                    setSelectedRoiId(a.id)
                  }}
                  style={{ cursor: 'pointer' }}
                />
              )
            }

            if (a.kind === 'probe' && a.type === 'point') {
              const p = toDisplayCoords({ x: a.geometry.x, y: a.geometry.y })
              if (!p) return null

              return (
                <g
                  key={a.id}
                  onClick={() => {
                    setSelectedRoiId(null)
                    setSelectedProbePointId(a.id)
                    setSelectedProbeGroupId(a.groupId ?? null)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Larger hit area so existing points are easy to click */}
                  <circle cx={p.x} cy={p.y} r={10} fill="rgba(0,0,0,0.001)" stroke="none" />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={5}
                    fill={isSelected ? SELECTED_STROKE : INACTIVE_STROKE}
                    stroke={isSelected ? SELECTED_STROKE : INACTIVE_STROKE}
                    strokeWidth={strokeWidth}
                  />
                </g>
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
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  onClick={() => {
                    setSelectedProbePointId(null)
                    setSelectedRoiId(a.id)
                  }}
                  style={{ cursor: 'pointer' }}
                />
              )
            }

            return null
          })
      })()}
    </svg>
  ), [annotations, dataset, selectedRoiId, selectedProbePointId, navigationMode, toDisplayCoords, setSelectedProbePointId, setSelectedRoiId, setSelectedProbeGroupId])

  if (draftVertices && draftVertices.length > 0) {
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
        {polygons.map((poly) => {
          const pts = poly.vertices
            .map(toDisplayCoords)
            .filter((p): p is DisplayPoint => !!p)
            .map((p) => `${p.x},${p.y}`)
            .join(' ')

          if (!pts) return null

          return (
            <polygon
              key={poly.id}
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

            {/* start vertex handle (polygon close hint only) */}
            {selectionMode === 'polygon' && (
              <circle
                cx={draftVertices[0].x}
                cy={draftVertices[0].y}
                r={6}
                fill="white"
                stroke="red"
                strokeWidth={2}
              />
            )}
          </>
        )}
      </svg>
    )
  }


  const displayCursor = navigationMode
    ? (isPanning ? 'grabbing' : 'grab')
    : (isHsiDataset && (isBoxMode || isPolygonLikeMode) ? 'crosshair' : 'pointer')

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
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
              transformOrigin: '0 0',
              willChange: 'transform',
            }}
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
                cursor: displayCursor,
              }}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
            />
            {savedOverlay}
            {selectionOverlay}
            {polygonOverlay}
          </div>






        </div>
      ) : (
        <div className="placeholder">No layer visible</div>
      )}

      {isHsiDataset ? <BandPicker /> : null}

    </section>
  )
}

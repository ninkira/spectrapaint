import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { listDatasets, rgbUrl, visualUrl } from '../lib/api';
import type { DatasetMeta } from '../lib/api';
import type { Annotation } from '../models/annotations'
import { useCallback } from 'react'


type SelectionMode = 'single' | 'multiple' | 'rect' | 'ellipse' | 'line' | 'polygon'
type ViewState = { zoom: number; panX: number; panY: number }


type Ctx = {
  // Layers
  fileLayers: Layer[];
  toggleLayer: (id: string) => void;

  // dataset
  dataset?: DatasetMeta;
  datasetId?: string;
  setDatasetId: (id: string) => void;

  //RGB
  rgbBands: { r: number; g: number; b: number };
  setRgbBands: (r: number, g: number, b: number) => void;
  rgbImgUrl?: string;

  // Selection
  selectionMode: SelectionMode;
  setSelectionMode: (m: SelectionMode) => void;
  navigationMode: boolean
  setNavigationMode: (v: boolean) => void
  showSignalProcessing: boolean
  setShowSignalProcessing: (v: boolean) => void

  // spetra
  selectedSpectra: Spectrum[];
  addSpectrum: (s: Spectrum) => void;
  clearSpectra: () => void;

  // Annotations 
  annotations: Annotation[]
  addAnnotation: (a: Annotation) => void
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
  removeAnnotation: (id: string) => void
  clearProbePointsForDataset: (datasetId: string) => void

  // selected ROI
  selectedRoiId: string | null
  setSelectedRoiId: (id: string | null) => void
  roiSpectraById: Record<string, Spectrum[]>
  setRoiSpectraForId: (id: string, spectra: Spectrum[]) => void


  selectedProbeGroupId: string | null
  setSelectedProbeGroupId: (id: string | null) => void
  probeSpectraByGroupId: Record<string, Spectrum[]>
  setProbeSpectraForGroup: (id: string, spectra: Spectrum[]) => void
  selectedProbePointId: string | null
  setSelectedProbePointId: (id: string | null) => void

  // Viewport
  view: ViewState
  setView: (next: ViewState) => void
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void

};

const Ctx = createContext<Ctx>(null as any);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: React.ReactNode }) {

  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
const [dataset, setDataset] = useState<DatasetMeta>()

  const [datasetId, setDatasetId] = useState<string>();

  const fileLayers = useMemo(() => datasets.map(ds => ({
    id: ds.id,
    name: ds.path.split('/').pop() ?? ds.name,
    path: ds.path,
    type: ds.type,
    on: ds.id === datasetId,
  })), [datasets, datasetId])
  const [rgbBands, setRgbBandsState] = useState({ r: 650, g: 550, b: 450 });
  const [rgbImgUrl, setRgbImgUrl] = useState<string>();


  // Annotations - based on selected ROI
  const [annotations, setAnnotations] = useState<Annotation[]>([])

  const addAnnotation = useCallback((a: Annotation) => {
    setAnnotations(prev => [...prev, a])
  }, [])

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id))
  }, [])

  const updateAnnotation = useCallback((id: string, patch: Partial<Annotation>) => {
    setAnnotations(prev => prev.map(a => (a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a)))
  }, [])

  const clearProbePointsForDataset = useCallback((datasetId: string) => {
    setAnnotations(prev =>
      prev.filter(a => !(a.datasetId === datasetId && a.kind === 'probe' && a.type === 'point'))
    )
  }, [])


  // Select the annotation / ROI
  const toggleLayer = (id: string) => setDatasetId(id)

  // new for selection one or multiple pixels in the image
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('single')
  const [navigationMode, setNavigationMode] = useState(false)
  const [showSignalProcessing, setShowSignalProcessing] = useState(false)
  const [view, setViewState] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 })

  const setView = useCallback((next: ViewState) => {
    const zoom = Math.min(8, Math.max(0.25, next.zoom))
    setViewState({ zoom, panX: next.panX, panY: next.panY })
  }, [])

  const zoomIn = useCallback(() => {
    setViewState((prev) => ({ ...prev, zoom: Math.min(8, +(prev.zoom * 1.2).toFixed(4)) }))
  }, [])

  const zoomOut = useCallback(() => {
    setViewState((prev) => ({ ...prev, zoom: Math.max(0.25, +(prev.zoom / 1.2).toFixed(4)) }))
  }, [])

  const resetView = useCallback(() => {
    setViewState({ zoom: 1, panX: 0, panY: 0 })
  }, [])

  const [selectedProbeGroupId, setSelectedProbeGroupId] = useState<string | null>(null)
  const [probeSpectraByGroupId, setProbeSpectraByGroupId] = useState<Record<string, Spectrum[]>>({})
  const [selectedProbePointId, setSelectedProbePointId] = useState<string | null>(null)

  const setProbeSpectraForGroup = (id: string, spectra: Spectrum[]) => {
    setProbeSpectraByGroupId(prev => ({ ...prev, [id]: spectra }))
  }




  const [selectedSpectra, setSelectedSpectra] = useState<Spectrum[]>([]);

  const addSpectrum = (s: Spectrum) =>
    setSelectedSpectra(prev => [...prev, s]);

  const clearSpectra = () => setSelectedSpectra([]);

  // selected ROI
  const [selectedRoiId, setSelectedRoiId] = useState<string | null>(null)
  const [roiSpectraById, setRoiSpectraById] = useState<Record<string, Spectrum[]>>({})


  const setRoiSpectraForId = (id: string, spectra: Spectrum[]) => {
    setRoiSpectraById(prev => ({ ...prev, [id]: spectra }))
  }


  useEffect(() => {
    listDatasets().then(ds => {
      setDatasets(ds);
      if (ds.length) { setDataset(ds[0]); setDatasetId(ds[0].id); }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!datasetId) return;
    const d = datasets.find(x => x.id === datasetId);
    setDataset(d);
  }, [datasetId, datasets]);

  useEffect(() => {
    if (!datasetId || !dataset) return

    const cacheBuster = `&t=${Date.now()}`
    if (dataset.type === 'hsi') {
      const u = rgbUrl(datasetId, rgbBands.r, rgbBands.g, rgbBands.b) + cacheBuster
      setRgbImgUrl(u)
      return
    }

    const u = `${visualUrl(datasetId)}?t=${Date.now()}`
    setRgbImgUrl(u)
  }, [datasetId, dataset, rgbBands]);

  const ctxValue: Ctx = useMemo(() => ({
    // Layers
    fileLayers,
    toggleLayer,

    // Dataset
    dataset,
    datasetId,
    setDatasetId,

    // RGB
    rgbBands,
    setRgbBands: (r: number, g: number, b: number) =>
      setRgbBandsState({ r, g, b }),
    rgbImgUrl,

    // Selection
    selectionMode,
    setSelectionMode,
    navigationMode,
    setNavigationMode,
    showSignalProcessing,
    setShowSignalProcessing,

    // Spectra
    selectedSpectra,
    addSpectrum,
    clearSpectra,

    // Annotations
    annotations,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    clearProbePointsForDataset,

    // selected ROI
    selectedRoiId,
    setSelectedRoiId,
    roiSpectraById,
    setRoiSpectraForId,

    selectedProbeGroupId,
    setSelectedProbeGroupId,
    probeSpectraByGroupId,
    setProbeSpectraForGroup,
    selectedProbePointId,
    setSelectedProbePointId,
    view,
    setView,
    zoomIn,
    zoomOut,
    resetView,

  }), [
    fileLayers,
    dataset,
    datasetId,
    rgbBands,
    rgbImgUrl,
    selectionMode,
    navigationMode,
    showSignalProcessing,
    selectedSpectra,
    annotations,
    updateAnnotation,
    clearProbePointsForDataset,
    selectedRoiId,
    roiSpectraById,
    setSelectedRoiId,
    setRoiSpectraForId,
    selectedProbeGroupId,
    probeSpectraByGroupId,
    setSelectedProbeGroupId,
    setProbeSpectraForGroup,
    selectedProbePointId,
    setSelectedProbePointId,
    view,
    setView,
    zoomIn,
    zoomOut,
    resetView,
  ])

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
    </Ctx.Provider>
  )
}

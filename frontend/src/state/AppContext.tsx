import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { listDatasets, rgbUrl, visualUrl, saveDatasetAnnotations, getDatasetAnnotations, getRoiExtraction, listProjects, createProject } from '../lib/api';
import type { ProjectMeta, RoiExtraction } from '../lib/api';
import type { DatasetMeta } from '../lib/api';
import type { Annotation } from '../models/annotations'
import type { Layer } from './types'
import type { Spectrum } from '../components/hsi_tools/SpectrumPlot'
import { useCallback } from 'react'


type SelectionMode = 'single' | 'multiple' | 'rect' | 'ellipse' | 'line' | 'polygon'
type ViewState = { zoom: number; panX: number; panY: number }


type Ctx = {
  // Layers
  fileLayers: Layer[];
  toggleLayer: (id: string) => void;

  // project — the investigation currently in view. Datasets are scoped to it.
  projects: ProjectMeta[];
  projectId?: string;
  setProjectId: (id: string) => void;
  addProject: (title: string) => Promise<ProjectMeta>;

  // dataset
  dataset?: DatasetMeta;
  datasetId?: string;
  setDatasetId: (id: string) => void;
  refreshDatasets: () => Promise<DatasetMeta[]>;

  //RGB
  rgbBands: { r: number; g: number; b: number };
  setRgbBands: (r: number, g: number, b: number) => void;
  rgbImgUrl?: string;

  // Selection
  selectionMode: SelectionMode | null;
  setSelectionMode: (m: SelectionMode | null) => void;
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
  setAnnotationsForDataset: (datasetId: string, next: Annotation[]) => void
  saveAnnotationsForDataset: (datasetId: string, next: Annotation[]) => Promise<void>

  // selected ROI
  selectedRoiId: string | null
  setSelectedRoiId: (id: string | null) => void
  roiSpectraById: Record<string, Spectrum[]>
  setRoiSpectraForId: (id: string, spectra: Spectrum[]) => void
  // Statistics measured server-side when the ROI was saved. Populated on demand for ROIs
  // loaded from the database, which have no per-pixel spectra in the browser.
  roiExtractionById: Record<string, RoiExtraction | null>
  loadRoiExtraction: (datasetId: string, roiId: string) => Promise<void>


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

  // Layout
  primaryWidth: number
  setPrimaryWidth: (v: number) => void
};

const Ctx = createContext<Ctx | null>(null);
// eslint-disable-next-line react-refresh/only-export-components -- hook intentionally co-located with its provider
export const useApp = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within an AppProvider');
  return ctx;
};

export function AppProvider({ children }: { children: React.ReactNode }) {

  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  // Which project is open is a per-browser preference, not server state — two windows may
  // legitimately sit in different investigations.
  const [projectId, setProjectIdState] = useState<string | undefined>(
    () => localStorage.getItem('spectrapaint.projectId') ?? undefined,
  );

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
    setAnnotations(prev => prev.map(a => (a.id === id ? ({ ...a, ...patch, updatedAt: new Date().toISOString() } as Annotation) : a)))
  }, [])

  const clearProbePointsForDataset = useCallback((datasetId: string) => {
    setAnnotations(prev =>
      prev.filter(a => !(a.datasetId === datasetId && a.kind === 'probe' && a.type === 'point'))
    )
  }, [])

  // Replace every annotation belonging to a dataset (used for bulk edit/delete in WorkArea).
  const setAnnotationsForDataset = useCallback((datasetId: string, next: Annotation[]) => {
    setAnnotations(prev => [...prev.filter(a => a.datasetId !== datasetId), ...next])
  }, [])

  // Persist a dataset's annotations to the backend.
  const saveAnnotationsForDataset = useCallback(async (datasetId: string, next: Annotation[]) => {
    await saveDatasetAnnotations(datasetId, next)
  }, [])


  // Select the annotation / ROI
  const toggleLayer = (id: string) => setDatasetId(id)

  // new for selection one or multiple pixels in the image
  const [selectionMode, setSelectionMode] = useState<SelectionMode | null>('single')
  const [navigationMode, setNavigationMode] = useState(false)
  const [showSignalProcessing, setShowSignalProcessing] = useState(false)
  const [primaryWidth, setPrimaryWidth] = useState(600)
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

  // Statistics measured when the ROI was saved. An ROI drawn in this session already has its
  // per-pixel spectra in memory; one loaded from the database has nothing until we ask.
  const [roiExtractionById, setRoiExtractionById] = useState<Record<string, RoiExtraction | null>>({})

  const loadRoiExtraction = useCallback(async (datasetId: string, roiId: string) => {
    // A cached `null` means the backend already told us this ROI has no spectra — do not ask
    // again every time it is selected.
    if (roiId in roiExtractionById) return
    try {
      const extraction = await getRoiExtraction(datasetId, roiId)
      setRoiExtractionById(prev => ({ ...prev, [roiId]: extraction }))
    } catch (err) {
      console.error('Failed to load ROI spectra', err)
    }
  }, [roiExtractionById])


  // Reload the dataset list from the backend (used on mount and after an upload).
  const setProjectId = useCallback((id: string) => {
    localStorage.setItem('spectrapaint.projectId', id)
    setProjectIdState(id)
  }, [])

  const refreshDatasets = useCallback(async () => {
    const ds = await listDatasets(projectId);
    setDatasets(ds);
    return ds;
  }, [projectId]);

  // Load the projects once, and settle on one. A stored choice that no longer exists — a
  // deleted project, or a different machine — falls back to the first rather than showing
  // an empty Data Manager with no way out.
  useEffect(() => {
    let cancelled = false
    listProjects()
      .then((loaded) => {
        if (cancelled) return
        setProjects(loaded)
        const stored = localStorage.getItem('spectrapaint.projectId')
        const chosen = loaded.find((p) => p.project_id === stored) ?? loaded[0]
        if (chosen) setProjectId(chosen.project_id)
      })
      .catch((err) => console.error('Failed to load projects', err))
    return () => { cancelled = true }
  }, [setProjectId]);

  const addProject = useCallback(async (title: string) => {
    const created = await createProject(title)
    setProjects((prev) => [...prev, created])
    setProjectId(created.project_id)
    return created
  }, [setProjectId]);

  // Re-runs when the project changes, because refreshDatasets closes over it.
  useEffect(() => {
    refreshDatasets().then(ds => {
      // Keep the current dataset if the new project still contains it, otherwise fall to the
      // first — switching investigations must not leave the previous one's image on screen.
      setDatasetId(prev => (prev && ds.some(d => d.id === prev) ? prev : ds[0]?.id) as string);
    }).catch(console.error);
  }, [refreshDatasets]);

  useEffect(() => {
    if (!datasetId) return;
    const d = datasets.find(x => x.id === datasetId);
    setDataset(d);
  }, [datasetId, datasets]);

  // Load saved annotations for the selected dataset from the backend, so they survive a
  // page reload / dataset switch (they are persisted in the DB but were never fetched back).
  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    getDatasetAnnotations(datasetId)
      .then(anns => { if (!cancelled) setAnnotationsForDataset(datasetId, anns); })
      .catch(console.error);
    return () => { cancelled = true };
  }, [datasetId, setAnnotationsForDataset]);

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
    projects,
    projectId,
    setProjectId,
    addProject,

    // Dataset
    dataset,
    datasetId,
    setDatasetId,
    refreshDatasets,

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
    setAnnotationsForDataset,
    saveAnnotationsForDataset,

    // selected ROI
    selectedRoiId,
    setSelectedRoiId,
    roiSpectraById,
    setRoiSpectraForId,
    roiExtractionById,
    loadRoiExtraction,

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
    primaryWidth,
    setPrimaryWidth,

  }), [
    projects,
    projectId,
    setProjectId,
    addProject,
    fileLayers,
    dataset,
    datasetId,
    refreshDatasets,
    rgbBands,
    rgbImgUrl,
    selectionMode,
    navigationMode,
    showSignalProcessing,
    selectedSpectra,
    annotations,
    updateAnnotation,
    clearProbePointsForDataset,
    setAnnotationsForDataset,
    saveAnnotationsForDataset,
    selectedRoiId,
    roiSpectraById,
    setSelectedRoiId,
    setRoiSpectraForId,
    // Without these the memo hands back a stale value once an extraction resolves, and the
    // plot never sees the spectra it just fetched.
    roiExtractionById,
    loadRoiExtraction,
    selectedProbeGroupId,
    probeSpectraByGroupId,
    setSelectedProbeGroupId,
    setProbeSpectraForGroup,
    selectedProbePointId,
    setSelectedProbePointId,
    view,
    setView,
    primaryWidth,
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

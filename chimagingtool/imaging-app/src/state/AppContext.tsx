import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import { listDatasets, rgbUrl } from '../lib/api';
import type { DatasetMeta } from '../lib/api';
import type { Annotation } from '../models/annotations'
import { useCallback } from 'react'


type SelectionMode = 'single' | 'multiple' | 'rect' | 'ellipse' | 'line' |  'polygon' 


type Ctx = {
  // Layers
  layers: Layer[];
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

  // spetra
  selectedSpectra: Spectrum[];
  addSpectrum: (s: Spectrum) => void;
  clearSpectra: () => void;

   // Annotations 
  annotations: Annotation[]
  addAnnotation: (a: Annotation) => void
  removeAnnotation: (id: string) => void
  clearProbePointsForDataset: (datasetId: string) => void
};

const Ctx = createContext<Ctx>(null as any);
export const useApp = () => useContext(Ctx);

export function AppProvider({children}:{children:React.ReactNode}) {
  const [layers, setLayers] = useState<Layer[]>([{ id:'rgb', name:'Hyperspectral Image', on:true }]);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [datasetId, setDatasetId] = useState<string>();
  const [dataset, setDataset] = useState<DatasetMeta>();
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

const clearProbePointsForDataset = useCallback((datasetId: string) => {
  setAnnotations(prev =>
    prev.filter(a => !(a.datasetId === datasetId && a.kind === 'probe' && a.type === 'point'))
  )
}, [])


// Select the annotation / ROI
  const toggleLayer = (id:string) => setLayers(ls => ls.map(l => l.id===id ? {...l,on:!l.on}: l));

  // new for selection one or multiple pixels in the image
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('single')

  

  const [selectedSpectra, setSelectedSpectra] = useState<Spectrum[]>([]);

  const addSpectrum = (s: Spectrum) =>
    setSelectedSpectra(prev => [...prev, s]);

  const clearSpectra = () => setSelectedSpectra([]);


  useEffect(() => { listDatasets().then(ds => {
    setDatasets(ds);
    if (ds.length) { setDataset(ds[0]); setDatasetId(ds[0].id); }
  }).catch(console.error); }, []);

  useEffect(() => {
    if (!datasetId) return;
    const d = datasets.find(x => x.id === datasetId);
    setDataset(d);
    // cache-buster so the <img> updates when bands change
    const u = rgbUrl(datasetId, rgbBands.r, rgbBands.g, rgbBands.b) + `&t=${Date.now()}`;
    setRgbImgUrl(u);
  }, [datasetId, datasets, rgbBands]);

const ctxValue: Ctx = useMemo(() => ({
  // Layers
  layers,
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

  // Spectra
  selectedSpectra,
  addSpectrum,
  clearSpectra,

  // Annotations
  annotations,
  addAnnotation,
  removeAnnotation,
  clearProbePointsForDataset,
}), [
  layers,
  dataset,
  datasetId,
  rgbBands,
  rgbImgUrl,
  selectionMode,
  selectedSpectra,
  annotations,
  clearProbePointsForDataset,
])

return (
  <Ctx.Provider value={ctxValue}>
    {children}
  </Ctx.Provider>
)
}

import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import { listDatasets, rgbUrl } from '../lib/api';
import type { DatasetMeta } from '../lib/api';

type Layer = { id: string; name: string; on: boolean };
type Ctx = {
  layers: Layer[]; toggleLayer: (id:string)=>void;
  dataset?: DatasetMeta; datasetId?: string; setDatasetId: (id:string)=>void;
  rgbBands: {r:number;g:number;b:number}; setRgbBands:(r:number,g:number,b:number)=>void;
  rgbImgUrl?: string;
};
const Ctx = createContext<Ctx>(null as any);
export const useApp = () => useContext(Ctx);

export function AppProvider({children}:{children:React.ReactNode}) {
  const [layers, setLayers] = useState<Layer[]>([{ id:'rgb', name:'RGB Composite', on:true }]);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [datasetId, setDatasetId] = useState<string>();
  const [dataset, setDataset] = useState<DatasetMeta>();
  const [rgbBands, setRgbBandsState] = useState({ r: 650, g: 550, b: 450 });
  const [rgbImgUrl, setRgbImgUrl] = useState<string>();

  const toggleLayer = (id:string) => setLayers(ls => ls.map(l => l.id===id ? {...l,on:!l.on}: l));

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

  const value = useMemo(() => ({
    layers, toggleLayer, dataset, datasetId, setDatasetId,
    rgbBands, setRgbBands: (r:number,g:number,b:number)=>setRgbBandsState({r,g,b}),
    rgbImgUrl,
  }), [layers, dataset, datasetId, rgbBands, rgbImgUrl]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

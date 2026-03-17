import type { Annotation } from '../models/annotations'

export type DatasetMeta = {
  id: string
  name: string
  type: 'hsi' | 'tiff' | 'png' | 'jpg'
  path: string
  width: number
  height: number
  wavelengths_nm: number[] | null
}

const base = '/api';

export async function listDatasets(): Promise<DatasetMeta[]> {
  const r = await fetch(`${base}/datasets`);
  if (!r.ok) throw new Error('Failed to list datasets');
  return r.json();
}

export const rgbUrl = (id: string, r: number, g: number, b: number, stretch='percent_2') =>
  `${base}/datasets/${id}/rgb?r=${r}&g=${g}&b=${b}&stretch=${stretch}`;

export const visualUrl = (id: string, maxW?: number) =>
  `${base}/datasets/${id}/visual${maxW ? `?max_w=${Math.round(maxW)}` : ''}`;

export async function getDatasetAnnotations(id: string): Promise<Annotation[]> {
  const r = await fetch(`${base}/datasets/${id}/annotations`);
  if (!r.ok) throw new Error('Failed to load annotations');
  const data = await r.json() as { annotations?: Annotation[] }
  return Array.isArray(data.annotations) ? data.annotations : []
}

export async function saveDatasetAnnotations(id: string, annotations: Annotation[]): Promise<void> {
  const r = await fetch(`${base}/datasets/${id}/annotations`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotations }),
  })
  if (!r.ok) throw new Error('Failed to save annotations')
}

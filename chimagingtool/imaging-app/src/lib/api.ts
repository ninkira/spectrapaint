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

// Full ENVI hyperspectral-cube metadata (see backend HsiCubeMeta). Optional header fields are
// null when the file omits them.
export type HsiCubeMeta = {
  cube_id: string
  data_ref: string
  created_at: string | null
  checksum: string | null
  samples: number
  lines: number
  number_of_bands: number
  wavelengths: number[]
  wavelength_units: string
  fwhm: number[] | null
  spectral_range_min: number | null
  spectral_range_max: number | null
  interleave: string | null
  data_type: number | null
  default_bands: number[] | null
  pixel_size: number | null
  sensor_type: string | null
  description: string | null
  file_type: string | null
  header_offset: number | null
}

const base = '/api';

export async function listDatasets(): Promise<DatasetMeta[]> {
  const r = await fetch(`${base}/datasets`);
  if (!r.ok) throw new Error('Failed to list datasets');
  return r.json();
}

export async function getDatasetMetadata(id: string): Promise<HsiCubeMeta> {
  const r = await fetch(`${base}/datasets/${id}/metadata`);
  if (!r.ok) throw new Error('Failed to load dataset metadata');
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

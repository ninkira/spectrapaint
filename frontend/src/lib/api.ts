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

// --- Dataset upload ---------------------------------------------------------------------

export type DataKind = 'hsi' | 'visual'
export type TargetModality = 'HSI' | 'XRF' | 'RGB' | 'other'

// Everything the upload modal can send. Mirrors the backend UploadMetadata model; only
// data_kind + target_modality are required, the rest are optional metadata.
export type UploadMetadata = {
  data_kind: DataKind
  target_modality: TargetModality

  // external-input basics
  source_tool?: string
  capture_date?: string        // EXIF
  camera_model?: string        // EXIF
  instrument_id?: string
  operator?: string
  processing_steps?: string
  dc_rights?: string           // DC
  created_at?: string
  notes?: string

  // data acquisition (capture session)
  captured_at?: string
  instrument_settings?: Record<string, unknown>
  illumination_type?: string
  illumination_source?: string
  illumination_notes?: string
  temperature?: number
  distance_to_object?: number
  instrument_position?: string
  scan_duration?: number
  dark_reference?: boolean
  white_reference?: boolean
  calibration_ref?: string
  preprocessing_notes?: string
  software_version?: string
  exif_available?: boolean
  envi_available?: boolean
}

const base = '/api';

export async function listDatasets(): Promise<DatasetMeta[]> {
  const r = await fetch(`${base}/datasets`);
  if (!r.ok) throw new Error('Failed to list datasets');
  return r.json();
}

// Upload a dataset: `file` is the visual image, or (for HSI) the ENVI .hdr header — in which
// case `data` must carry the binary cube. Returns the newly registered dataset.
export async function uploadDataset(
  meta: UploadMetadata,
  files: { file: File; data?: File | null },
): Promise<DatasetMeta> {
  const form = new FormData()
  form.append('metadata', JSON.stringify(meta))
  form.append('file', files.file)
  if (files.data) form.append('data', files.data)

  const r = await fetch(`${base}/datasets/upload`, { method: 'POST', body: form })
  if (!r.ok) {
    let detail = `Upload failed (${r.status})`
    try {
      const body = await r.json()
      if (typeof body?.detail === 'string') detail = body.detail
      else if (body?.detail) detail = JSON.stringify(body.detail)
    } catch { /* keep default */ }
    throw new Error(detail)
  }
  return r.json()
}

// Remove a dataset: deletes its file(s) and database records on the backend.
export async function deleteDataset(id: string): Promise<void> {
  const r = await fetch(`${base}/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`Failed to delete ${id} (${r.status})`)
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

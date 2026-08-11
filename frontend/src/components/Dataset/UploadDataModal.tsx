import React, { useEffect, useMemo, useState } from 'react'
import InfoModal from './DatasetInfoModal'
import { useApp } from '../../state/AppContext'
import {
  getDatasetMetadata,
  listDatasets,
  uploadDataset,
  uploadSpectralLibrary,
  type DataKind,
  type DatasetMeta,
  type HsiCubeMeta,
  type TargetModality,
  type UploadMetadata,
} from '../../lib/api'

const VISUAL_EXT = ['.tif', '.tiff', '.png', '.jpg', '.jpeg']
// Extensions accepted by the picker (ENVI header + common binary cube extensions + visuals).
const ACCEPT = '.hdr,.img,.raw,.dat,.bin,.cube,.bsq,.bil,.bip,.sli,.tif,.tiff,.png,.jpg,.jpeg'

const isHdr = (name: string) => name.toLowerCase().endsWith('.hdr')
const isVisual = (name: string) => VISUAL_EXT.some((e) => name.toLowerCase().endsWith(e))

function detectKind(name: string): DataKind | null {
  if (isHdr(name)) return 'hsi'
  if (isVisual(name)) return 'visual'
  return null
}

// A spectral library ships its data as .sli; HSI cubes use .img/.raw/etc.
const LIB_DATA_RE = /\.sli$/i
const CUBE_DATA_RE = /\.(img|raw|dat|bin|cube|bsq|bil|bip)$/i
const baseName = (name: string) => name.replace(/\.[^./\\]+$/, '')

type ItemKind = 'hsi' | 'visual' | 'library'
type UploadItem = {
  key: string
  kind: ItemKind
  title: string
  modality: TargetModality // used by visuals
  hdr?: File
  data?: File | null // hsi binary / library .sli
  file?: File // visual
}

// Group a flat selection (multi-file or a whole folder) into upload items: each .hdr is paired
// with its same-stem data file (.sli -> library, .img/.raw -> HSI cube); each image is its own item.
function groupFiles(files: File[]): UploadItem[] {
  const items: UploadItem[] = []
  const dataFiles = files.filter((f) => LIB_DATA_RE.test(f.name) || CUBE_DATA_RE.test(f.name))
  const used = new Set<File>()
  for (const hdr of files.filter((f) => isHdr(f.name))) {
    const stem = baseName(hdr.name).toLowerCase()
    const sibling = dataFiles.find((d) => !used.has(d) && baseName(d.name).toLowerCase() === stem)
    if (sibling) used.add(sibling)
    const isLib = sibling ? LIB_DATA_RE.test(sibling.name) : false
    items.push({
      key: `hdr:${hdr.name}`,
      kind: isLib ? 'library' : 'hsi',
      title: baseName(hdr.name),
      modality: 'HSI',
      hdr,
      data: sibling ?? null,
    })
  }
  for (const f of files.filter((f) => isVisual(f.name))) {
    items.push({ key: `vis:${f.name}`, kind: 'visual', title: baseName(f.name), modality: 'XRF', file: f })
  }
  return items
}

const KIND_LABEL: Record<ItemKind, string> = { hsi: 'HSI cube', visual: 'Image', library: 'Spectral library' }

// Read-only ENVI header fields shown in "Source / ENVI details" — populated either from a just-
// selected .hdr (HSI upload) or from a linked HSI dataset's metadata (a PNG render of an HSI).
type EnviInfo = {
  samples?: number
  lines?: number
  number_of_bands?: number
  wavelength_units?: string | null
  spectral_range_min?: number | null
  spectral_range_max?: number | null
  interleave?: string | null
  data_type?: number | null
  sensor_type?: string | null
  description?: string | null
}

// Parse an ENVI text header ("key = value" or "key = { … }", values may span lines).
function parseEnviHeader(text: string): Map<string, string> {
  const map = new Map<string, string>()
  const s = text.replace(/\r\n/g, '\n')
  const re = /^\s*([\w /]+?)\s*=\s*(\{[\s\S]*?\}|[^\n]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const key = m[1].trim().toLowerCase()
    let val = m[2].trim()
    if (val.startsWith('{')) val = val.slice(1, -1).trim()
    map.set(key, val.trim())
  }
  return map
}

function enviInfoFromHeaderText(text: string): EnviInfo {
  const m = parseEnviHeader(text)
  const int = (k: string) => {
    const v = m.get(k)
    const n = v ? parseInt(v, 10) : NaN
    return Number.isFinite(n) ? n : undefined
  }
  const wl = (m.get('wavelength') ?? '')
    .split(',')
    .map((x) => parseFloat(x.trim()))
    .filter((x) => Number.isFinite(x))
  const clean = (k: string) => {
    const v = m.get(k)?.trim()
    return v ? v : undefined
  }
  return {
    samples: int('samples'),
    lines: int('lines'),
    number_of_bands: int('bands'),
    wavelength_units: clean('wavelength units'),
    spectral_range_min: wl.length ? Math.min(...wl) : undefined,
    spectral_range_max: wl.length ? Math.max(...wl) : undefined,
    interleave: clean('interleave')?.toUpperCase(),
    data_type: int('data type'),
    sensor_type: clean('sensor type'),
    description: clean('description'),
  }
}

function enviInfoFromCubeMeta(md: HsiCubeMeta): EnviInfo {
  return {
    samples: md.samples,
    lines: md.lines,
    number_of_bands: md.number_of_bands,
    wavelength_units: md.wavelength_units,
    spectral_range_min: md.spectral_range_min,
    spectral_range_max: md.spectral_range_max,
    interleave: md.interleave,
    data_type: md.data_type,
    sensor_type: md.sensor_type,
    description: md.description,
  }
}

const inputStyle: React.CSSProperties = {
  padding: '0.5rem',
  borderRadius: 6,
  border: '1px solid #3a465c',
  background: 'transparent',
  color: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.85rem',
}

type FormState = {
  title: string
  target_modality: TargetModality
  linked_dataset_id: string
  source_tool: string
  notes: string
  // acquisition
  captured_at: string
  instrument_id: string
  instrument_settings: string
  illumination_type: string
  illumination_source: string
  illumination_notes: string
  temperature: string
  distance_to_object: string
  instrument_position: string
  scan_duration: string
  dark_reference: boolean
  white_reference: boolean
  calibration_ref: string
  preprocessing_notes: string
  software_version: string
  operator: string
  exif_available: boolean
  envi_available: boolean
  // external input / EXIF
  capture_date: string
  camera_model: string
  processing_steps: string
  dc_rights: string
  created_at: string
}

const INITIAL: FormState = {
  title: '',
  target_modality: 'XRF',
  linked_dataset_id: '',
  source_tool: '',
  notes: '',
  captured_at: '',
  instrument_id: '',
  instrument_settings: '',
  illumination_type: '',
  illumination_source: '',
  illumination_notes: '',
  temperature: '',
  distance_to_object: '',
  instrument_position: '',
  scan_duration: '',
  dark_reference: false,
  white_reference: false,
  calibration_ref: '',
  preprocessing_notes: '',
  software_version: '',
  operator: '',
  exif_available: false,
  envi_available: false,
  capture_date: '',
  camera_model: '',
  processing_steps: '',
  dc_rights: '',
  created_at: '',
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label style={labelStyle}>
      <span>
        {label}
        {required && <span style={{ color: '#f87171' }}> *</span>}
      </span>
      {children}
    </label>
  )
}

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details
      open={defaultOpen}
      style={{ border: '1px solid #2a3445', borderRadius: 8, padding: '0.5rem 0.75rem' }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>{title}</summary>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.6rem',
          marginTop: '0.75rem',
        }}
      >
        {children}
      </div>
    </details>
  )
}

// Read-only label/value pair used inside "Source / ENVI details".
function Detail({
  label,
  value,
  full,
}: {
  label: string
  value: React.ReactNode
  full?: boolean
}) {
  const empty = value === undefined || value === null || value === ''
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.15rem',
        fontSize: '0.8rem',
        ...(full ? { gridColumn: '1 / -1' } : {}),
      }}
    >
      <span style={{ color: '#8aa0bf' }}>{label}</span>
      <span>{empty ? '—' : value}</span>
    </div>
  )
}

interface UploadDataModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function UploadDataModal({ isOpen, onClose }: UploadDataModalProps) {
  const { refreshDatasets, setDatasetId } = useApp()

  const [file, setFile] = useState<File | null>(null)
  const [binary, setBinary] = useState<File | null>(null)
  const [items, setItems] = useState<UploadItem[]>([])
  const [form, setForm] = useState<FormState>(INITIAL)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [existingDatasets, setExistingDatasets] = useState<DatasetMeta[]>([])
  const [enviInfo, setEnviInfo] = useState<EnviInfo | null>(null)

  const kind: DataKind | null = useMemo(
    () => (file ? detectKind(file.name) : null),
    [file],
  )
  const fileFormat = file ? file.name.split('.').pop()?.toLowerCase() ?? '' : ''
  const linkedDataset = existingDatasets.find((d) => d.id === form.linked_dataset_id)

  const singleItem = items.length === 1 ? items[0] : null
  const batchMode = items.length > 1
  const isLibrarySingle = singleItem?.kind === 'library'
  const hasDatasetItems = items.some((i) => i.kind !== 'library')

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  // Load the existing datasets (for the "belongs to" picker) when the modal opens.
  useEffect(() => {
    if (!isOpen) return
    listDatasets().then(setExistingDatasets).catch(() => setExistingDatasets([]))
  }, [isOpen])

  // Derive the ENVI details to display: from the selected .hdr for an HSI upload, or from a linked
  // HSI dataset when a visual (e.g. a PNG render) is linked to one.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (kind === 'hsi' && file) {
        try {
          const text = await file.text()
          if (!cancelled) setEnviInfo(enviInfoFromHeaderText(text))
        } catch {
          if (!cancelled) setEnviInfo(null)
        }
      } else if (kind === 'visual' && linkedDataset?.type === 'hsi') {
        try {
          const md = await getDatasetMetadata(linkedDataset.id)
          if (!cancelled) setEnviInfo(enviInfoFromCubeMeta(md))
        } catch {
          if (!cancelled) setEnviInfo(null)
        }
      } else if (!cancelled) {
        setEnviInfo(null)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [kind, file, linkedDataset])

  const reset = () => {
    setFile(null)
    setBinary(null)
    setItems([])
    setForm(INITIAL)
    setError(null)
    setSubmitting(false)
    setProgress(null)
    setEnviInfo(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const updateItem = (key: string, patch: Partial<UploadItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))

  // One picker for everything — a few files or a whole folder. Files are grouped into items
  // (.hdr paired with its data file, images on their own); the primary item also feeds the
  // single-upload fields (title / ENVI details / modality) below.
  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    setError(null)
    const grouped = groupFiles(picked)
    setItems(grouped)

    const first = grouped[0]
    setFile(first?.hdr ?? first?.file ?? null)
    setBinary(first?.data ?? null)
    if (grouped.length === 1 && first) {
      set('title', first.title) // pre-fill the title from the filename (editable)
      if (first.kind === 'hsi') {
        set('target_modality', 'HSI')
        set('envi_available', true)
      } else if (first.kind === 'visual') {
        set('target_modality', first.modality)
      }
    }
  }

  type SharedMeta = Omit<UploadMetadata, 'data_kind' | 'target_modality' | 'title' | 'linked_dataset_id'>

  // The optional metadata shared across a batch (everything except identity/kind).
  const buildShared = (): SharedMeta | { error: string } => {
    const s = (v: string) => (v.trim() ? v.trim() : undefined)
    const num = (v: string): number | undefined => {
      if (!v.trim()) return undefined
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    let settings: Record<string, unknown> | undefined
    if (form.instrument_settings.trim()) {
      try {
        const parsed = JSON.parse(form.instrument_settings)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          settings = parsed as Record<string, unknown>
        } else {
          return { error: 'Instrument settings must be a JSON object, e.g. {"gain": 2}.' }
        }
      } catch {
        return { error: 'Instrument settings is not valid JSON.' }
      }
    }
    return {
      source_tool: s(form.source_tool),
      notes: s(form.notes),
      captured_at: s(form.captured_at),
      instrument_id: s(form.instrument_id),
      instrument_settings: settings,
      illumination_type: s(form.illumination_type),
      illumination_source: s(form.illumination_source),
      illumination_notes: s(form.illumination_notes),
      temperature: num(form.temperature),
      distance_to_object: num(form.distance_to_object),
      instrument_position: s(form.instrument_position),
      scan_duration: num(form.scan_duration),
      dark_reference: form.dark_reference,
      white_reference: form.white_reference,
      calibration_ref: s(form.calibration_ref),
      preprocessing_notes: s(form.preprocessing_notes),
      software_version: s(form.software_version),
      operator: s(form.operator),
      exif_available: form.exif_available,
      envi_available: form.envi_available,
      capture_date: s(form.capture_date),
      camera_model: s(form.camera_model),
      processing_steps: s(form.processing_steps),
      dc_rights: s(form.dc_rights),
      created_at: s(form.created_at),
    }
  }

  // Single-dataset payload (rich form): reuses the shared fields + this item's identity.
  const buildMetadata = (): UploadMetadata | { error: string } => {
    if (!file) return { error: 'Please choose a file to upload.' }
    if (!kind) return { error: 'Unsupported file type. Use an ENVI .hdr, or a TIFF/PNG/JPEG.' }
    if (kind === 'hsi' && !binary) {
      return { error: 'An ENVI cube needs its binary data file — select the .hdr and its .img/.raw together.' }
    }
    if (!form.title.trim()) return { error: 'Please enter a title/label for the dataset.' }
    const shared = buildShared()
    if ('error' in shared) return shared
    return {
      ...shared,
      data_kind: kind,
      target_modality: kind === 'hsi' ? 'HSI' : form.target_modality,
      title: form.title.trim(),
      linked_dataset_id: kind === 'visual' ? (form.linked_dataset_id.trim() || undefined) : undefined,
      envi_available: kind === 'hsi' ? true : form.envi_available,
    }
  }

  // Upload one grouped item via the right endpoint. Returns the created dataset id (null for libraries).
  const uploadOneItem = async (item: UploadItem, shared: SharedMeta): Promise<string | null> => {
    if (item.kind === 'library') {
      if (!item.hdr || !item.data) throw new Error('needs a .hdr and a .sli file')
      await uploadSpectralLibrary(item.hdr, item.data, item.title.trim() || undefined)
      return null
    }
    if (item.kind === 'hsi') {
      if (!item.hdr || !item.data) throw new Error('needs the .hdr and its .img/.raw binary')
      const meta: UploadMetadata = { ...shared, data_kind: 'hsi', target_modality: 'HSI', title: item.title.trim(), envi_available: true }
      return (await uploadDataset(meta, { file: item.hdr, data: item.data })).id
    }
    if (!item.file) throw new Error('has no image file')
    const meta: UploadMetadata = { ...shared, data_kind: 'visual', target_modality: item.modality, title: item.title.trim() }
    return (await uploadDataset(meta, { file: item.file })).id
  }

  const runBatch = async () => {
    const shared = buildShared()
    if ('error' in shared) { setError(shared.error); return }
    for (const it of items) {
      if (!it.title.trim()) { setError('Every item needs a title.'); return }
      if ((it.kind === 'hsi' || it.kind === 'library') && !it.data) {
        setError(`"${it.title}" is missing its ${it.kind === 'library' ? '.sli' : '.img/.raw'} data file.`)
        return
      }
    }
    setSubmitting(true)
    setError(null)
    let lastId: string | null = null
    const failures: string[] = []
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i]
      setProgress(`Uploading ${i + 1} of ${items.length}: ${it.title}`)
      try {
        const id = await uploadOneItem(it, shared)
        if (id) lastId = id
      } catch (err) {
        failures.push(`${it.title}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }
    setProgress(null)
    await refreshDatasets()
    if (lastId) setDatasetId(lastId)
    if (failures.length) {
      setError(`${failures.length} of ${items.length} item(s) failed:\n${failures.join('\n')}`)
      setSubmitting(false)
    } else {
      close()
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (items.length === 0) { setError('Please choose a file to upload.'); return }

    if (batchMode) { await runBatch(); return }

    if (isLibrarySingle) {
      if (!file || !binary) { setError('A spectral library needs a .hdr and its .sli file.'); return }
      if (!form.title.trim()) { setError('Please enter a name for the library.'); return }
      setSubmitting(true)
      setError(null)
      try {
        await uploadSpectralLibrary(file, binary, form.title.trim())
        close()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Library upload failed')
        setSubmitting(false)
      }
      return
    }

    const built = buildMetadata()
    if ('error' in built) { setError(built.error); return }
    setSubmitting(true)
    setError(null)
    try {
      const created = await uploadDataset(built, { file: file!, data: binary })
      await refreshDatasets()
      setDatasetId(created.id)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setSubmitting(false)
    }
  }

  return (
    <InfoModal
      isOpen={isOpen}
      title="Upload data"
      onClose={close}
      panelStyle={{
        maxWidth: 640,
        width: '92vw',
        background: '#141a22',
        color: '#e8edf5',
        border: '1px solid #1f2633',
      }}
    >
      <form
        className="upload-form"
        onSubmit={onSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
      >
        {/* --- File selection --- */}
        <Field label="File(s)" required>
          <input
            type="file"
            multiple
            accept={ACCEPT}
            onChange={onPickFiles}
            style={inputStyle}
          />
          <span style={{ fontSize: '0.75rem', color: '#8aa0bf' }}>
            Pick one dataset, several at once, or a whole folder's files. HSI cube =
            {' '}<code>.hdr</code> + <code>.img</code>/<code>.raw</code> · spectral library =
            {' '}<code>.hdr</code> + <code>.sli</code>.
          </span>
        </Field>

        {/* --- Batch: multiple items detected --- */}
        {batchMode && (
          <div style={{ border: '1px solid #2a3445', borderRadius: 8, padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#8aa0bf' }}>
              {items.length} items detected — titles are pre-filled from filenames. Shared metadata
              below applies to all cubes/images.
            </div>
            {items.map((it) => (
              <div key={it.key} style={{ display: 'grid', gridTemplateColumns: '7rem 1fr 6rem', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: '#93c5fd', border: '1px solid #3b82f6', borderRadius: 6, padding: '0.1rem 0.4rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {KIND_LABEL[it.kind]}
                </span>
                <input
                  type="text"
                  value={it.title}
                  onChange={(e) => updateItem(it.key, { title: e.target.value })}
                  style={{ ...inputStyle, padding: '0.35rem 0.5rem' }}
                />
                {it.kind === 'visual' ? (
                  <select
                    value={it.modality}
                    onChange={(e) => updateItem(it.key, { modality: e.target.value as TargetModality })}
                    style={{ ...inputStyle, padding: '0.35rem 0.5rem' }}
                  >
                    <option value="HSI">HSI</option>
                    <option value="XRF">XRF</option>
                    <option value="RGB">RGB</option>
                    <option value="other">Other</option>
                  </select>
                ) : (
                  <span style={{ fontSize: '0.72rem', color: it.data ? '#8aa0bf' : '#f87171', textAlign: 'center' }}>
                    {it.data ? (it.kind === 'library' ? '.sli ✓' : 'binary ✓') : 'no data'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* --- Single spectral library --- */}
        {isLibrarySingle && (
          <>
            <div style={{ fontSize: '0.82rem', color: '#8aa0bf' }}>
              Detected a <strong>spectral library</strong> (reference data for classification).<br />
              Header: <code>{singleItem?.hdr?.name}</code> · Data:{' '}
              {singleItem?.data ? (
                <code>{singleItem.data.name}</code>
              ) : (
                <span style={{ color: '#f87171' }}>missing — also select the .sli file</span>
              )}
            </div>
            <Field label="Library name" required>
              <input
                type="text"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="A name for this library"
                style={inputStyle}
              />
            </Field>
          </>
        )}

        {/* --- Single dataset (rich form) --- */}
        {singleItem && !isLibrarySingle && (
          <>
            {kind === 'hsi' && (
              <div style={{ fontSize: '0.82rem', color: '#8aa0bf' }}>
                Detected an ENVI cube → registered as <strong>HSI</strong>.<br />
                Header: <code>{file?.name}</code> · Binary:{' '}
                {binary ? (
                  <code>{binary.name}</code>
                ) : (
                  <span style={{ color: '#f87171' }}>missing — also select the .img/.raw file</span>
                )}
                <br />
                Dimensions, wavelengths, interleave and the other ENVI header fields are read
                automatically.
              </div>
            )}

            <Field label="Title / label" required>
              <input
                type="text"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="A name for this dataset"
                style={inputStyle}
              />
            </Field>

            {kind === 'visual' && (
              <>
                <Field label="This image is input to…">
                  <select
                    value={form.target_modality}
                    onChange={(e) => set('target_modality', e.target.value as TargetModality)}
                    style={inputStyle}
                  >
                    <option value="HSI">HSI</option>
                    <option value="XRF">XRF</option>
                    <option value="RGB">RGB</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Belongs to (existing dataset)">
                  <select
                    value={form.linked_dataset_id}
                    onChange={(e) => set('linked_dataset_id', e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">— none —</option>
                    {existingDatasets.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.type})
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            {enviInfo && (
              <Section title="Source / ENVI details" defaultOpen>
                {kind === 'visual' && linkedDataset && (
                  <Detail label="Linked HSI dataset" value={linkedDataset.name} full />
                )}
                <Detail label="Samples (width)" value={enviInfo.samples} />
                <Detail label="Lines (height)" value={enviInfo.lines} />
                <Detail label="Bands" value={enviInfo.number_of_bands} />
                <Detail label="Interleave" value={enviInfo.interleave} />
                <Detail label="Data type" value={enviInfo.data_type} />
                <Detail label="Wavelength units" value={enviInfo.wavelength_units} />
                <Detail
                  label="Spectral range"
                  value={
                    enviInfo.spectral_range_min != null && enviInfo.spectral_range_max != null
                      ? `${enviInfo.spectral_range_min} – ${enviInfo.spectral_range_max}`
                      : undefined
                  }
                />
                <Detail label="Sensor type" value={enviInfo.sensor_type} />
                <Detail label="Description" value={enviInfo.description} full />
              </Section>
            )}
          </>
        )}

        {/* --- Shared dataset basics (single dataset or a batch containing datasets) --- */}
        {hasDatasetItems && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <Field label="Source tool">
                <input
                  type="text"
                  value={form.source_tool}
                  onChange={(e) => set('source_tool', e.target.value)}
                  placeholder="e.g. Specim Lumo, PyMca"
                  style={inputStyle}
                />
              </Field>
              {!batchMode && (
                <Field label="File format">
                  <input type="text" value={fileFormat} readOnly style={{ ...inputStyle, opacity: 0.6 }} />
                </Field>
              )}
            </div>

            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={2}
                style={inputStyle}
              />
            </Field>
          </>
        )}


        {/* --- Data acquisition (applies to dataset uploads, not libraries) --- */}
        {hasDatasetItems && (
        <Section title="Data acquisition (capture session)">
          <Field label="Captured at">
            <input
              type="datetime-local"
              value={form.captured_at}
              onChange={(e) => set('captured_at', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Operator">
            <input
              type="text"
              value={form.operator}
              onChange={(e) => set('operator', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Instrument ID">
            <input
              type="text"
              value={form.instrument_id}
              onChange={(e) => set('instrument_id', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Instrument position">
            <input
              type="text"
              value={form.instrument_position}
              onChange={(e) => set('instrument_position', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Illumination type">
            <input
              type="text"
              value={form.illumination_type}
              onChange={(e) => set('illumination_type', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Illumination source">
            <input
              type="text"
              value={form.illumination_source}
              onChange={(e) => set('illumination_source', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Temperature (°C)">
            <input
              type="number"
              step="any"
              value={form.temperature}
              onChange={(e) => set('temperature', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Distance to object">
            <input
              type="number"
              step="any"
              value={form.distance_to_object}
              onChange={(e) => set('distance_to_object', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Scan duration (s)">
            <input
              type="number"
              step="any"
              value={form.scan_duration}
              onChange={(e) => set('scan_duration', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Software version">
            <input
              type="text"
              value={form.software_version}
              onChange={(e) => set('software_version', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Calibration reference">
            <input
              type="text"
              value={form.calibration_ref}
              onChange={(e) => set('calibration_ref', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Illumination notes">
            <input
              type="text"
              value={form.illumination_notes}
              onChange={(e) => set('illumination_notes', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
            Instrument settings (JSON)
            <textarea
              value={form.instrument_settings}
              onChange={(e) => set('instrument_settings', e.target.value)}
              placeholder='{"integration_time_ms": 20, "gain": 2}'
              rows={2}
              style={inputStyle}
            />
          </label>
          <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
            Preprocessing notes
            <textarea
              value={form.preprocessing_notes}
              onChange={(e) => set('preprocessing_notes', e.target.value)}
              rows={2}
              style={inputStyle}
            />
          </label>
          <label style={{ flexDirection: 'row', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={form.dark_reference}
              onChange={(e) => set('dark_reference', e.target.checked)}
            />
            Dark reference
          </label>
          <label style={{ flexDirection: 'row', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={form.white_reference}
              onChange={(e) => set('white_reference', e.target.checked)}
            />
            White reference
          </label>
          <label style={{ flexDirection: 'row', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={form.exif_available}
              onChange={(e) => set('exif_available', e.target.checked)}
            />
            EXIF available
          </label>
          <label style={{ flexDirection: 'row', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={form.envi_available}
              onChange={(e) => set('envi_available', e.target.checked)}
              disabled={kind === 'hsi'}
            />
            ENVI available
          </label>
        </Section>
        )}

        {/* --- Source / EXIF (single visual dataset only) --- */}
        {singleItem && !isLibrarySingle && kind === 'visual' && (
          <Section title="Source / EXIF details">
            <Field label="Capture date">
              <input
                type="date"
                value={form.capture_date}
                onChange={(e) => set('capture_date', e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Camera model">
              <input
                type="text"
                value={form.camera_model}
                onChange={(e) => set('camera_model', e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Created at">
              <input
                type="date"
                value={form.created_at}
                onChange={(e) => set('created_at', e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Rights (DC)">
              <input
                type="text"
                value={form.dc_rights}
                onChange={(e) => set('dc_rights', e.target.value)}
                style={inputStyle}
              />
            </Field>
            <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
              Processing steps
              <textarea
                value={form.processing_steps}
                onChange={(e) => set('processing_steps', e.target.value)}
                rows={2}
                style={inputStyle}
              />
            </label>
          </Section>
        )}

        {progress && <div style={{ color: '#8aa0bf', fontSize: '0.85rem' }}>{progress}</div>}
        {error && <div style={{ color: '#f87171', fontSize: '0.85rem', whiteSpace: 'pre-line' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={close} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              submitting ||
              items.length === 0 ||
              (!batchMode && isLibrarySingle && (!form.title.trim() || !binary)) ||
              (!batchMode && !isLibrarySingle && (!file || !form.title.trim() || (kind === 'hsi' && !binary)))
            }
          >
            {submitting
              ? 'Uploading…'
              : batchMode
                ? `Upload ${items.length} items`
                : isLibrarySingle
                  ? 'Upload library'
                  : 'Upload'}
          </button>
        </div>
      </form>
    </InfoModal>
  )
}

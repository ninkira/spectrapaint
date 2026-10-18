import React, { useEffect, useMemo, useState } from 'react'
import InfoModal from './DatasetInfoModal'
import { useApp } from '../../state/AppContext'
import {
  createObject,
  getDatasetMetadata,
  listDatasets,
  listObjects,
  listProjects,
  uploadDataset,
  uploadSpectralLibrary,
  type ObjectMeta,
  type DataKind,
  type DatasetMeta,
  type HsiCubeMeta,
  type ReferenceRole,
  type ReferenceSet,
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

// A spectral library ships its data as .sli; HSI cubes use .img/.raw/.dat/etc.
const LIB_DATA_RE = /\.sli$/i
const CUBE_DATA_RE = /\.(img|raw|dat|bin|cube|bsq|bil|bip)$/i
const baseName = (name: string) => name.replace(/\.[^./\\]+$/, '')
const isDataFile = (name: string) => LIB_DATA_RE.test(name) || CUBE_DATA_RE.test(name)

// A header pairs with its binary either by sharing the stem ("cube.hdr" + "cube.dat") or by
// carrying the binary's full name ("cube.dat.hdr" + "cube.dat"). Both conventions are in the
// wild — ENVI itself writes the second one — so accept either.
function pairsWith(hdrName: string, dataName: string): boolean {
  const stem = baseName(hdrName).toLowerCase()
  const data = dataName.toLowerCase()
  return stem === baseName(data) || stem === data
}

// Title from the header filename, dropping a data extension the header carries along, so
// "cube.dat.hdr" is offered as "cube" rather than "cube.dat".
function titleFor(hdrName: string): string {
  const stem = baseName(hdrName)
  return isDataFile(stem) ? baseName(stem) : stem
}

// Specim writes a scan's reference captures beside it as "<ROLE>_<stem>". Longest prefix first,
// so WHITEDARKREF is never mistaken for WHITEREF.
const REFERENCE_PREFIXES: Array<[ReferenceRole, RegExp]> = [
  ['white_dark', /^WHITEDARKREF[_-]/i],
  ['white', /^WHITEREF[_-]/i],
  ['dark', /^DARKREF[_-]/i],
]

const ROLE_LABEL: Record<ReferenceRole, string> = {
  dark: 'dark',
  white: 'white',
  white_dark: 'white-dark',
}

// Split "DARKREF_087" into its role and the scan it belongs to; null for an ordinary scan name.
function referenceRole(stem: string): { role: ReferenceRole; base: string } | null {
  for (const [role, re] of REFERENCE_PREFIXES) {
    if (re.test(stem)) return { role, base: stem.replace(re, '') }
  }
  return null
}

// What a selected cube *is*. Guessed from the filename, but always the user's to change: the
// Specim naming is only a convention, and a renamed or differently-exported capture would
// otherwise be stuck being registered as four unrelated cubes.
type ItemRole = 'scan' | ReferenceRole | 'reflectance'

const ROLE_OPTIONS: Array<[ItemRole, string]> = [
  ['scan', 'Radiance (scan)'],
  ['reflectance', 'Reflectance'],
  ['dark', 'Dark reference'],
  ['white', 'White reference'],
  ['white_dark', 'White-dark reference'],
]

const isReferenceRole = (role: ItemRole | undefined): role is ReferenceRole =>
  role === 'dark' || role === 'white' || role === 'white_dark'

type ItemKind = 'hsi' | 'visual' | 'library'
type UploadItem = {
  key: string
  kind: ItemKind
  title: string
  modality: TargetModality // used by visuals
  hdr?: File
  data?: File | null // hsi binary / library .sli
  file?: File // visual
  role?: ItemRole // hsi only
  base?: string // scan name a detected reference carries, lower-cased
  belongsTo?: string // key of the scan a reference serves
  convert?: boolean // scan only: flat-field it to reflectance on upload
}

// A reference is an input to a correction, not a dataset of its own, so it is never registered.
const isUploadable = (item: UploadItem) =>
  item.kind !== 'hsi' || item.role === 'scan' || item.role === 'reflectance'

// The references currently assigned to one scan.
function referencesFor(items: UploadItem[], scanKey: string): ReferenceSet {
  const set: ReferenceSet = {}
  for (const item of items) {
    if (isReferenceRole(item.role) && item.belongsTo === scanKey && item.hdr && item.data) {
      set[item.role] = { hdr: item.hdr, data: item.data }
    }
  }
  return set
}

// Re-point every reference at a scan and refresh which scans can be corrected. One item's role
// decides what the others can do, so this runs over the whole list after any change.
function normaliseRoles(items: UploadItem[]): UploadItem[] {
  const scans = items.filter((i) => i.role === 'scan')
  const pointed = items.map((item) => {
    if (!isReferenceRole(item.role)) return item
    const byName = scans.find((s) => s.title.toLowerCase() === item.base)
    // Falling back to the only scan present is what makes a renamed capture work without
    // the user having to say which scan each reference belongs to.
    const target = byName ?? (scans.length === 1 ? scans[0] : undefined)
    return { ...item, belongsTo: target?.key }
  })
  return pointed.map((item, _index, all) => {
    if (item.role !== 'scan') return item
    const refs = referencesFor(all, item.key)
    const possible = Boolean(refs.dark && refs.white)
    return { ...item, convert: possible ? item.convert ?? true : false }
  })
}

// Group a flat selection (multi-file or a whole folder) into upload items: each .hdr is paired
// with its data file (.sli -> library, .dat/.img/.raw -> HSI cube); each image is its own item.
// Every cube gets a row and a guessed role — references included, so the guess is visible and
// correctable rather than silently deciding what gets registered.
function groupFiles(files: File[]): { items: UploadItem[]; unpairedData: string[] } {
  const dataFiles = files.filter((f) => isDataFile(f.name))
  const used = new Set<File>()
  const items: UploadItem[] = files
    .filter((f) => isHdr(f.name))
    .map((hdr) => {
      const sibling = dataFiles.find((d) => !used.has(d) && pairsWith(hdr.name, d.name))
      if (sibling) used.add(sibling)
      const isLib = sibling ? LIB_DATA_RE.test(sibling.name) : false
      const stem = titleFor(hdr.name)
      const detected = referenceRole(stem)
      return {
        key: `hdr:${hdr.name}`,
        kind: (isLib ? 'library' : 'hsi') as ItemKind,
        title: stem,
        modality: 'HSI' as TargetModality,
        hdr,
        data: sibling ?? null,
        role: isLib ? undefined : detected?.role ?? ('scan' as ItemRole),
        base: detected?.base.toLowerCase(),
      }
    })
  for (const f of files.filter((f) => isVisual(f.name))) {
    items.push({ key: `vis:${f.name}`, kind: 'visual', title: baseName(f.name), modality: 'XRF', file: f })
  }
  // Binaries no header claimed — the only ones worth telling the user about.
  const unpairedData = dataFiles.filter((d) => !used.has(d)).map((d) => d.name)
  return { items: normaliseRoles(items), unpairedData }
}

const KIND_LABEL: Record<ItemKind, string> = { hsi: 'HSI cube', visual: 'Image', library: 'Spectral library' }

// Sentinel for "create one" in the object picker; a real object id is a UUID.
const NEW_OBJECT = '__new__'

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
  // The object everything in this upload depicts — what the Data Manager groups by.
  const [projectId, setProjectId] = useState<string | null>(null)
  const [objects, setObjects] = useState<ObjectMeta[]>([])
  const [objectChoice, setObjectChoice] = useState('') // '' | object_id | NEW_OBJECT
  const [newObjectTitle, setNewObjectTitle] = useState('')

  const kind: DataKind | null = useMemo(
    () => (file ? detectKind(file.name) : null),
    [file],
  )
  const fileFormat = file ? file.name.split('.').pop()?.toLowerCase() ?? '' : ''
  const linkedDataset = existingDatasets.find((d) => d.id === form.linked_dataset_id)

  // Only some of the selected files become datasets; references feed a correction instead.
  const registering = useMemo(() => items.filter(isUploadable), [items])
  const singleItem = registering.length === 1 ? registering[0] : null
  const batchMode = registering.length > 1
  const showRoleList = items.length > 1
  const isLibrarySingle = singleItem?.kind === 'library'
  const hasDatasetItems = registering.some((i) => i.kind !== 'library')

  // Scans that could be corrected, and references nothing claims — both worth surfacing.
  const scans = useMemo(() => items.filter((i) => i.role === 'scan'), [items])
  const unassignedRefs = useMemo(
    () => items.filter((i) => isReferenceRole(i.role) && !i.belongsTo),
    [items],
  )

  // A flat-field correction needs at least a dark and a white capture; the white-dark is
  // optional but changes the result, so its absence is worth saying out loud.
  const singleRefs =
    singleItem && singleItem.kind === 'hsi' ? referencesFor(items, singleItem.key) : undefined
  const canConvert = Boolean(singleRefs?.dark && singleRefs?.white)
  const willConvert = canConvert && Boolean(singleItem?.convert)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  // Load the existing datasets (for the "belongs to" picker) when the modal opens.
  useEffect(() => {
    if (!isOpen) return
    listDatasets().then(setExistingDatasets).catch(() => setExistingDatasets([]))
  }, [isOpen])

  // …and the objects this upload could be filed under. Grouping is the point of the picker, so
  // failing to load them leaves it empty rather than blocking the upload.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    listProjects()
      .then(async (projects) => {
        const first = projects[0]
        if (!first || cancelled) return
        setProjectId(first.project_id)
        const found = await listObjects(first.project_id)
        if (!cancelled) setObjects(found)
      })
      .catch(() => {
        if (!cancelled) { setProjectId(null); setObjects([]) }
      })
    return () => { cancelled = true }
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
    setObjectChoice('')
    setNewObjectTitle('')
  }

  // The object this upload is filed under, created first if the user named a new one. Returns
  // undefined to let the backend fall back to the default object, as it did before grouping.
  const resolveObjectId = async (): Promise<string | undefined> => {
    if (objectChoice !== NEW_OBJECT) return objectChoice || undefined
    if (!projectId) throw new Error('no project is available to create the object in')
    return (await createObject(projectId, newObjectTitle.trim())).object_id
  }

  const close = () => {
    reset()
    onClose()
  }

  const updateItem = (key: string, patch: Partial<UploadItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))

  // Changing one role re-points every reference and re-decides which scans can be corrected,
  // so the whole list is normalised rather than just the row that changed.
  const setRole = (key: string, role: ItemRole) =>
    setItems((prev) => normaliseRoles(prev.map((it) => (it.key === key ? { ...it, role } : it))))

  // One picker for everything — a few files or a whole folder. Files are grouped into items
  // (.hdr paired with its data file, images on their own); the primary item also feeds the
  // single-upload fields (title / ENVI details / modality) below.
  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    setError(null)
    const { items: grouped, unpairedData } = groupFiles(picked)
    setItems(grouped)

    // A cube binary carries no dimensions or wavelengths of its own, so picking one without its
    // header leaves nothing to upload. Say which file is unpaired instead of dropping it silently.
    if (grouped.length === 0 && picked.length > 0) {
      setError(
        unpairedData.length
          ? `Also select the ENVI .hdr header for ${unpairedData.join(', ')} — the binary alone cannot be read.`
          : 'Nothing usable in that selection. Pick an ENVI .hdr with its binary, or a TIFF/PNG/JPEG.',
      )
    }

    // The single rich form below describes whichever item will actually become a dataset.
    const registering = grouped.filter(isUploadable)
    const first = registering[0]
    setFile(first?.hdr ?? first?.file ?? null)
    setBinary(first?.data ?? null)
    if (registering.length === 1 && first) {
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
      return { error: 'An ENVI cube needs its binary data file — select the .hdr and its .dat/.img/.raw together.' }
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
      convert_to_reflectance: willConvert,
      processing_level: singleItem?.role === 'reflectance' ? 'reflectance' : undefined,
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
      if (!item.hdr || !item.data) throw new Error('needs the .hdr and its .dat/.img/.raw binary')
      const refs = referencesFor(items, item.key)
      const convert = Boolean(item.convert && refs.dark && refs.white)
      const meta: UploadMetadata = {
        ...shared,
        data_kind: 'hsi',
        target_modality: 'HSI',
        title: item.title.trim(),
        envi_available: true,
        convert_to_reflectance: convert,
        // A cube the user marked as already corrected is recorded as such rather than
        // left ambiguous — nothing in an ENVI header says which it is.
        processing_level: item.role === 'reflectance' ? 'reflectance' : undefined,
      }
      return (
        await uploadDataset(meta, {
          file: item.hdr,
          data: item.data,
          references: convert ? refs : undefined,
        })
      ).id
    }
    if (!item.file) throw new Error('has no image file')
    const meta: UploadMetadata = { ...shared, data_kind: 'visual', target_modality: item.modality, title: item.title.trim() }
    return (await uploadDataset(meta, { file: item.file })).id
  }

  const runBatch = async () => {
    const built = buildShared()
    if ('error' in built) { setError(built.error); return }
    if (objectChoice === NEW_OBJECT && !newObjectTitle.trim()) {
      setError('Name the new object, or pick an existing one.')
      return
    }
    for (const it of registering) {
      if (!it.title.trim()) { setError('Every item needs a title.'); return }
      if ((it.kind === 'hsi' || it.kind === 'library') && !it.data) {
        setError(`"${it.title}" is missing its ${it.kind === 'library' ? '.sli' : '.dat/.img/.raw'} data file.`)
        return
      }
    }
    setSubmitting(true)
    setError(null)
    // Created once, before the loop, so every dataset in the batch lands in the same group.
    let shared: SharedMeta
    try {
      shared = { ...built, object_id: await resolveObjectId() }
    } catch (err) {
      setError(`Could not file this under an object: ${err instanceof Error ? err.message : 'failed'}`)
      setSubmitting(false)
      return
    }
    let lastId: string | null = null
    const failures: string[] = []
    for (let i = 0; i < registering.length; i += 1) {
      const it = registering[i]
      setProgress(`Uploading ${i + 1} of ${registering.length}: ${it.title}`)
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
      setError(`${failures.length} of ${registering.length} item(s) failed:\n${failures.join('\n')}`)
      setSubmitting(false)
    } else {
      close()
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (registering.length === 0) { setError('Please choose a file to upload.'); return }

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
    if (objectChoice === NEW_OBJECT && !newObjectTitle.trim()) {
      setError('Name the new object, or pick an existing one.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      built.object_id = await resolveObjectId()
      const created = await uploadDataset(built, {
        file: file!,
        data: binary,
        references: willConvert ? singleRefs : undefined,
      })
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
            {' '}<code>.hdr</code> + <code>.dat</code>/<code>.img</code>/<code>.raw</code> ·
            {' '}spectral library = <code>.hdr</code> + <code>.sli</code>. Select a scan together
            with its <code>DARKREF_</code>/<code>WHITEREF_</code> files — all of them at once —
            and it can be corrected to reflectance.
          </span>
        </Field>

        {/* --- What each selected file is --- */}
        {showRoleList && (
          <div style={{ border: '1px solid #2a3445', borderRadius: 8, padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#8aa0bf' }}>
              {items.length} files paired — set what each one is. A reference is not registered as
              a dataset; it is used to correct the scan it belongs to.
            </div>
            {items.map((it) => (
              <div key={it.key} style={{ display: 'grid', gridTemplateColumns: '1fr 10rem 5rem', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="text"
                  value={it.title}
                  onChange={(e) => updateItem(it.key, { title: e.target.value })}
                  style={{ ...inputStyle, padding: '0.35rem 0.5rem', opacity: isUploadable(it) ? 1 : 0.55 }}
                />
                {it.kind === 'hsi' ? (
                  <select
                    value={it.role ?? 'scan'}
                    onChange={(e) => setRole(it.key, e.target.value as ItemRole)}
                    style={{ ...inputStyle, padding: '0.35rem 0.5rem' }}
                  >
                    {ROLE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                ) : it.kind === 'visual' ? (
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
                  <span style={{ fontSize: '0.72rem', color: '#93c5fd', textAlign: 'center' }}>
                    {KIND_LABEL[it.kind]}
                  </span>
                )}
                <span style={{ fontSize: '0.72rem', color: it.data || it.file ? '#8aa0bf' : '#f87171', textAlign: 'center' }}>
                  {it.data || it.file ? (it.kind === 'library' ? '.sli ✓' : 'binary ✓') : 'no data'}
                </span>
              </div>
            ))}

            {/* One toggle per scan that has the references a correction needs. */}
            {scans.map((scan) => {
              const refs = referencesFor(items, scan.key)
              const possible = Boolean(refs.dark && refs.white)
              const assigned = (['dark', 'white', 'white_dark'] as ReferenceRole[]).filter((r) => refs[r])
              if (!assigned.length) return null
              return (
                <div key={`conv:${scan.key}`} style={{ borderTop: '1px solid #2a3445', paddingTop: '0.5rem' }}>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', opacity: possible ? 1 : 0.6 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(scan.convert)}
                      disabled={!possible}
                      onChange={(e) => updateItem(scan.key, { convert: e.target.checked })}
                    />
                    Calculate reflectance for <strong>{scan.title}</strong>
                  </label>
                  <div style={{ fontSize: '0.75rem', color: possible ? '#8aa0bf' : '#fbbf24', marginLeft: '1.6rem' }}>
                    {possible
                      ? `(scan − dark) / (white − ${refs.white_dark ? 'white-dark' : 'dark'}) using ` +
                        `${assigned.map((r) => ROLE_LABEL[r]).join(', ')}.` +
                        (refs.white_dark ? '' : ' No white-dark assigned — the scan’s dark stands in for it.')
                      : `Also needs a ${refs.dark ? 'white' : 'dark'} reference.`}
                  </div>
                </div>
              )
            })}

            {unassignedRefs.length > 0 && (
              <div style={{ fontSize: '0.75rem', color: '#fbbf24', borderTop: '1px solid #2a3445', paddingTop: '0.5rem' }}>
                {unassignedRefs.map((r) => r.title).join(', ')} —{' '}
                {scans.length === 0
                  ? 'no scan selected for these to correct, so they will be ignored.'
                  : 'could not be matched to a scan by name. Rename, or mark one cube as the scan.'}
              </div>
            )}
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
                  <span style={{ color: '#f87171' }}>missing — also select the .dat/.img/.raw file</span>
                )}
                <br />
                Dimensions, wavelengths, interleave and the other ENVI header fields are read
                automatically.
              </div>
            )}

            {willConvert && (
              <div style={{ fontSize: '0.82rem', color: '#86efac' }}>
                Both cubes will be registered: the radiance scan, and the reflectance derived
                from it.
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
            <Field label="Object (groups these in the Data Manager)">
              <select
                value={objectChoice}
                onChange={(e) => setObjectChoice(e.target.value)}
                style={inputStyle}
              >
                <option value="">— default object —</option>
                {objects.map((o) => (
                  <option key={o.object_id} value={o.object_id}>{o.dc_title}</option>
                ))}
                <option value={NEW_OBJECT}>+ New object…</option>
              </select>
            </Field>
            {objectChoice === NEW_OBJECT && (
              <Field label="New object title" required>
                <input
                  type="text"
                  value={newObjectTitle}
                  onChange={(e) => setNewObjectTitle(e.target.value)}
                  placeholder="e.g. Old Man of Warnemünde"
                  style={inputStyle}
                />
              </Field>
            )}

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
              registering.length === 0 ||
              (!batchMode && isLibrarySingle && (!form.title.trim() || !binary)) ||
              (!batchMode && !isLibrarySingle && (!file || !form.title.trim() || (kind === 'hsi' && !binary)))
            }
          >
            {submitting
              ? 'Uploading…'
              : batchMode
                ? `Upload ${registering.length} items`
                : isLibrarySingle
                  ? 'Upload library'
                  : 'Upload'}
          </button>
        </div>
      </form>
    </InfoModal>
  )
}

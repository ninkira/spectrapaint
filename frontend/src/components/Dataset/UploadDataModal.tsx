import React, { useMemo, useState } from 'react'
import InfoModal from './DatasetInfoModal'
import { useApp } from '../../state/AppContext'
import { uploadDataset, type DataKind, type TargetModality, type UploadMetadata } from '../../lib/api'

const VISUAL_EXT = ['.tif', '.tiff', '.png', '.jpg', '.jpeg']
// Extensions accepted by the picker (ENVI header + common binary cube extensions + visuals).
const ACCEPT = '.hdr,.img,.raw,.dat,.bin,.cube,.bsq,.bil,.bip,.tif,.tiff,.png,.jpg,.jpeg'

const isHdr = (name: string) => name.toLowerCase().endsWith('.hdr')
const isVisual = (name: string) => VISUAL_EXT.some((e) => name.toLowerCase().endsWith(e))

function detectKind(name: string): DataKind | null {
  if (isHdr(name)) return 'hsi'
  if (isVisual(name)) return 'visual'
  return null
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details style={{ border: '1px solid #2a3445', borderRadius: 8, padding: '0.5rem 0.75rem' }}>
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

interface UploadDataModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function UploadDataModal({ isOpen, onClose }: UploadDataModalProps) {
  const { refreshDatasets, setDatasetId } = useApp()

  const [file, setFile] = useState<File | null>(null)
  const [binary, setBinary] = useState<File | null>(null)
  const [form, setForm] = useState<FormState>(INITIAL)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const kind: DataKind | null = useMemo(
    () => (file ? detectKind(file.name) : null),
    [file],
  )
  const fileFormat = file ? file.name.split('.').pop()?.toLowerCase() ?? '' : ''

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const reset = () => {
    setFile(null)
    setBinary(null)
    setForm(INITIAL)
    setError(null)
    setSubmitting(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  // One picker for everything. For an HSI cube the user selects the .hdr and its binary together;
  // we pair them up (header -> `file`, the other selected file -> `binary`).
  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    setError(null)
    if (picked.length === 0) {
      setFile(null)
      setBinary(null)
      return
    }
    const hdr = picked.find((f) => isHdr(f.name))
    if (hdr) {
      setFile(hdr)
      setBinary(picked.find((f) => f !== hdr) ?? null)
      set('target_modality', 'HSI')
      set('envi_available', true)
    } else {
      setFile(picked.find((f) => isVisual(f.name)) ?? picked[0])
      setBinary(null)
    }
  }

  // Trim strings, drop empties, parse numbers/JSON — assemble the UploadMetadata payload.
  const buildMetadata = (): UploadMetadata | { error: string } => {
    if (!file) return { error: 'Please choose a file to upload.' }
    if (!kind) return { error: 'Unsupported file type. Use an ENVI .hdr, or a TIFF/PNG/JPEG.' }
    if (kind === 'hsi' && !binary) {
      return { error: 'An ENVI cube needs its binary data file — select the .hdr and its .img/.raw together.' }
    }
    if (!form.title.trim()) return { error: 'Please enter a title/label for the dataset.' }

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

    const meta: UploadMetadata = {
      data_kind: kind,
      target_modality: kind === 'hsi' ? 'HSI' : form.target_modality,
      title: form.title.trim(),
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
      envi_available: kind === 'hsi' ? true : form.envi_available,
      capture_date: s(form.capture_date),
      camera_model: s(form.camera_model),
      processing_steps: s(form.processing_steps),
      dc_rights: s(form.dc_rights),
      created_at: s(form.created_at),
    }
    return meta
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const built = buildMetadata()
    if ('error' in built) {
      setError(built.error)
      return
    }
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
            For an HSI cube, select the <code>.hdr</code> and its <code>.img</code>/<code>.raw</code>{' '}
            together.
          </span>
        </Field>

        {file && !kind && (
          <div style={{ color: '#f87171', fontSize: '0.85rem' }}>
            Unsupported file type — choose an ENVI <code>.hdr</code> or a TIFF/PNG/JPEG.
          </div>
        )}

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

        {/* --- Title --- */}
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
        )}

        {/* --- Basics --- */}
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
          <Field label="File format">
            <input type="text" value={fileFormat} readOnly style={{ ...inputStyle, opacity: 0.6 }} />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            style={inputStyle}
          />
        </Field>

        {/* --- Data acquisition --- */}
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

        {/* --- Source / EXIF (visual only) --- */}
        {kind !== 'hsi' && (
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

        {error && <div style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={close} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !file || !form.title.trim() || (kind === 'hsi' && !binary)}
          >
            {submitting ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </form>
    </InfoModal>
  )
}

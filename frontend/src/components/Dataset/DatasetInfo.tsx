import React, { useEffect, useState } from 'react'
import InfoModal from './DatasetInfoModal'
import {
  getDatasetDbMeta,
  getDatasetMetadata,
  type AcquisitionMeta,
  type DatasetDbMeta,
  type ExternalInputMeta,
  type HsiCubeMeta,
} from '../../lib/api'
import { useApp } from '../../state/AppContext'
import type { DatasetMeta } from '../../lib/api'

// Inline SVG icons. Self-contained (no icon lib) and FILL-based (fill="currentColor") rather than
// stroked: filled paths render like text glyphs, whereas an earlier stroked version painted blank
// in this app. Size is pinned via inline style so no stylesheet rule can collapse it to 0.
const Icon: React.FC<{ d: string; size?: number }> = ({ d, size = 16 }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="currentColor"
    style={{ display: 'block', width: size, height: size, flexShrink: 0 }}
  >
    <path d={d} />
  </svg>
)

const InfoIcon = () => (
  <Icon size={18} d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
)

const CopyIcon = () => (
  <Icon size={14} d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
)

const CheckIcon = () => (
  <Icon size={14} d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
)

// ENVI "data type" header code → human-readable label.
const DATA_TYPE_LABELS: Record<number, string> = {
  1: '8-bit unsigned integer',
  2: '16-bit signed integer',
  3: '32-bit signed integer',
  4: '32-bit floating point',
  5: '64-bit double',
  6: '32-bit complex',
  9: '64-bit complex',
  12: '16-bit unsigned integer',
  13: '32-bit unsigned integer',
  14: '64-bit signed integer',
  15: '64-bit unsigned integer',
}

const DASH = '—'

// HSI processing level for the leading summary chip. All current data is reflectance; when the
// filename encodes a different level (radiance / raw) we surface that instead, else "Reflectance".
const HSI_PROCESSING_KEYWORDS = ['reflectance', 'radiance', 'raw'] as const

const hsiProcessingLevel = (name: string, path: string): string => {
  // Look only at the file title (basename) and display name — NOT the folder path, so a parent
  // folder like "raw/" doesn't get mistaken for a processing level. e.g. "hsi/raw/001.hdr" has
  // no keyword in "001" → defaults to Reflectance.
  const filename = path.split('/').pop() ?? path
  const hay = `${name} ${filename}`.toLowerCase()
  const found = HSI_PROCESSING_KEYWORDS.find((k) => hay.includes(k)) ?? 'reflectance'
  return found.charAt(0).toUpperCase() + found.slice(1)
}

// Summary-chip variants: the leading type chip is a solid accent, the processing-level chip an
// outlined accent, and the numeric facts are muted.
type ChipVariant = 'accent' | 'accent-soft' | 'muted'
type Chip = { label: string; variant: ChipVariant }

const CHIP_STYLES: Record<ChipVariant, React.CSSProperties> = {
  accent: {
    padding: '0.12rem 0.55rem', borderRadius: '6px', fontSize: '0.75rem', whiteSpace: 'nowrap',
    background: '#1d4ed833', border: '1px solid #3b82f6', color: '#93c5fd',
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
  },
  'accent-soft': {
    padding: '0.12rem 0.55rem', borderRadius: '6px', fontSize: '0.75rem', whiteSpace: 'nowrap',
    background: 'transparent', border: '1px solid #3b82f6', color: '#93c5fd',
  },
  muted: {
    padding: '0.12rem 0.5rem', borderRadius: '6px', fontSize: '0.75rem', whiteSpace: 'nowrap',
    border: '1px solid var(--border, #1f2633)', background: 'var(--panel2, #10161f)', color: 'var(--muted, #aab3c0)',
  },
}

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

const fmtNum = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? DASH : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })

const fmtInt = (v: number | null | undefined): string =>
  v === null || v === undefined ? DASH : Math.round(v).toLocaleString()

const fmtDate = (iso: string | null): string => {
  if (!iso) return DASH
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

const fmtBool = (v: boolean | null | undefined): string => (v ? 'Yes' : 'No')

// ---- small presentational building blocks -------------------------------------------------

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = 'value' }) => {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: 'none',
        background: 'transparent',
        color: copied ? '#4ade80' : 'var(--muted, #aab3c0)',
        cursor: 'pointer',
        padding: '0 0 0 0.4rem',
        flexShrink: 0,
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

const StatTile: React.FC<{ label: string; value: React.ReactNode; sub?: string }> = ({ label, value, sub }) => (
  <div
    style={{
      flex: '1 1 0',
      minWidth: '5.5rem',
      background: 'var(--panel2, #10161f)',
      border: '1px solid var(--border, #1f2633)',
      borderRadius: '10px',
      padding: '0.6rem 0.75rem',
      textAlign: 'center',
    }}
  >
    <div style={{ fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.15 }}>{value}</div>
    <div style={{ fontSize: '0.7rem', color: 'var(--muted, #aab3c0)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '0.2rem' }}>
      {label}
    </div>
    {sub && <div style={{ fontSize: '0.68rem', color: 'var(--muted, #aab3c0)', marginTop: '0.1rem' }}>{sub}</div>}
  </div>
)

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section
    style={{
      background: 'var(--panel2, #10161f)',
      border: '1px solid var(--border, #1f2633)',
      borderRadius: '10px',
      padding: '0.75rem 0.9rem',
    }}
  >
    <h3
      style={{
        margin: '0 0 0.6rem',
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        color: 'var(--muted, #aab3c0)',
      }}
    >
      {title}
    </h3>
    <div style={{ display: 'grid', gridTemplateColumns: '9.5rem 1fr', rowGap: '0.45rem', columnGap: '0.75rem', fontSize: '0.85rem' }}>
      {children}
    </div>
  </section>
)

const Row: React.FC<{
  label: string
  value?: React.ReactNode
  mono?: boolean
  copy?: string
}> = ({ label, value, mono, copy }) => {
  const empty = isBlank(value)
  return (
    <>
      <div style={{ color: 'var(--muted, #aab3c0)' }}>{label}</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.25rem',
          wordBreak: mono ? 'break-all' : 'break-word',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
          color: empty ? 'var(--muted, #aab3c0)' : 'inherit',
        }}
      >
        <span style={{ minWidth: 0, flex: '1 1 auto' }}>{empty ? DASH : value}</span>
        {copy && !empty && <CopyButton text={copy} label={label} />}
      </div>
    </>
  )
}

// ---- tab content views --------------------------------------------------------------------

// HSI cube metadata (the ENVI header) — unchanged content, now living in the "Cube metadata" tab.
const CubeMetaView: React.FC<{ meta: HsiCubeMeta | null; loading: boolean; error: string | null }> = ({
  meta,
  loading,
  error,
}) => {
  if (loading) {
    return <div style={{ padding: '1.5rem 0', textAlign: 'center', color: 'var(--muted, #aab3c0)' }}>Loading metadata…</div>
  }
  if (error) {
    return (
      <div style={{ padding: '1rem', borderRadius: '8px', background: '#7f1d1d33', border: '1px solid #ef4444', color: '#fca5a5' }}>
        Failed to load metadata: {error}
      </div>
    )
  }
  if (!meta) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
        <StatTile label="Width" value={fmtInt(meta.samples)} sub="samples" />
        <StatTile label="Height" value={fmtInt(meta.lines)} sub="lines" />
        <StatTile label="Bands" value={fmtInt(meta.number_of_bands)} />
        <StatTile
          label="Range"
          value={
            meta.spectral_range_min != null && meta.spectral_range_max != null
              ? `${fmtNum(meta.spectral_range_min, 0)}–${fmtNum(meta.spectral_range_max, 0)}`
              : DASH
          }
          sub={meta.wavelength_units}
        />
      </div>

      <Section title="Spectral">
        <Row
          label="Spectral range"
          value={
            meta.spectral_range_min != null && meta.spectral_range_max != null
              ? `${fmtNum(meta.spectral_range_min)} – ${fmtNum(meta.spectral_range_max)} ${meta.wavelength_units}`
              : undefined
          }
        />
        <Row label="Bands" value={fmtInt(meta.number_of_bands)} />
        <Row label="Wavelength units" value={meta.wavelength_units} />
        <Row label="FWHM" value={meta.fwhm && meta.fwhm.length ? `${meta.fwhm.length} values` : undefined} />
        <Row label="Default bands" value={meta.default_bands && meta.default_bands.length ? meta.default_bands.join(', ') : undefined} />
        {meta.wavelengths.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--muted, #aab3c0)', fontSize: '0.8rem' }}>
                All {meta.wavelengths.length} wavelengths
              </summary>
              <div
                style={{
                  marginTop: '0.45rem',
                  maxHeight: '9rem',
                  overflowY: 'auto',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '0.75rem',
                  lineHeight: 1.6,
                  color: 'var(--muted, #aab3c0)',
                  background: 'var(--bg, #0f1115)',
                  border: '1px solid var(--border, #1f2633)',
                  borderRadius: '8px',
                  padding: '0.5rem 0.6rem',
                }}
              >
                {meta.wavelengths.map((w) => fmtNum(w)).join(', ')}
              </div>
            </details>
          </div>
        )}
      </Section>

      <Section title="Format (ENVI)">
        <Row label="Interleave" value={meta.interleave} />
        <Row
          label="Data type"
          value={
            meta.data_type != null
              ? `${meta.data_type}${DATA_TYPE_LABELS[meta.data_type] ? ` — ${DATA_TYPE_LABELS[meta.data_type]}` : ''}`
              : undefined
          }
        />
        <Row label="File type" value={meta.file_type} />
        <Row label="Header offset" value={meta.header_offset != null ? fmtInt(meta.header_offset) : undefined} />
        <Row label="Sensor type" value={meta.sensor_type} />
        <Row label="Pixel size" value={meta.pixel_size != null ? fmtNum(meta.pixel_size, 4) : undefined} />
        {!isBlank(meta.description) && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: 'var(--muted, #aab3c0)', marginBottom: '0.35rem' }}>Description</div>
            <pre
              style={{
                margin: 0,
                maxHeight: '10rem',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.75rem',
                lineHeight: 1.5,
                color: 'var(--ink, #e8edf5)',
                background: 'var(--bg, #0f1115)',
                border: '1px solid var(--border, #1f2633)',
                borderRadius: '8px',
                padding: '0.5rem 0.6rem',
              }}
            >
              {meta.description}
            </pre>
          </div>
        )}
      </Section>

      <Section title="Identity">
        <Row label="Cube ID" value={meta.cube_id} mono copy={meta.cube_id} />
        <Row label="Data reference" value={meta.data_ref} mono copy={meta.data_ref} />
        <Row label="Created" value={fmtDate(meta.created_at)} />
        <Row label="Checksum" value={meta.checksum} mono copy={meta.checksum ?? undefined} />
      </Section>
    </div>
  )
}

// General data for a PNG/TIFF/JPEG — the ExternalInput import row + dataset basics.
const GeneralDataView: React.FC<{ dataset: DatasetMeta; ext: ExternalInputMeta | null }> = ({ dataset, ext }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
    <Section title="Dataset">
      <Row label="Title" value={ext?.title ?? dataset.name} />
      <Row label="Type" value={dataset.type} />
      <Row label="Width" value={`${fmtInt(ext?.width ?? dataset.width)} px`} />
      <Row label="Height" value={`${fmtInt(ext?.height_px ?? dataset.height)} px`} />
      <Row label="File format" value={ext?.file_format ?? dataset.type} />
      <Row label="Path" value={dataset.path} mono copy={dataset.path} />
    </Section>
    <Section title="Source">
      <Row label="Source tool" value={ext?.source_tool} />
      <Row label="Capture modality" value={ext?.capture_modality} />
      <Row label="Belongs to" value={ext?.linked_dataset_id} mono copy={ext?.linked_dataset_id ?? undefined} />
      <Row label="Capture date" value={ext ? fmtDate(ext.capture_date) : undefined} />
      <Row label="Camera model" value={ext?.camera_model} />
      <Row label="Instrument ID" value={ext?.instrument_id} />
      <Row label="Operator" value={ext?.operator} />
      <Row label="Rights (DC)" value={ext?.dc_rights} />
    </Section>
    <Section title="Provenance">
      <Row label="Processing steps" value={ext?.processing_steps} />
      <Row label="Created" value={ext ? fmtDate(ext.created_at) : undefined} />
      <Row label="Imported" value={ext ? fmtDate(ext.imported_at) : undefined} />
      <Row label="Notes" value={ext?.notes} />
    </Section>
  </div>
)

// Capture session (DataAcquisition) — shared by both data types.
const AcquisitionView: React.FC<{ acq: AcquisitionMeta | null }> = ({ acq }) => {
  if (!acq) {
    return (
      <div style={{ padding: '1.25rem 0', color: 'var(--muted, #aab3c0)', fontSize: '0.85rem' }}>
        No acquisition metadata recorded for this dataset.
      </div>
    )
  }
  const hasSettings = acq.instrument_settings && Object.keys(acq.instrument_settings).length > 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <Section title="Capture session">
        <Row label="Modality" value={acq.capture_modality} />
        <Row label="Captured at" value={fmtDate(acq.captured_at)} />
        <Row label="Operator" value={acq.operator} />
        <Row label="Instrument ID" value={acq.instrument_id} />
        <Row label="Instrument position" value={acq.instrument_position} />
        <Row label="Software version" value={acq.software_version} />
      </Section>
      <Section title="Illumination & environment">
        <Row label="Illumination type" value={acq.illumination_type} />
        <Row label="Illumination source" value={acq.illumination_source} />
        <Row label="Illumination notes" value={acq.illumination_notes} />
        <Row label="Temperature" value={acq.temperature != null ? `${fmtNum(acq.temperature)} °C` : undefined} />
        <Row label="Distance to object" value={acq.distance_to_object != null ? fmtNum(acq.distance_to_object) : undefined} />
        <Row label="Scan duration" value={acq.scan_duration != null ? `${fmtNum(acq.scan_duration)} s` : undefined} />
      </Section>
      <Section title="Calibration & references">
        <Row label="Dark reference" value={fmtBool(acq.dark_reference)} />
        <Row label="White reference" value={fmtBool(acq.white_reference)} />
        <Row label="Calibration ref" value={acq.calibration_ref} />
        <Row label="EXIF available" value={fmtBool(acq.exif_available)} />
        <Row label="ENVI available" value={fmtBool(acq.envi_available)} />
      </Section>
      {(acq.preprocessing_notes || acq.notes || hasSettings) && (
        <Section title="Processing & notes">
          <Row label="Preprocessing" value={acq.preprocessing_notes} />
          <Row label="Notes" value={acq.notes} />
          {hasSettings && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ color: 'var(--muted, #aab3c0)', marginBottom: '0.35rem' }}>Instrument settings</div>
              <pre
                style={{
                  margin: 0,
                  maxHeight: '10rem',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '0.75rem',
                  lineHeight: 1.5,
                  color: 'var(--ink, #e8edf5)',
                  background: 'var(--bg, #0f1115)',
                  border: '1px solid var(--border, #1f2633)',
                  borderRadius: '8px',
                  padding: '0.5rem 0.6rem',
                }}
              >
                {JSON.stringify(acq.instrument_settings, null, 2)}
              </pre>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

const tabButtonStyle = (active: boolean): React.CSSProperties => ({
  padding: '0.45rem 0.9rem',
  border: 'none',
  borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
  background: 'transparent',
  color: active ? 'var(--ink, #e8edf5)' : 'var(--muted, #aab3c0)',
  fontSize: '0.85rem',
  fontWeight: active ? 600 : 500,
  cursor: 'pointer',
})

// ---- main component -----------------------------------------------------------------------

const DatasetInfo: React.FC = () => {
  const { dataset } = useApp()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'primary' | 'acquisition'>('primary')
  const [meta, setMeta] = useState<HsiCubeMeta | null>(null)
  const [dbMeta, setDbMeta] = useState<DatasetDbMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isHsi = dataset?.type === 'hsi'

  // On open, fetch the DB metadata (acquisition + import row) always, plus the ENVI header for HSI.
  useEffect(() => {
    if (!isOpen || !dataset) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setMeta(null)
    setDbMeta(null)
    setActiveTab('primary')

    const tasks: Promise<unknown>[] = [
      getDatasetDbMeta(dataset.id)
        .then((d) => { if (!cancelled) setDbMeta(d) })
        .catch(() => { if (!cancelled) setDbMeta(null) }),
    ]
    if (isHsi) {
      tasks.push(
        getDatasetMetadata(dataset.id)
          .then((m) => { if (!cancelled) setMeta(m) })
          .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load metadata') }),
      )
    }
    Promise.allSettled(tasks).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, dataset, isHsi])

  if (!dataset) {
    return <div style={{ padding: '0.5rem 0', color: 'var(--muted, #aab3c0)' }}>No dataset selected.</div>
  }

  // Compact at-a-glance summary, built from the dataset already in context (no extra fetch).
  // The full ENVI metadata lives behind the info icon (the modal below). The leading chip is
  // the dataset type; the rest are dimensions and (for HSI) band count + spectral range.
  const wl = dataset.wavelengths_nm
  const typeLabel = dataset.type === 'hsi' ? 'HSI' : dataset.type.toUpperCase()
  const summaryItems: Chip[] = [{ label: typeLabel, variant: 'accent' }]
  if (isHsi) {
    summaryItems.push({ label: hsiProcessingLevel(dataset.name, dataset.path), variant: 'accent-soft' })
  }
  summaryItems.push({
    label: `${dataset.width.toLocaleString()} × ${dataset.height.toLocaleString()} px`,
    variant: 'muted',
  })
  if (isHsi && wl && wl.length) {
    summaryItems.push({ label: `${wl.length} bands`, variant: 'muted' })
    summaryItems.push({ label: `${Math.round(Math.min(...wl))}–${Math.round(Math.max(...wl))} nm`, variant: 'muted' })
  }

  return (
    <div style={{ padding: '0.75rem 0.75rem 1rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border, #1f2633)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dataset.name}
        </h2>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          title="Dataset information"
          aria-label="Dataset information"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.9rem',
            height: '1.9rem',
            borderRadius: '8px',
            border: '1px solid var(--border, #1f2633)',
            background: 'transparent',
            color: 'var(--ink, #e8edf5)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <InfoIcon />
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.6rem' }}>
        {summaryItems.map((chip) => (
          <span key={chip.label} style={CHIP_STYLES[chip.variant]}>
            {chip.label}
          </span>
        ))}
      </div>

      <InfoModal
        isOpen={isOpen}
        title={dataset.name}
        onClose={() => setIsOpen(false)}
        panelStyle={{
          background: 'var(--panel, #141a22)',
          color: 'var(--ink, #e8edf5)',
          maxWidth: '640px',
          border: '1px solid var(--border, #1f2633)',
        }}
      >
        <div style={{ fontSize: '0.85rem' }}>
          {/* Chip row: type + path — always available from the dataset list */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span
              style={{
                padding: '0.15rem 0.55rem',
                borderRadius: '999px',
                background: '#1d4ed833',
                border: '1px solid #3b82f6',
                color: '#93c5fd',
                fontSize: '0.72rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {dataset.type}
            </span>
            <span style={{ color: 'var(--muted, #aab3c0)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>
              {dataset.path}
            </span>
          </div>

          {/* Tab bar: HSI → Cube metadata | Acquisition; visual → General data | Acquisition */}
          <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border, #1f2633)', marginBottom: '0.9rem' }}>
            <button type="button" style={tabButtonStyle(activeTab === 'primary')} onClick={() => setActiveTab('primary')}>
              {isHsi ? 'Cube metadata' : 'General data'}
            </button>
            <button type="button" style={tabButtonStyle(activeTab === 'acquisition')} onClick={() => setActiveTab('acquisition')}>
              Acquisition
            </button>
          </div>

          {activeTab === 'primary'
            ? isHsi
              ? <CubeMetaView meta={meta} loading={loading} error={error} />
              : <GeneralDataView dataset={dataset} ext={dbMeta?.external ?? null} />
            : loading
              ? <div style={{ padding: '1.5rem 0', textAlign: 'center', color: 'var(--muted, #aab3c0)' }}>Loading metadata…</div>
              : <AcquisitionView acq={dbMeta?.acquisition ?? null} />}
        </div>
      </InfoModal>
    </div>
  )
}

export default DatasetInfo

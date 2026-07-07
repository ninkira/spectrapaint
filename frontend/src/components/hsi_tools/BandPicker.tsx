import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../state/AppContext'

const DEBOUNCE_MS = 400

export default function BandPicker() {
  const { rgbBands, setRgbBands, dataset } = useApp()
  const [local, setLocal] = useState(rgbBands)
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

  // A cube whose header omits wavelengths can't map nm -> band. The backend then renders a
  // false-colour composite of evenly-spaced bands, and this nm selector has no effect.
  const hasWavelengths = !!(dataset?.wavelengths_nm && dataset.wavelengths_nm.length)

  // Sync local state when context changes externally
  useEffect(() => { setLocal(rgbBands) }, [rgbBands])

  const update = (next: { r: number; g: number; b: number }) => {
    setLocal(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setRgbBands(next.r, next.g, next.b)
    }, DEBOUNCE_MS)
  }

  return (
    <div className="band-picker">
      <h3>Band Selection</h3>

      {!hasWavelengths && (
        <div
          role="note"
          style={{
            display: 'flex',
            gap: '0.5rem',
            fontSize: '0.78rem',
            lineHeight: 1.4,
            color: '#fcd34d',
            background: '#78350f22',
            border: '1px solid #b45309',
            borderRadius: 8,
            padding: '0.5rem 0.6rem',
            margin: '0.4rem 0 0.6rem',
          }}
        >
          <span aria-hidden="true">⚠</span>
          <span>
            This cube has no wavelength metadata, so it&apos;s shown as a false-colour composite of
            evenly-spaced bands. The R/G/B nanometre values below don&apos;t map to specific
            wavelengths and have no effect.
          </span>
        </div>
      )}

      <label style={hasWavelengths ? undefined : { opacity: 0.5 }}>
        R:
        <input
          type="number"
          value={local.r}
          disabled={!hasWavelengths}
          onChange={(e) => update({ ...local, r: +e.target.value })}
        />
      </label>
      <label style={hasWavelengths ? undefined : { opacity: 0.5 }}>
        G
        <input
          type="number"
          value={local.g}
          disabled={!hasWavelengths}
          onChange={(e) => update({ ...local, g: +e.target.value })}
        />
      </label>
      <label style={hasWavelengths ? undefined : { opacity: 0.5 }}>
        B:
        <input
          type="number"
          value={local.b}
          disabled={!hasWavelengths}
          onChange={(e) => update({ ...local, b: +e.target.value })}
        />
      </label>

    </div>
  )
}

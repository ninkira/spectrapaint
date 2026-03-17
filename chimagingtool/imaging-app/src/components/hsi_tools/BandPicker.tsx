import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../state/AppContext'

const DEBOUNCE_MS = 400

export default function BandPicker() {
  const { rgbBands, setRgbBands } = useApp()
  const [local, setLocal] = useState(rgbBands)
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

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
      <label>
        R:
        <input
          type="number"
          value={local.r}
          onChange={(e) => update({ ...local, r: +e.target.value })}
        />
      </label>
      <label>
        G
        <input
          type="number"
          value={local.g}
          onChange={(e) => update({ ...local, g: +e.target.value })}
        />
      </label>
      <label>
        B:
        <input
          type="number"
          value={local.b}
          onChange={(e) => update({ ...local, b: +e.target.value })}
        />
      </label>

    </div>
  )
}

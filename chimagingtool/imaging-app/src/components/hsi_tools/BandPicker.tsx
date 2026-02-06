import { useApp } from '../../state/AppContext'

export default function BandPicker() {
  const { rgbBands, setRgbBands } = useApp()

  return (
    <div className="band-picker">
      <h3>Band Selection</h3>
      <label>
        R:
        <input
          type="number"
          value={rgbBands.r}
          onChange={(e) => setRgbBands(+e.target.value, rgbBands.g, rgbBands.b)}
        />
      </label>
      <label>
        G
        <input
          type="number"
          value={rgbBands.g}
          onChange={(e) => setRgbBands(rgbBands.r, +e.target.value, rgbBands.b)}
        />
      </label>
      <label>
        B:
        <input
          type="number"
          value={rgbBands.b}
          onChange={(e) => setRgbBands(rgbBands.r, rgbBands.g, +e.target.value)}
        />
      </label>
      
    </div>
  )
}

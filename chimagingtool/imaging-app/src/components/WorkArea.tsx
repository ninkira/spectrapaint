// WorkArea.tsx
import SpectrumPlot, { type Spectrum } from './HSITool'
import BandPicker from './BandPicker'

export default function WorkArea() {
  const testSpectrum: Spectrum = {
    x: 100,
    y: 50,
    wavelengths_nm: Array.from({ length: 50 }, (_, i) => 400 + i * 8),
    values:       Array.from({ length: 50 }, (_, i) => Math.sin(i / 5) + 2),
  }

  return (
    <section className="work-area" aria-label="Work Area">
      <div className="work-empty">Work Area</div>

      <BandPicker />

      {/* 👇 now we actually pass a spectrum */}
      <SpectrumPlot spectrum={testSpectrum} />
    </section>
  )
}

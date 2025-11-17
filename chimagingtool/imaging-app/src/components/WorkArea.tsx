// ViewerPage.tsx (just an example name)
import { useState } from 'react'
import PrimaryDisplay from './PrimaryDisplay'
import SpectrumPlot, { type Spectrum } from './hsi_tools/SpectrumPlot'
import DatasetList from './ui/DatasetList'

export default function ViewerPage() {
  const [spectrum, setSpectrum] = useState<Spectrum>(null)

  return (
    <div className="viewer-layout">
      {/* left / center: image */}
      <PrimaryDisplay onSpectrum={setSpectrum} />

      {/* right: work area / tools */}
      <section className="work-area" aria-label="Work Area">
           <DatasetList />
      
        <SpectrumPlot spectrum={spectrum} />
      </section>
    </div>
  )
}
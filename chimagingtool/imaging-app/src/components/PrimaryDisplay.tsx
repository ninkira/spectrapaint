import { useApp } from '../state/AppContext'
import BandPicker from './BandPicker'

export default function PrimaryDisplay() {
  const { layers, rgbImgUrl, dataset } = useApp()
  const show = layers.find(l => l.id === 'rgb')?.on

  return (
    <section className="primary-display" aria-label="Primary Display">
      {show && rgbImgUrl ? (
        <img
          src={rgbImgUrl}
          alt={`RGB composite ${dataset ? `– ${dataset.name}` : ''}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      ) : (
        <div className="placeholder">No layer visible</div>
      )}

      {/* 👇 Add the BandPicker right underneath */}
      <BandPicker />
    </section>
  )
}

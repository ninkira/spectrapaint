export default function Toolbar() {
  return (
    <header className="toolbar">
      <div className="title">Projects ▸ The Old Man in Warnemünde</div>
      <div className="tools">
        <button aria-label="Open">📂</button>
        <button aria-label="Save">💾</button>
        <span className="divider" />
        <button aria-label="Zoom In">＋</button>
        <button aria-label="Zoom Out">－</button>
        <button aria-label="Fit">⤢</button>
        <span className="divider" />
        <button aria-label="Brush">🖌️</button>
        <button aria-label="Select">🖱️</button>
        <button aria-label="Measure">📏</button>
      </div>
    </header>
  )
}

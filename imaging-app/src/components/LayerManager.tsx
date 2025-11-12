import { useApp } from '../state/AppContext'

export default function LayerManager() {
  const { layers, toggleLayer } = useApp()

  return (
    <aside className="layer-manager">
      <div className="lm-header">
        <span>Layer Manager</span>
        <div className="lm-actions">
          <button title="New layer">＋</button>
          <button title="Group">🗃️</button>
          <button title="Delete">🗑️</button>
        </div>
      </div>

      <div className="lm-list" role="tree">
        {layers.map(l => (
          <label key={l.id} className="lm-item" role="treeitem">
            <input
              type="checkbox"
              checked={l.on}
              onChange={() => toggleLayer(l.id)}
            />
            <span className="lm-name">{l.name}</span>
          </label>
        ))}
      </div>
    </aside>
  )
}

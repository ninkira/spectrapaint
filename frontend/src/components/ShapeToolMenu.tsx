import React, { useState } from 'react'
import { useApp } from '../state/AppContext'
import { SquareDashed, Circle, Waypoints } from 'lucide-react'

type ShapeMode = 'rect' | 'ellipse' | 'polygon' | 'line'

const ShapeToolMenu: React.FC = () => {
  const { selectionMode, setSelectionMode, setNavigationMode } = useApp()

  // preview icon state — default rectangle
  const [currentShape, setCurrentShape] = useState<ShapeMode>('rect')
  const [open, setOpen] = useState(false)

  // The trigger stands for whichever shape mode is live, so it has to show the on state too.
  const shapeActive =
    selectionMode === 'rect' || selectionMode === 'ellipse' ||
    selectionMode === 'polygon' || selectionMode === 'line'

  const handleSelect = (mode: ShapeMode) => {
    setCurrentShape(mode)    // change preview icon
    setNavigationMode(false)
    setSelectionMode(selectionMode === mode ? null : mode)
    setOpen(false)
  }

  return (
    <div className="shape-tool">
      {/* Trigger shows the currently selected shape */}
      <button
        aria-label="Shape selection"
        aria-pressed={shapeActive}
        aria-expanded={open}
        className={`toolbar-btn shape-tool-trigger${shapeActive ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        {currentShape === 'rect' && (
          <SquareDashed size={20} strokeWidth={1.75} />
        )}
        {currentShape === 'ellipse' && (
          <Circle size={20} />
        )}
        {currentShape === 'polygon' && (
          <Waypoints size={20} />
        )}
        {currentShape === 'line' && (
          <Waypoints size={20} />
        )}
      </button>

      {open && (
        <div className="shape-tool-menu">
          <button
            className={`shape-tool-item${selectionMode === 'rect' ? ' active' : ''}`}
            aria-pressed={selectionMode === 'rect'}
            onClick={() => handleSelect('rect')}
          >
            <SquareDashed size={16} />
            <span>Rectangle</span>
          </button>

          <button
            className={`shape-tool-item${selectionMode === 'ellipse' ? ' active' : ''}`}
            aria-pressed={selectionMode === 'ellipse'}
            onClick={() => handleSelect('ellipse')}
          >
            <Circle size={16} />
            <span>Ellipse</span>
          </button>

          <button
            className={`shape-tool-item${selectionMode === 'polygon' ? ' active' : ''}`}
            aria-pressed={selectionMode === 'polygon'}
            onClick={() => handleSelect('polygon')}
          >
            <Waypoints size={16} />
            <span>Polygon (area)</span>
          </button>

          <button
            className={`shape-tool-item${selectionMode === 'line' ? ' active' : ''}`}
            aria-pressed={selectionMode === 'line'}
            onClick={() => handleSelect('line')}
          >
            <Waypoints size={16} />
            <span>Polyline (edge only)</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default ShapeToolMenu

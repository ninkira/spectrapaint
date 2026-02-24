import React, { useState } from 'react'
import { useApp } from '../state/AppContext'
import { SquareDashed, Circle, Waypoints } from 'lucide-react'

type ShapeMode = 'rect' | 'ellipse' | 'line'

const ICON_COLOR = '#e8edf5' // same as --ink

const ShapeToolMenu: React.FC = () => {
  const { selectionMode, setSelectionMode, setNavigationMode } = useApp()

  // preview icon state — default rectangle
  const [currentShape, setCurrentShape] = useState<ShapeMode>('rect')
  const [open, setOpen] = useState(false)

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
        className="toolbar-btn shape-tool-trigger"
        onClick={() => setOpen(o => !o)}
      >
        {currentShape === 'rect' && (
         <SquareDashed
         size={20}
         stroke="#e8edf5"
         strokeWidth={1.75}
       />
        )}
        {currentShape === 'ellipse' && (
          <Circle size={20} color={ICON_COLOR} />
        )}
        {currentShape === 'line' && (
          <Waypoints size={20} color={ICON_COLOR} />
        )}
      </button>

      {open && (
        <div className="shape-tool-menu">
          <button
            className="shape-tool-item"
            onClick={() => handleSelect('rect')}
          >
            <SquareDashed size={16} color={ICON_COLOR} />
            <span>Rectangle</span>
          </button>

          <button
            className="shape-tool-item"
            onClick={() => handleSelect('ellipse')}
          >
            <Circle size={16} color={ICON_COLOR} />
            <span>Ellipse</span>
          </button>

          <button
            className="shape-tool-item"
            onClick={() => handleSelect('line')}
          >
            <Waypoints size={16} color={ICON_COLOR} />
            <span>Polyline</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default ShapeToolMenu

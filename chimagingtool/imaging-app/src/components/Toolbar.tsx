import {
  Images,
  Search,
  ChartLine,
  Navigation,
  WandSparkles,
  Save,
  MessageCircle,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  SquareDashed,
  MapPinPlus,
  WaypointsIcon,
} from "lucide-react";

import { useApp } from "../state/AppContext";
import ShapeToolMenu from './ShapeToolMenu'


export default function Toolbar() {

  const {
    selectionMode,
    setSelectionMode,
    navigationMode,
    setNavigationMode,
    showSignalProcessing,
    setShowSignalProcessing,
    zoomIn,
    zoomOut,
    resetView,
  } = useApp();

  const toggleSignalProcessing = () => {
    setShowSignalProcessing(!showSignalProcessing)
  }

  const toggleAnnotationMode = (
    mode: 'multiple' | 'rect' | 'ellipse' | 'line' | 'polygon',
  ) => {
    setNavigationMode(false)
    setSelectionMode(selectionMode === mode ? null : mode)
  }

  return (
    <header className="toolbar">
      <div className="title">Projects ▸ The Old Man in Warnemünde</div>

      <div className="tools">
        <button aria-label="Open"><Images size={20} /></button>
        <button aria-label="Search"><Search size={20} /></button>

        <span className="divider" />

        <button
          aria-label="Navigate"
          className={navigationMode ? "active" : ""}
          onClick={() => {
            const next = !navigationMode
            setNavigationMode(next)
            if (next) setSelectionMode(null)
          }}
        >
          <Navigation size={20} />
        </button>
        <button aria-label="Rotate Left"><RotateCcw size={20} /></button>

        <button aria-label="Zoom In" onClick={zoomIn}><ZoomIn size={20} /></button>
        <button aria-label="Zoom Out" onClick={zoomOut}><ZoomOut size={20} /></button>

        <span className="divider" />

        {/* ------------------------------- */}
        {/* SINGLE ↔ MULTI pixel selection */}
        {/* ------------------------------- */}
  
        <button
          aria-label="SelectMultiplePoints"
          className={selectionMode === "multiple" ? "active" : ""}
          onClick={() => toggleAnnotationMode("multiple")}
        >
          <MapPinPlus size={20} />
        </button>

         <ShapeToolMenu />


        <span className="divider" />

        <button aria-label="MagicWand"><WandSparkles size={20} /></button>

        <button
          aria-label="SignalProcessing"
          className={showSignalProcessing ? "active" : ""}
          onClick={toggleSignalProcessing}
        >
          <ChartLine size={20} />
        </button>

        <span className="divider" />

        <button aria-label="Chat"><MessageCircle size={20} /></button>
        <button aria-label="Reset View" onClick={resetView}><RefreshCw size={20} /></button>
        <button aria-label="Save"><Save size={20} /></button>
      </div>
    </header>
  );
}

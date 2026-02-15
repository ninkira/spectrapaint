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
  SquareDashed,
  MapPin,
  MapPinPlus,
  WaypointsIcon,
} from "lucide-react";

import { useApp } from "../state/AppContext";
import ShapeToolMenu from './ShapeToolMenu'


export default function Toolbar() {

  const {
    selectionMode,
    setSelectionMode,
    showSignalProcessing,
    setShowSignalProcessing,
  } = useApp();

  const openSignalProcessing = () => {
    setShowSignalProcessing(!showSignalProcessing)
  }

  return (
    <header className="toolbar">
      <div className="title">Projects ▸ The Old Man in Warnemünde</div>

      <div className="tools">
        <button aria-label="Open"><Images size={20} /></button>
        <button aria-label="Search"><Search size={20} /></button>

        <span className="divider" />

        <button aria-label="Navigate"><Navigation size={20} /></button>
        <button aria-label="Rotate Left"><RotateCcw size={20} /></button>

        <button aria-label="Zoom In"><ZoomIn size={20} /></button>
        <button aria-label="Zoom Out"><ZoomOut size={20} /></button>

        <span className="divider" />

        {/* ------------------------------- */}
        {/* SINGLE ↔ MULTI pixel selection */}
        {/* ------------------------------- */}

      
        <button
          aria-label="SelectMultiplePoints"
          className={selectionMode === "multiple" ? "active" : ""}
          onClick={() => setSelectionMode("multiple")}
        >
          <MapPinPlus size={20} />
        </button>

         <ShapeToolMenu />


        <span className="divider" />

        <button aria-label="MagicWand"><WandSparkles size={20} /></button>

        <button
          aria-label="SignalProcessing"
          className={showSignalProcessing ? "active" : ""}
          onClick={openSignalProcessing}
        >
          <ChartLine size={20} />
        </button>

        <span className="divider" />

        <button aria-label="Chat"><MessageCircle size={20} /></button>
        <button aria-label="Save"><Save size={20} /></button>
      </div>
    </header>
  );
}

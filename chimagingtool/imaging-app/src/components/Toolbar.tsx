
import { Images, Search, ChartLine, Navigation, WandSparkles, Save, MessageCircle, RotateCcw, ZoomIn, ZoomOut, SquareDashed, MapPin, MapPinPlus, WaypointsIcon} from "lucide-react";


export default function Toolbar() {
  return (
    <header className="toolbar">
      <div className="title">Projects ▸ The Old Man in Warnemünde</div>
      <div className="tools">
        <button aria-label="Open"><Images size={20} /></button>
        <button aria-label="Save"><Search size={20} /></button>
        <span className="divider" />
         <button aria-label="Rotate"><Navigation size={20} /></button>
 <button aria-label="Rotate"><RotateCcw size={20} /></button>

        <button aria-label="Zoom In"><ZoomIn size={20} /></button>
        <button aria-label="Zoom Out"><ZoomOut size={20} /></button>
               <span className="divider" />
        
        <button aria-label="SelectSinglePoint"><MapPin size={20} /></button>
<button aria-label="SelectMultiplePoints"><MapPinPlus size={20} /></button>
<button aria-label="SelectShape"><SquareDashed size={20} /></button>
<button aria-label="SelectLine"><WaypointsIcon size={20} /></button>

   <span className="divider" />
  <button aria-label="Rotate"><WandSparkles size={20} /></button>
 <button aria-label="Rotate"><ChartLine size={20} /></button>
   <span className="divider" />
  <button aria-label="Rotate"><MessageCircle size={20} /></button>
 <button aria-label="Rotate"><Save size={20} /></button>

      </div>
    </header>
  )
}

import React from 'react'
import './App.css'
import { AppProvider, useApp } from './state/AppContext'
import Toolbar from './components/Toolbar'
import ProjectNav from './components/ProjectNav'
import LayerManager from './components/LayerManager'
import PrimaryDisplay from './components/PrimaryDisplay'
import WorkArea from './components/WorkArea'

type Ctx = {
  layers: Layer[]
  toggleLayer: (id: string) => void
  dataset?: DatasetMeta
  datasetId?: string
  setDatasetId: (id: string) => void
  rgbBands: { r: number; g: number; b: number }
  setRgbBands: (r: number, g: number, b: number) => void
  rgbImgUrl?: string

  // 👇 add these two lines:
  primaryWidth: number
  setPrimaryWidth: (v: number) => void
}


function ResizableContent() {
  const { primaryWidth, setPrimaryWidth } = useApp()

  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    const startX = e.clientX
    const startWidth = primaryWidth
    const onMove = (ev: MouseEvent) =>
      setPrimaryWidth(Math.max(360, startWidth + (ev.clientX - startX)))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="content">
      <div className="primary-wrap" style={{ width: `${primaryWidth}px` }}>
     
      </div>
      <div className="resizer" onMouseDown={startDrag} role="separator" aria-orientation="vertical" />
      <WorkArea />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <div className="app">
        <Toolbar />
        <div className="body">
          <ProjectNav />
          <LayerManager />
          <ResizableContent />
        </div>
      </div>
    </AppProvider>
  )
}

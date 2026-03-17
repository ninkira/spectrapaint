import React, { useEffect, useRef } from 'react'
import './App.css'
import { AppProvider, useApp } from './state/AppContext'
import Toolbar from './components/Toolbar'
import ProjectNav from './components/ProjectNav'
import DataManager from './components/LayerManager'
import PrimaryDisplay from './components/PrimaryDisplay'
import WorkArea from './components/WorkArea'


function ResizableContent() {
  const { primaryWidth, setPrimaryWidth } = useApp()
  const cleanupRef = useRef<(() => void) | null>(null)

  // Remove lingering listeners if component unmounts mid-drag
  useEffect(() => () => { cleanupRef.current?.() }, [])

  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    const startX = e.clientX
    const startWidth = primaryWidth
    const onMove = (ev: MouseEvent) =>
      setPrimaryWidth(Math.max(360, startWidth + (ev.clientX - startX)))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      cleanupRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    cleanupRef.current = onUp
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
          <DataManager />
          <ResizableContent />
        </div>
      </div>
    </AppProvider>
  )
}

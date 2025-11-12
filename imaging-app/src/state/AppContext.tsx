import React, { createContext, useContext, useState } from 'react'
import type { Layer } from './types'

type AppState = {
  layers: Layer[]
  toggleLayer: (id: number) => void
  primaryWidth: number
  setPrimaryWidth: (px: number) => void
}

const AppCtx = createContext<AppState | null>(null)
export const useApp = () => {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used within <AppProvider>')
  return ctx
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [layers, setLayers] = useState<Layer[]>([
    { id: 1, name: 'Hyperspectral Image', on: true },
    { id: 2, name: 'RGB', on: true },
    { id: 3, name: 'False Colour', on: false },
    { id: 4, name: 'PC1', on: true },
    { id: 5, name: 'PC2', on: false },
    { id: 6, name: 'SAM Map', on: true },
  ])
  const toggleLayer = (id: number) => setLayers(ls => ls.map(l => l.id === id ? { ...l, on: !l.on } : l))

  const [primaryWidth, setPrimaryWidth] = useState<number>(520)

  return (
    <AppCtx.Provider value={{ layers, toggleLayer, primaryWidth, setPrimaryWidth }}>
      {children}
    </AppCtx.Provider>
  )
}

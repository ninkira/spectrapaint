// Ambient type declarations for third-party packages that ship without TypeScript types.
// Installing @types/plotly.js + @types/react-plotly.js would give richer typing, but those
// definitions are heavy and very strict; these shims keep the production build clean.
declare module 'plotly.js' {
  export type Data = any
  export type Layout = any
  export type Config = any
}

declare module 'react-plotly.js' {
  import type { ComponentType } from 'react'
  const Plot: ComponentType<any>
  export default Plot
}

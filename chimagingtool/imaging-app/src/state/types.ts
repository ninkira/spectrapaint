export type Layer = {
  id: string
  name: string
  on: boolean
  path?: string
  type?: 'hsi' | 'tiff' | 'png' | 'jpg'
}

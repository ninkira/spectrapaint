export type Point2D = { x:number; y: number}


export type AnnotationBase = {
  id: string
  datasetId: string
  createdAt: string
  updatedAt?: string
  label?: string
  color?: string
  kind: 'probe' | 'roi'
  groupId?: string
}

export type RectAnn = AnnotationBase & {
    kind: 'roi'
    type: 'rect'
    geometry: {x: number; y: number; w: number; h: number}
}


export type PolygonAnn = AnnotationBase & {
    kind: 'roi'
    type: 'polygon'
    geometry: {points: Point2D[]}
}

export type EllipseAnn = AnnotationBase & {
  kind: 'roi'
  type: 'ellipse'
   geometry: {
    cx: number
    cy: number
    rx: number
    ry: number
    rotation?: number
  }
}

export type LineAnn = AnnotationBase & {
    kind: 'roi'
    type: 'line'
    geometry: {points: Point2D[]}
}

export type PointAnn = AnnotationBase & {
  kind: 'probe'
  type: 'point'
  geometry: { x: number; y: number }
}


export type Annotation =
  | PointAnn
  | RectAnn
  | EllipseAnn
  | LineAnn
  | PolygonAnn
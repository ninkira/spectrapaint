export type Point2D = { x:number, y: number}


export type AnnotationBase = {
  id: string
  datasetId: string
  createdAt: string
  updatedAt?: string
  label?: string
  color?: string
}

export type RectAnn = AnnotationBase & {
    type: 'rect'
    geometry: {x: number; y: number; w: number; h: number}
}


export type PolygonAnn = AnnotationBase & {
    type: 'polygon'
    geometry: {points: Point2D[]}
}

export type EllipseAnn = AnnotationBase & {
    type: 'ellipse'
    cx: number       // center x
    cy: number       // center y
    rx: number       // radius in x direction
    ry: number       // radius in y direction
    rotation?: number // radians, optional
}

export type LineAnn = AnnotationBase & {
    type: 'line'
    geometry: {points: Point2D[]}
}

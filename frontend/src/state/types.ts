/** Zoom limits, shared by the context and the display so they cannot drift apart.
 *
 *  The upper bound has to be generous enough to reach individual pixels: a 1300-wide cube shown
 *  in a ~500px panel starts at roughly 0.38 screen pixels per image pixel, so even 8x leaves a
 *  pixel smaller than 3 screen pixels — too small to aim at or to draw a grid over. */
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 32

export type Layer = {
  id: string
  name: string
  on: boolean
  path?: string
  type?: 'hsi' | 'tiff' | 'png' | 'jpg'
  /** The physical object this depicts — what groups it with the rest of that object's data. */
  objectId?: string | null
  objectTitle?: string | null
  /** The dataset this was computed from, e.g. the radiance scan behind a reflectance cube. */
  derivedFrom?: string | null
  processingLevel?: string | null
}

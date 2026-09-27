/** Keep trackpad pinch / Ctrl+wheel on the map from zooming the browser page.
 * Let the event continue to the renderer so its camera still handles the zoom.
 */
export function attachMapZoomGuard(surface: HTMLElement): () => void {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) event.preventDefault()
  }
  surface.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => surface.removeEventListener('wheel', onWheel, { capture: true })
}

import type { Map as LibreMap } from 'maplibre-gl'

/**
 * MapLibre rotates on Ctrl+drag (or right-drag). On Mac, 3-finger drag is a
 * left-button mouse event, so ⌘ (metaKey) + drag should rotate the same way.
 */
export function attachCmdDragRotate(map: LibreMap): () => void {
  const el = map.getCanvasContainer()
  let active = false
  let lastX = 0
  let lastY = 0

  const down = (e: MouseEvent) => {
    if (e.button !== 0 || !e.metaKey || e.ctrlKey) return
    active = true
    lastX = e.clientX
    lastY = e.clientY
    map.dragPan.disable()
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  const move = (e: MouseEvent) => {
    if (!active) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    map.setBearing(map.getBearing() - dx * 0.8)
    map.setPitch(Math.max(0, Math.min(85, map.getPitch() - dy * 0.5)))
  }

  const up = () => {
    if (!active) return
    active = false
    map.dragPan.enable()
  }

  el.addEventListener('mousedown', down, true)
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
  return () => {
    el.removeEventListener('mousedown', down, true)
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    if (active) map.dragPan.enable()
  }
}

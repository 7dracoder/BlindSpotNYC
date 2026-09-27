import test from 'node:test'
import assert from 'node:assert/strict'
import { attachMapZoomGuard } from '../src/lib/mapGestures.ts'

test('map pinch cancels page zoom while still reaching the renderer; cleanup restores defaults', () => {
  const surface = new EventTarget()
  const detach = attachMapZoomGuard(surface)
  let delivered = 0
  surface.addEventListener('wheel', () => delivered++)
  const wheel = (ctrlKey) => {
    const event = new Event('wheel', { cancelable: true })
    Object.defineProperty(event, 'ctrlKey', { value: ctrlKey })
    surface.dispatchEvent(event)
    return event
  }
  assert.equal(wheel(true).defaultPrevented, true)
  assert.equal(wheel(false).defaultPrevented, false)
  assert.equal(delivered, 2)
  detach()
  assert.equal(wheel(true).defaultPrevented, false)
})

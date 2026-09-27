import assert from 'node:assert/strict'
import test from 'node:test'
import { xrayDots } from '../src/lib/xray.ts'

const uShape = [[0, 0], [12, 0], [12, 12], [8, 12], [8, 4], [4, 4], [4, 12], [0, 12], [0, 0]]
const thinL = [[0, 0], [12, 0], [12, 0.02], [0.02, 0.02], [0.02, 12], [0, 12], [0, 0]]
const building = (footprint) => ({
  bin: '2015820', height_m: 32, footprint,
  violations: [{ id: 'fire-1', fire: true, story: '3' }],
  complaints: [
    ...Array.from({ length: 60 }, (_, i) => ({ id: `heat-${i}`, kind: 'heat' })),
    ...Array.from({ length: 60 }, (_, i) => ({ id: `flood-${i}`, kind: 'flood' })),
  ],
})

test('markers stay inside a concave footprint and out of its courtyard', () => {
  for (const { position: [x, y] } of xrayDots(building(uShape))) {
    assert.ok(x >= 0 && x <= 12 && y >= 0 && y <= 12)
    assert.ok(x <= 4 || x >= 8 || y <= 4, `marker fell in courtyard at ${x}, ${y}`)
  }
})

test('sampling fallback stays inside a very narrow footprint', () => {
  for (const { position: [x, y] } of xrayDots(building(thinL))) {
    assert.ok(x >= 0 && x <= 12 && y >= 0 && y <= 12)
    assert.ok(x <= 0.02 || y <= 0.02, `marker fell outside L-shaped building at ${x}, ${y}`)
  }
})

test('roof-relative Google markers preserve floor heights and geographic positions', () => {
  const b = building(uShape)
  const ground = xrayDots(b)
  const roof = xrayDots(b, 'roof')
  assert.equal(ground[0].position[2], 8)
  assert.equal(roof[0].position[2], -24)
  ground.forEach((dot, i) => {
    assert.deepEqual(roof[i].position.slice(0, 2), dot.position.slice(0, 2))
    assert.equal(roof[i].item, dot.item)
    assert.ok(Math.abs(roof[i].position[2] + 32 - dot.position[2]) < 1e-12)
  })
  assert.deepEqual(xrayDots(b), ground, 'placement should stay deterministic')
})

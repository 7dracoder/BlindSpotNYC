import type { Building, Complaint, Violation } from '../types'

export type Dot = {
  kind: 'fire' | 'flood' | 'heat'
  position: [number, number, number]
  item: Violation | Complaint
}

const MAX_PER_KIND = 60

// Deterministic, so dots don't jump around on re-render
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function inside([x, y]: [number, number], ring: [number, number][]): boolean {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

export function centroid(ring: [number, number][]): [number, number] {
  const pts = ring.slice(0, -1)
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
}

export function scaleRing(ring: [number, number][], factor: number): [number, number][] {
  const [cx, cy] = centroid(ring)
  return ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor])
}

function sampler(ring: [number, number][], seed: number) {
  // Sample within a slightly shrunken outline so dots never sit on a wall
  const inner = scaleRing(ring, 0.82)
  const xs = inner.map((p) => p[0])
  const ys = inner.map((p) => p[1])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const rand = rng(seed)
  const fallback = centroid(ring)
  return (): [number, number] => {
    for (let tries = 0; tries < 40; tries++) {
      const p: [number, number] = [minX + rand() * (maxX - minX), minY + rand() * (maxY - minY)]
      if (inside(p, inner)) return p
    }
    return fallback
  }
}

export function xrayDots(b: Building): Dot[] {
  const height = Math.max(b.height_m ?? 12, 4)
  const floors = Math.max(1, Math.round(height / 3.2))
  const floorHeight = height / floors
  const atFloor = (floor: number) => (Math.min(Math.max(floor, 1), floors) - 0.5) * floorHeight
  const seed = Number(b.bin) || 1
  const point = sampler(b.footprint, seed)
  const rand = rng(seed * 7 + 3)

  const fire = b.violations.filter((v) => v.fire).slice(0, MAX_PER_KIND)
  const heat = b.complaints.filter((c) => c.kind === 'heat').slice(0, MAX_PER_KIND)
  const flood = b.complaints.filter((c) => c.kind === 'flood').slice(0, MAX_PER_KIND)

  return [
    // HPD records the floor ("story") where the inspector found the condition
    ...fire.map((v) => {
      const story = parseInt(v.story ?? '', 10)
      return { kind: 'fire' as const, item: v, position: [...point(), atFloor(story || 1 + Math.floor(rand() * floors))] as Dot['position'] }
    }),
    ...heat.map((c) => ({
      kind: 'heat' as const,
      item: c,
      position: [...point(), atFloor(1 + Math.floor(rand() * floors))] as Dot['position'],
    })),
    // Sewer backups and clogged basins show up at the bottom of the building
    ...flood.map((c) => ({ kind: 'flood' as const, item: c, position: [...point(), 0.6 + rand() * 1.4] as Dot['position'] })),
  ]
}

import { useEffect, useRef, useState } from 'react'
import { Deck, FlyToInterpolator, MapView } from '@deck.gl/core'
import { GeoJsonLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { Tile3DLayer } from '@deck.gl/geo-layers'
import { Tiles3DLoader } from '@loaders.gl/3d-tiles'
import type { PickingInfo } from '@deck.gl/core'
import { createGoogleTileFetch } from '../lib/googleTiles'
import { centroid, scaleRing, xrayDots, type Dot } from '../lib/xray'
import type { Building, Complaint, NearbyBuilding, Violation } from '../types'
import { INITIAL_VIEW } from '../data/goldenPath'
import { AREA_LAYERS, areaUrl } from '../data/mapLayers'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
const TILE_HOST = 'https://tile.googleapis.com'
const TILES = KEY ? (import.meta.env.DEV ? '/v1/3dtiles/root.json' : `${TILE_HOST}/v1/3dtiles/root.json`) : ''

const DOT_COLOR = { fire: [239, 68, 68, 240], heat: [80, 160, 235, 230], flood: [56, 120, 220, 235] } as const
const RISK_RGB = { LOW: [132, 204, 22], MODERATE: [245, 158, 11], HIGH: [239, 68, 68] } as const

type Hover =
  | { x: number; y: number; type: 'dot'; dot: Dot }
  | { x: number; y: number; type: 'nearby'; building: NearbyBuilding }

type Props = {
  building: Building | null
  nearby: NearbyBuilding[]
  xray: boolean
  perspective: '2d' | '3d'
  areaLayers: string[]
  onFail: (reason: string) => void
  onPickAt: (lng: number, lat: number) => void
  onPickNearby: (b: NearbyBuilding) => void
}

export function GoogleMap({
  building,
  nearby,
  xray,
  perspective,
  areaLayers,
  onFail,
  onPickAt,
  onPickNearby,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const deckRef = useRef<Deck<MapView> | null>(null)
  const rootTimeout = useRef<number | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [tilesLoaded, setTilesLoaded] = useState(false)
  const [credits, setCredits] = useState('')
  const googleFetch = useRef(createGoogleTileFetch(KEY ?? '', window.location.origin, import.meta.env.DEV,
    (reason) => fail.current(reason)))
  const [hover, setHover] = useState<Hover | null>(null)
  const fail = useRef(onFail)
  fail.current = onFail
  const pickAt = useRef(onPickAt)
  pickAt.current = onPickAt
  const pickNearby = useRef(onPickNearby)
  pickNearby.current = onPickNearby

  useEffect(() => {
    if (!KEY || !container.current) {
      fail.current('Google Maps is not configured.')
      return
    }
    let dead = false
    const el = container.current
    let deck: Deck<MapView>
    try {
      deck = new Deck({
        parent: el,
        width: el.clientWidth || window.innerWidth,
        height: el.clientHeight || window.innerHeight,
        style: { background: '#0b1220', position: 'absolute', inset: '0', width: '100%', height: '100%' },
        views: new MapView({
          nearZMultiplier: 0.1,
          farZMultiplier: 1.5,
          repeat: false,
        }),
        initialViewState: { ...INITIAL_VIEW, maxPitch: 60, minPitch: 0 },
        controller: {
          dragPan: true,
          // ⌘ / Ctrl / Shift + drag (and 3-finger drag while holding ⌘) rotates
          dragRotate: true,
          touchRotate: true,
          trackpadGesture: true,
          touchZoom: true,
          scrollZoom: true,
          doubleClickZoom: true,
          inertia: true,
        },
        getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab'),
        onError: () => {
          if (!dead) fail.current('Google Maps could not be loaded.')
        },
        onClick: (info) => {
          if (info.object) return
          const [lng, lat] = info.coordinate ?? []
          if (lng != null && lat != null) pickAt.current(lng, lat)
        },
      })
    } catch {
      fail.current('Your browser could not start the 3D map.')
      return
    }
    deckRef.current = deck

    const syncSize = () => {
      if (dead || !deckRef.current) return
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0) deckRef.current.setProps({ width: w, height: h })
    }
    syncSize()
    const ro = new ResizeObserver(syncSize)
    ro.observe(el)

    // Let Tile3DLayer load the root once. A separate preflight creates an extra
    // Google session and can succeed even when the actual layer later fails.
    setReady(true)
    const timeout = window.setTimeout(() => {
      if (!dead) fail.current('Google Maps took too long to load. Try Google again in a moment.')
    }, 30_000)
    rootTimeout.current = timeout

    return () => {
      dead = true
      window.clearTimeout(timeout)
      ro.disconnect()
      deck.finalize()
      deckRef.current = null
      setReady(false)
      setTilesLoaded(false)
    }
  }, [])

  useEffect(() => {
    const deck = deckRef.current
    if (!ready || !deck || !building) return
    const [lng, lat] = centroid(building.footprint)
    deck.setProps({
      initialViewState: {
        longitude: lng,
        latitude: lat,
        zoom: 17.6,
        pitch: perspective === '3d' ? 48 : 0,
        bearing: -30,
        maxPitch: 60,
        minPitch: 0,
        transitionDuration: 3000,
        transitionInterpolator: new FlyToInterpolator(),
      },
    })
  }, [ready, building, perspective])

  useEffect(() => {
    const deck = deckRef.current
    if (!ready || !deck || building) return
    deck.setProps({
      initialViewState: {
        ...INITIAL_VIEW,
        pitch: perspective === '3d' ? Math.min(INITIAL_VIEW.pitch, 48) : 0,
        maxPitch: 55,
        minPitch: 0,
        transitionDuration: 600,
        transitionInterpolator: new FlyToInterpolator(),
      },
    })
  }, [ready, perspective, building])

  useEffect(() => {
    const deck = deckRef.current
    if (!ready || !deck) return
    const shed = building?.shed.active ? [scaleRing(building.footprint, 1.12)] : []
    deck.setProps({
      layers: [
        new Tile3DLayer({
          id: 'google-3d',
          data: TILES,
          loader: Tiles3DLoader,
          loadOptions: {
            fetch: googleFetch.current,
            tileset: {
              maximumScreenSpaceError: 16,
              maximumMemoryUsage: 512,
              onTraversalComplete: (tiles: { content?: { gltf?: { asset?: { copyright?: string } } } }[]) => {
                const unique = new Set<string>()
                for (const tile of tiles) {
                  for (const credit of tile.content?.gltf?.asset?.copyright?.split(';') ?? []) {
                    if (credit.trim()) unique.add(credit.trim())
                  }
                }
                setCredits([...unique].join('; '))
                // Retain parent meshes while detail streams in to avoid holes.
                return tiles
              },
            },
          },
          onTileLoad: () => {
            window.clearTimeout(rootTimeout.current)
            setTilesLoaded(true)
          },
          onTileError: (_tile, url, message) => {
            if (/403|401|429|denied|forbidden/i.test(`${message} ${url}`)) fail.current('Google Maps is temporarily unavailable.')
          },
        }),
        ...AREA_LAYERS.filter((l) => areaLayers.includes(l.id)).map(
          (l) =>
            new GeoJsonLayer({
              id: `area-${l.id}`,
              data: areaUrl(l.id),
              filled: true,
              stroked: false,
              getFillColor: hex(l.color, l.id === 'evacuation-zones' ? 70 : 80),
            }),
        ),
        new PolygonLayer<[number, number][]>({
          id: 'shed',
          data: shed,
          getPolygon: (d) => d,
          extruded: true,
          getElevation: 4,
          getFillColor: [234, 88, 12, 210],
        }),
        new ScatterplotLayer<NearbyBuilding>({
          id: 'scanned',
          data: nearby.filter((n) => n.bin !== building?.bin),
          getPosition: (d) => d.location.coordinates,
          getFillColor: (d) => [...RISK_RGB[d.risk_label], 230],
          getLineColor: [15, 14, 12, 255],
          stroked: true,
          lineWidthMinPixels: 1.5,
          radiusUnits: 'pixels',
          getRadius: 7,
          pickable: true,
          onClick: ({ object }) => object && pickNearby.current(object),
          onHover: ({ object, x, y }: PickingInfo<NearbyBuilding>) =>
            setHover(object ? { type: 'nearby', building: object, x, y } : null),
        }),
        new ScatterplotLayer<Dot>({
          id: 'xray',
          data: building && xray ? xrayDots(building) : [],
          getPosition: (d) => d.position,
          getFillColor: (d) => [...DOT_COLOR[d.kind]],
          getLineColor: [255, 255, 255, 190],
          stroked: true,
          lineWidthMinPixels: 1,
          radiusUnits: 'pixels',
          getRadius: 4.5,
          billboard: true,
          pickable: true,
          onHover: ({ object, x, y }: PickingInfo<Dot>) => setHover(object ? { type: 'dot', dot: object, x, y } : null),
        }),
      ],
    })
  }, [ready, building, nearby, xray, areaLayers])

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0b1220]">
      <div ref={container} className="absolute inset-0 overflow-hidden" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-[#0b1220]" />
      {!tilesLoaded && <div role="status" className="absolute left-1/2 top-1/2 -translate-x-1/2 rounded-md bg-[#141210]/90 px-4 py-3 text-sm text-[#ece6da]">Loading Google 3D map…</div>}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-[#0b1220]/90 px-3 py-1 text-[10px] text-white">
        <span className="shrink-0 text-xs font-semibold">Google Maps</span>
        <span>{credits}</span>
        <a href="https://www.google.com/help/terms_maps/" target="_blank" rel="noreferrer" className="ml-auto shrink-0 underline">Map terms</a>
      </div>
      {hover && <Tooltip hover={hover} />}
    </div>
  )
}

function hex(color: string, alpha: number): [number, number, number, number] {
  const n = parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha]
}

function Tooltip({ hover }: { hover: Hover }) {
  let title: string
  let lines: string[]
  if (hover.type === 'nearby') {
    title = `${hover.building.risk_label} · ${hover.building.hazard_score}/100`
    lines = [hover.building.address, 'Click to open']
  } else if (hover.dot.kind === 'fire') {
    const v = hover.dot.item as Violation
    title = `Fire / egress · ${v.source}${v.class ? ` class ${v.class}` : ''}`
    lines = [v.description, [v.story && `Floor ${v.story}`, v.apartment && `Apt ${v.apartment}`, v.date].filter(Boolean).join(' · ')]
  } else {
    const c = hover.dot.item as Complaint
    title = `311 · ${c.kind === 'heat' ? 'Heat / hot water' : 'Sewer / flooding'}`
    lines = [c.descriptor, `${c.date} · ${c.status}`]
  }
  return (
    <div
      className="pointer-events-none absolute z-30 max-w-[300px] rounded-md border border-white/10 bg-[#141210]/95 px-3 py-2 text-[12px] leading-snug text-[#ece6da] shadow-xl"
      style={{ left: hover.x + 14, top: hover.y + 14 }}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#f59e0b]">{title}</div>
      {lines.filter(Boolean).map((l) => (
        <div key={l} className="text-[#cfc7b8]">
          {l.length > 220 ? `${l.slice(0, 220)}…` : l}
        </div>
      ))}
    </div>
  )
}

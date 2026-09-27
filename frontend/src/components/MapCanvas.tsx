import { attachMapZoomGuard } from '../lib/mapGestures'
import { useEffect, useRef, useState } from 'react'
import { createMap, tileKeys, type BlocklightMap, type Theme } from 'blocklight'
import 'blocklight/style.css'
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import type { PickingInfo } from '@deck.gl/core'
import { attachCmdDragRotate } from '../lib/cmdRotate'
import { centroid, scaleRing, xrayDots, type Dot } from '../lib/xray'
import type { Building, Complaint, NearbyBuilding, Violation } from '../types'
import { INITIAL_VIEW } from '../data/goldenPath'
import { AREA_LAYERS, BUILDING_LAYERS, HEIGHT_DATASET, areaUrl, toDataset } from '../data/mapLayers'

const API = new URL(`${import.meta.env.VITE_API_URL ?? ''}/api/map/`, window.location.origin).href
const STREET_TILE_ZOOM = 15
const DETAIL_ZOOM = 14.5
// Ids Blocklight's building view uses for its layer and MapLibre source
const BUILDING_LAYER = 'buildings'
const BUILDING_SOURCE = 'blocklight-source-buildings'

// Matches the panel: warm dark ground, amber selection
const THEME: Theme = {
  background: '#0f0e0c',
  land: '#1a1815',
  street: '#2c2823',
  boundary: '#4a443b',
  accent: '#d97706',
  ink: '#f3efe6',
  muted: '#8d8579',
  buildingLow: '#2b2722',
  buildingHigh: '#7a7063',
  selection: '#f59e0b',
  sky: '#1a1815',
}

const DOT_COLOR = { fire: [239, 68, 68, 240], heat: [80, 160, 235, 230], flood: [56, 120, 220, 235] } as const
const RISK_RGB = { LOW: [132, 204, 22], MODERATE: [245, 158, 11], HIGH: [239, 68, 68] } as const
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

type Hover =
  | { x: number; y: number; type: 'dot'; dot: Dot }
  | { x: number; y: number; type: 'nearby'; building: NearbyBuilding }

type Props = {
  building: Building | null
  nearby: NearbyBuilding[]
  xray: boolean
  perspective: '2d' | '3d'
  buildingLayer: string | null
  areaLayers: string[]
  onLayerLoading: (loading: boolean) => void
  onPickBuilding: (bin: string, lng: number, lat: number) => void
  onPickNearby: (b: NearbyBuilding) => void
}

function showAreaLayers(map: LibreMap, visible: string[]) {
  for (const layer of AREA_LAYERS) {
    const on = visible.includes(layer.id)
    const id = `bs-${layer.id}`
    if (on && !map.getSource(id)) {
      map.addSource(id, { type: 'geojson', data: areaUrl(layer.id) })
      map.addLayer(
        {
          id,
          type: 'fill',
          source: id,
          paint: {
            'fill-color': layer.color,
            // Evacuation zone 1 floods first; shade it strongest
            'fill-opacity': layer.id === 'evacuation-zones' ? ['match', ['get', 'zone'], 1, 0.38, 2, 0.26, 0.16] : 0.3,
          },
        },
        'bs-streets',
      )
    }
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }
}

function addGroundLayers(map: LibreMap) {
  // Under Blocklight's footprints: shoreline land, then streets
  const below = map.getStyle().layers.find((l) => l.type !== 'background')?.id
  map.addSource('bs-land', { type: 'geojson', data: `${API}land.json` })
  map.addLayer({ id: 'bs-land', type: 'fill', source: 'bs-land', paint: { 'fill-color': THEME.land } }, below)
  map.addSource('bs-streets', { type: 'geojson', data: EMPTY })
  map.addLayer(
    {
      id: 'bs-streets',
      type: 'line',
      source: 'bs-streets',
      minzoom: DETAIL_ZOOM,
      paint: { 'line-color': THEME.street, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 18, 6] },
    },
    below,
  )
  map.addSource('bs-shed', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'bs-shed',
    type: 'fill-extrusion',
    source: 'bs-shed',
    paint: { 'fill-extrusion-color': '#ea580c', 'fill-extrusion-height': 4, 'fill-extrusion-opacity': 0.95 },
  })
}

function streamStreets(map: LibreMap) {
  const tiles = new Map<string, FeatureCollection>()
  const load = async () => {
    if (map.getZoom() < DETAIL_ZOOM) return
    const b = map.getBounds()
    let keys: string[]
    try {
      keys = tileKeys([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], STREET_TILE_ZOOM)
    } catch {
      return // too many tiles in view; wait until the camera comes closer
    }
    const missing = keys.filter((k) => !tiles.has(k))
    if (!missing.length) return
    await Promise.all(
      missing.map(async (k) => {
        const res = await fetch(`${API}streets/${k}.json`).catch(() => null)
        if (res?.ok) tiles.set(k, await res.json())
      }),
    )
    const features = [...tiles.values()].flatMap((t) => t.features)
    ;(map.getSource('bs-streets') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
  }
  map.on('moveend', load)
  load()
}

export function MapCanvas({
  building,
  nearby,
  xray,
  perspective,
  buildingLayer,
  areaLayers,
  onLayerLoading,
  onPickBuilding,
  onPickNearby,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<BlocklightMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [ready, setReady] = useState(false)
  const [hover, setHover] = useState<Hover | null>(null)
  const pick = useRef(onPickBuilding)
  pick.current = onPickBuilding
  const shownBin = useRef<string | null>(null)

  useEffect(() => {
    const blocklight = createMap({
      container: container.current!,
      theme: THEME,
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
      buildings: {
        source: `${API}buildings/manifest.json`,
        detailZoom: DETAIL_ZOOM,
        featureId: 'source_id',
        heightProperty: 'height_m',
        attribution: 'NYC Open Data',
      },
      datasets: [HEIGHT_DATASET],
      activeDataset: HEIGHT_DATASET.id,
      controls: [],
      details: false,
      // Zoomed out, the city is too big to load footprint detail; that's expected
      onError: (e) => !/zoom in/i.test(e.message) && console.warn('[blocklight]', e.message),
    })
    mapRef.current = blocklight
    const map = blocklight.engine.map
    const detachZoomGuard = attachMapZoomGuard(container.current!)
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    overlayRef.current = overlay

    let detachCmd: (() => void) | undefined
    blocklight.ready
      .then(() => {
        addGroundLayers(map)
        streamStreets(map)
        map.addControl(overlay)
        map.dragRotate.enable()
        map.touchPitch.enable()
        detachCmd = attachCmdDragRotate(map)
        setReady(true)
      })
      .catch((e) => console.warn('[blocklight]', e))

    const offSelect = blocklight.engine.on('select', (sel) => {
      const bin = sel?.feature.properties?.source_id as string | undefined
      if (sel && bin && bin !== shownBin.current) pick.current(bin, sel.lngLat.lng, sel.lngLat.lat)
    })

    return () => {
      detachCmd?.()
      detachZoomGuard()
      offSelect()
      blocklight.destroy()
      mapRef.current = null
      overlayRef.current = null
      setReady(false)
    }
  }, [])

  // Set pitch first: Blocklight's camera ease otherwise cancels the fly-to below.
  useEffect(() => {
    if (ready) mapRef.current?.setPerspective(perspective)
  }, [ready, perspective])

  // Fly to and highlight the building being shown
  useEffect(() => {
    const blocklight = mapRef.current
    if (!ready || !blocklight || !building) return
    shownBin.current = building.bin
    const map = blocklight.engine.map
    const [lng, lat] = centroid(building.footprint)
    map.flyTo({ center: [lng, lat], zoom: 17.6, pitch: perspective === '3d' ? 60 : 0, bearing: -30, duration: 3000 })

    const shed = building.shed.active
      ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [scaleRing(building.footprint, 1.12)] } }
      : null
    ;(map.getSource('bs-shed') as GeoJSONSource).setData({ type: 'FeatureCollection', features: shed ? [shed] : [] })

    // Footprint tiles stream in as the camera arrives; select the building once it's loaded
    const select = () => {
      const f = map
        .querySourceFeatures(BUILDING_SOURCE)
        .find((feature) => feature.properties?.source_id === building.bin)
      if (!f) return
      blocklight.engine.selectFeature(BUILDING_LAYER, {
        type: 'Feature',
        id: f.id,
        properties: f.properties,
        geometry: f.geometry,
      })
      map.off('idle', select)
    }
    map.on('idle', select)
    return () => {
      map.off('idle', select)
    }
  }, [ready, building, perspective])

  const layerLoading = useRef(onLayerLoading)
  layerLoading.current = onLayerLoading
  useEffect(() => {
    const blocklight = mapRef.current
    if (!ready || !blocklight) return
    const layer = BUILDING_LAYERS.find((l) => l.id === buildingLayer)
    const dataset = layer ? toDataset(layer) : HEIGHT_DATASET
    layerLoading.current(true)
    blocklight
      .replaceDatasets([dataset], dataset.id)
      .catch((e) => console.warn('[blocklight] layer', e))
      .finally(() => layerLoading.current(false))
  }, [ready, buildingLayer])

  useEffect(() => {
    if (ready && mapRef.current) showAreaLayers(mapRef.current.engine.map, areaLayers)
  }, [ready, areaLayers])

  useEffect(() => {
    overlayRef.current?.setProps({
      getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab'),
      layers: [
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
          onClick: ({ object }) => object && onPickNearby(object),
          onHover: ({ object, x, y }: PickingInfo<NearbyBuilding>) =>
            setHover(object ? { type: 'nearby', building: object, x, y } : null),
        }),
        // Drawn over the map canvas, so dots show through the walls: that's the x-ray
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
  }, [ready, building, nearby, xray, onPickNearby])

  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full touch-none" />
      {hover && <Tooltip hover={hover} />}
    </div>
  )
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

import { steppedScale, type MapDataset } from 'blocklight'

const API = new URL(`${import.meta.env.VITE_API_URL ?? ''}/api/map/layers/`, window.location.origin).href
const NEUTRAL = '#34302a'

type Stop = { value: number; color: string; label: string }

export type BuildingLayer = {
  id: string
  label: string
  source: string
  stops: Stop[]
}

export type AreaLayer = {
  id: string
  label: string
  source: string
  color: string
}

// "Color buildings by": one at a time, joined onto footprints by Blocklight
export const BUILDING_LAYERS: BuildingLayer[] = [
  {
    id: 'unsafe-facades',
    label: 'Unsafe facades',
    source: 'DOB · this cycle',
    stops: [{ value: 1, color: '#f43f5e', label: 'Rated UNSAFE' }],
  },
  {
    id: 'active-sheds',
    label: 'Sidewalk sheds',
    source: 'DOB NOW · active',
    stops: [{ value: 1, color: '#ea580c', label: 'Shed up now' }],
  },
  {
    id: 'vacate-orders',
    label: 'Vacate orders',
    source: 'HPD · still open',
    stops: [
      { value: 1, color: '#fb7185', label: '1–4 units' },
      { value: 5, color: '#e11d48', label: '5–19' },
      { value: 20, color: '#9f1239', label: '20+' },
    ],
  },
  {
    id: 'rat-activity',
    label: 'Rat activity',
    source: 'DOHMH · 12 months',
    stops: [
      { value: 1, color: '#bef264', label: '1 failed' },
      { value: 2, color: '#84cc16', label: '2–4' },
      { value: 5, color: '#4d7c0f', label: '5+' },
    ],
  },
  {
    id: 'heat-complaints',
    label: 'Heat complaints',
    source: '311 · 12 months',
    stops: [
      { value: 1, color: '#93c5fd', label: '1–9' },
      { value: 10, color: '#3b82f6', label: '10–49' },
      { value: 50, color: '#1e40af', label: '50+' },
    ],
  },
]

// Flood overlays: any combination, drawn under the buildings
export const AREA_LAYERS: AreaLayer[] = [
  { id: 'sandy-2012', label: 'Sandy 2012', source: 'surge extent', color: '#38bdf8' },
  { id: 'evacuation-zones', label: 'Evacuation 1–3', source: 'OEM zones', color: '#a78bfa' },
]

// Default view: plain height ramp, expressed as a dataset so layers can be swapped in later
export const HEIGHT_DATASET: MapDataset = {
  id: 'height',
  label: 'Height',
  source: [],
  join: { building: 'source_id', record: 'bin' },
  colors: steppedScale('height_m', [
    { value: 0, color: '#2b2722' },
    { value: 12, color: '#3a352e' },
    { value: 30, color: '#4f483f' },
    { value: 80, color: '#6b6256' },
    { value: 180, color: '#8a7f70' },
  ]),
}

export function toDataset(layer: BuildingLayer): MapDataset {
  return {
    id: layer.id,
    label: layer.label,
    source: `${API}${layer.id}.json`,
    join: { building: 'source_id', record: 'bin' },
    value: 'n',
    // A MapLibre step needs a base output plus at least one threshold; records always count ≥ 1
    colors: steppedScale('value', [{ value: 0, color: NEUTRAL, label: 'None' }, ...layer.stops], NEUTRAL),
  }
}

export const areaUrl = (id: string) => `${API}${id}.json`

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api/client'
import { GoogleMap } from './components/GoogleMap'
import { LayersPanel } from './components/LayersPanel'
import { MapCanvas } from './components/MapCanvas'
import { ResultCard } from './components/ResultCard'
import { SearchPanel } from './components/SearchPanel'
import { INITIAL_VIEW } from './data/goldenPath'
import type { Analysis, Building, NearbyBuilding } from './types'

const HAS_GOOGLE = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)

export default function App() {
  const [building, setBuilding] = useState<Building | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [audioPending, setAudioPending] = useState(false)
  const [nearby, setNearby] = useState<NearbyBuilding[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mapNotice, setMapNotice] = useState<string | null>(null)
  const [xray, setXray] = useState(true)
  const [perspective, setPerspective] = useState<'2d' | '3d'>('3d')
  const [engine, setEngine] = useState<'google' | 'blocklight'>(HAS_GOOGLE ? 'google' : 'blocklight')
  const [buildingLayer, setBuildingLayer] = useState<string | null>(null)
  const [areaLayers, setAreaLayers] = useState<string[]>([])
  const [layerLoading, setLayerLoading] = useState(false)
  const latest = useRef(0)

  const refreshNearby = useCallback((lng: number, lat: number) => {
    api.nearby(lng, lat, 5000).then(setNearby).catch(() => {})
  }, [])

  const show = useCallback(
    async (load: () => Promise<Building>) => {
      const id = ++latest.current
      setScanning(true)
      setError(null)
      let b: Building
      try {
        b = await load()
      } catch (e) {
        if (id === latest.current) {
          setError(e instanceof Error ? e.message : 'Lookup failed')
          setScanning(false)
        }
        return
      }
      if (id !== latest.current) return
      setScanning(false)
      setBuilding(b)
      setAnalysis(null)
      setAnalysisError(null)
      window.history.replaceState(null, '', `?q=${encodeURIComponent(b.address)}`)
      refreshNearby(...b.location.coordinates)

      try {
        const a = await api.analyze(b.bin)
        if (id !== latest.current) return
        setAnalysis(a)
        if (!a.audio_url) {
          setAudioPending(true)
          const withAudio = await api.audio(b.bin).catch(() => null)
          if (id !== latest.current) return
          if (withAudio) setAnalysis(withAudio)
          setAudioPending(false)
        }
      } catch (e) {
        if (id === latest.current) setAnalysisError(e instanceof Error ? e.message : 'Briefing failed')
      }
    },
    [refreshNearby],
  )

  const scan = useCallback((query: string) => show(() => api.lookup(query)), [show])
  const scanAt = useCallback(
    (bin: string, lng: number, lat: number) => show(() => api.lookupAt(bin, lng, lat)),
    [show],
  )
  const openNearby = useCallback((n: NearbyBuilding) => scan(n.address), [scan])
  const scanHere = useCallback((lng: number, lat: number) => show(() => api.lookupHere(lng, lat)), [show])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) scan(q)
    else refreshNearby(INITIAL_VIEW.longitude, INITIAL_VIEW.latitude)
    // only on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="relative h-full w-full overflow-hidden">
      {engine === 'google' ? (
        <GoogleMap
          building={building}
          nearby={nearby}
          xray={xray}
          perspective={perspective}
          areaLayers={areaLayers}
          onFail={(reason) => {
            setMapNotice(`${reason} Showing City view.`)
            setEngine('blocklight')
          }}
          onPickAt={scanHere}
          onPickNearby={openNearby}
        />
      ) : (
        <MapCanvas
          building={building}
          nearby={nearby}
          xray={xray}
          perspective={perspective}
          buildingLayer={buildingLayer}
          areaLayers={areaLayers}
          onLayerLoading={setLayerLoading}
          onPickBuilding={scanAt}
          onPickNearby={openNearby}
        />
      )}

      <div className="pointer-events-none absolute left-5 top-5 z-20">
        <LayersPanel
          buildingLayer={buildingLayer}
          onBuildingLayer={setBuildingLayer}
          areaLayers={areaLayers}
          onToggleArea={(id) => setAreaLayers((on) => (on.includes(id) ? on.filter((x) => x !== id) : [...on, id]))}
          loading={layerLoading}
          showBuildingColors={engine === 'blocklight'}
        />
      </div>

      <div className="pointer-events-none absolute right-5 top-5 z-20 flex max-h-[calc(100%-2.5rem)] w-[380px] flex-col gap-3">
        <div className="panel pointer-events-auto p-2">
          <div className="flex items-baseline justify-between px-2 pb-1 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f59e0b]">BlindSpot NYC</span>
            <span className="text-[10px] text-[#7d766b]">search, or click any building</span>
          </div>
          <SearchPanel busy={scanning} onPick={scan} />
          {error && <p className="px-2 pb-1 pt-2 text-[12px] text-[#fca5a5]">{error}</p>}
          {mapNotice && <p role="status" className="px-2 pb-1 pt-2 text-[12px] text-[#fbbf24]">{mapNotice}</p>}
        </div>

        {building && (
          <div className="panel pointer-events-auto overflow-y-auto p-4">
            <ResultCard building={building} analysis={analysis} analysisError={analysisError} audioPending={audioPending} />
          </div>
        )}
      </div>

      <div className="panel absolute bottom-5 left-5 z-20 flex items-center gap-3 px-2 py-2 text-[11px] text-[#d6d0c4]">
        {HAS_GOOGLE && (
          <div className="flex overflow-hidden rounded-md border border-white/10" role="group" aria-label="Map source">
            {(
              [
                ['google', 'Google'],
                ['blocklight', 'City'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setMapNotice(null); setEngine(id) }}
                aria-pressed={engine === id}
                className={`px-2.5 py-1.5 font-semibold ${engine === id ? 'bg-white/15 text-[#f3efe6]' : 'text-[#8d8579] hover:text-[#ece6da]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex overflow-hidden rounded-md border border-white/10" role="group" aria-label="Perspective">
          {(['3d', '2d'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPerspective(p)}
              aria-pressed={perspective === p}
              className={`px-2.5 py-1.5 font-semibold uppercase ${perspective === p ? 'bg-white/15 text-[#f3efe6]' : 'text-[#8d8579] hover:text-[#ece6da]'}`}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          onClick={() => setXray((x) => !x)}
          aria-pressed={xray}
          disabled={!building}
          className={`rounded-md px-3 py-1.5 font-semibold transition disabled:opacity-40 ${
            xray ? 'bg-[#f59e0b] text-[#1a1408] hover:bg-[#fbbf24]' : 'border border-white/15 text-[#ece6da] hover:bg-white/10'
          }`}
        >
          X-ray {xray ? 'on' : 'off'}
        </button>
        <span className="h-4 w-px bg-white/15" />
        <Legend color="#ef4444" label="Fire / egress" />
        <Legend color="#3891e6" label="Heat / flood 311" />
        <Legend color="#ea580c" label="Sidewalk shed" square />
      </div>
    </div>
  )
}

function Legend({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2.5 ${square ? 'w-3.5 rounded-[2px]' : 'w-2.5 rounded-full'}`} style={{ background: color }} />
      {label}
    </span>
  )
}

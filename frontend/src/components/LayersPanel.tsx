import { AREA_LAYERS, BUILDING_LAYERS } from '../data/mapLayers'

type Props = {
  buildingLayer: string | null
  onBuildingLayer: (id: string | null) => void
  areaLayers: string[]
  onToggleArea: (id: string) => void
  loading: boolean
  showBuildingColors?: boolean
}

export function LayersPanel({
  buildingLayer,
  onBuildingLayer,
  areaLayers,
  onToggleArea,
  loading,
  showBuildingColors = true,
}: Props) {
  const active = BUILDING_LAYERS.find((l) => l.id === buildingLayer)

  return (
    <div className="panel pointer-events-auto w-[236px] p-2.5">
      <div className="flex items-center justify-between px-1 pb-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8d8579]">Layers</h3>
        {loading && <span className="animate-pulse text-[10px] text-[#f59e0b]">loading</span>}
      </div>

      {showBuildingColors && (
        <Section title="Buildings" hint="one at a time">
          <Row
            kind="radio"
            checked={!buildingLayer}
            onChange={() => onBuildingLayer(null)}
            label="Height"
            hint="plain extrusion"
          />
          {BUILDING_LAYERS.map((l) => (
            <Row
              key={l.id}
              kind="radio"
              checked={buildingLayer === l.id}
              onChange={() => onBuildingLayer(l.id)}
              label={l.label}
              hint={l.source}
              color={l.stops[l.stops.length - 1].color}
            />
          ))}
          {active && active.stops.length > 1 && (
            <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 px-1 pt-1">
              {active.stops.map((s) => (
                <span key={s.label} className="flex items-center gap-1 text-[10px] text-[#9a9286]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="Flood" hint="overlays" spaced={showBuildingColors}>
        {AREA_LAYERS.map((l) => (
          <Row
            key={l.id}
            kind="check"
            checked={areaLayers.includes(l.id)}
            onChange={() => onToggleArea(l.id)}
            label={l.label}
            hint={l.source}
            color={l.color}
          />
        ))}
      </Section>
    </div>
  )
}

function Section({
  title,
  hint,
  spaced,
  children,
}: {
  title: string
  hint: string
  spaced?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={spaced ? 'mt-2 border-t border-white/10 pt-2' : ''}>
      <div className="mb-1 flex items-baseline justify-between px-1">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6f685e]">{title}</h4>
        <span className="text-[10px] text-[#5c564e]">{hint}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({
  kind,
  checked,
  onChange,
  label,
  hint,
  color,
}: {
  kind: 'radio' | 'check'
  checked: boolean
  onChange: () => void
  label: string
  hint?: string
  color?: string
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 ${
        checked ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
      }`}
    >
      <input
        type={kind === 'radio' ? 'radio' : 'checkbox'}
        name={kind === 'radio' ? 'building-layer' : undefined}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span
        aria-hidden
        className={`pointer-events-none grid h-3.5 w-3.5 shrink-0 place-items-center border ${
          kind === 'radio' ? 'rounded-full' : 'rounded-[3px]'
        } ${checked ? 'border-[#f59e0b] bg-[#f59e0b]' : 'border-white/25'}`}
      >
        {checked && kind === 'radio' && <span className="h-1.5 w-1.5 rounded-full bg-[#1a1408]" />}
        {checked && kind === 'check' && (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-[#1a1408]" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M2.5 6.2 5 8.6 9.5 3.4" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] leading-tight text-[#ece6da]">{label}</span>
        {hint && <span className="block truncate text-[10px] leading-tight text-[#7d766b]">{hint}</span>}
      </span>
      {color && <span aria-hidden className="pointer-events-none h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
    </label>
  )
}

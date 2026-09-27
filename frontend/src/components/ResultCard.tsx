import { audioSrc } from '../api/client'
import { useState } from 'react'
import { FinancePanel } from './FinancePanel'
import type { Analysis, Building } from '../types'
import { RISK_COLOR, RiskDial } from './RiskDial'
import { VoiceInspector } from './VoiceInspector'

const ENGINE_NAME = { gemini: 'Gemini', grok: 'Grok', rules: 'Rules-based' } as const

const BREAKDOWN_LABELS: [keyof Building['score_breakdown'], string][] = [
  ['S_fire', 'fire/egress'],
  ['S_shed', 'chronic shed'],
  ['S_env', 'heat/flood 311'],
  ['S_repeat', 'volume'],
]

type Props = {
  building: Building
  analysis: Analysis | null
  analysisError: string | null
  audioPending: boolean
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/10 pt-3">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8d8579]">{title}</h3>
      {children}
    </section>
  )
}

function Stat({ value, label, alert }: { value: string; label: string; alert?: boolean }) {
  return (
    <div>
      <div className={`font-mono text-[17px] ${alert ? 'text-[#fca5a5]' : 'text-[#ece6da]'}`}>{value}</div>
      <div className="text-[10px] leading-tight text-[#8d8579]">{label}</div>
    </div>
  )
}

function Trend({ series, insight }: { series: Building['complaint_trend']; insight?: string | null }) {
  const max = Math.max(1, ...series.map((s) => s.n))
  const split = series.some((s) => (s.heat ?? 0) + (s.flood ?? 0) > 0)
  return (
    <div>
      <div className="flex h-12 items-end gap-[3px]">
        {series.map((s) => (
          <div
            key={s.year}
            title={`${s.year}: ${s.n}${split ? ` · ${s.heat ?? 0} heat / ${s.flood ?? 0} flood` : ''}`}
            className="flex flex-1 flex-col-reverse overflow-hidden rounded-t-[2px]"
            style={{ height: `${Math.max(3, (s.n / max) * 100)}%` }}
          >
            <div className="bg-[#3891e6]/80" style={{ height: split ? `${((s.heat ?? s.n) / Math.max(s.n, 1)) * 100}%` : '100%' }} />
            {split && (s.flood ?? 0) > 0 && (
              <div className="bg-[#38bdf8]/80" style={{ height: `${((s.flood ?? 0) / Math.max(s.n, 1)) * 100}%` }} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-[#7d766b]">
        <span>{series[0]?.year}</span>
        <span>{series[series.length - 1]?.year}</span>
      </div>
      {split && (
        <p className="mt-1 text-[10px] text-[#7d766b]">
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-sm bg-[#3891e6]" />
          heat
          <span className="ml-2 mr-2 inline-block h-1.5 w-1.5 rounded-sm bg-[#38bdf8]" />
          flood
        </p>
      )}
      {insight && <p className="mt-1.5 text-[12px] leading-snug text-[#d8d1c4]">{insight}</p>}
    </div>
  )
}

export function ResultCard({ building: b, analysis, analysisError, audioPending }: Props) {
  const [tab, setTab] = useState<'risk' | 'money'>('risk')
  const fire = b.violations.filter((v) => v.fire).length
  const complaints = b.complaint_counts.heat + b.complaint_counts.flood
  const src = audioSrc(analysis?.audio_url ?? null)
  const points = BREAKDOWN_LABELS.filter(([k]) => b.score_breakdown[k] > 0)

  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-[17px] font-semibold leading-snug text-[#f3efe6]">{b.address}</h2>
        <p className="mt-0.5 font-mono text-[10.5px] text-[#8d8579]">
          BIN {b.bin}
          {b.bbl && ` · BBL ${b.bbl}`}
          {b.year_built && ` · built ${b.year_built}`}
        </p>
      </header>

      <div role="tablist" aria-label="Building report" className="flex gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
        {(['risk', 'money'] as const).map((value) => <button key={value} role="tab" id={`${value}-tab-${b.bin}`} aria-controls={`${value}-panel-${b.bin}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'risk' : event.key === 'End' ? 'money' : value === 'risk' ? 'money' : 'risk'
          setTab(next)
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#${next}-tab-${b.bin}`)?.focus()
        }} className={`flex-1 rounded-md px-2 py-2 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#63c6c0] ${tab === value ? 'bg-white/10 text-[#f3efe6]' : 'text-[#8d8579] hover:text-[#d8d1c4]'}`}>
          {value === 'risk' ? 'Risk Profile' : 'Follow the Money'}
        </button>)}
      </div>

      {tab === 'money' ? <FinancePanel key={b.bin} bin={b.bin} /> : <div role="tabpanel" id={`risk-panel-${b.bin}`} aria-labelledby={`risk-tab-${b.bin}`} className="space-y-3">

      <div className="flex items-center gap-4">
        <RiskDial score={b.hazard_score} label={b.risk_label} />
        <div className="min-w-0">
          <div className="text-[22px] font-bold leading-none tracking-tight" style={{ color: RISK_COLOR[b.risk_label] }}>
            {b.risk_label} RISK
          </div>
          <p className="mt-1.5 text-[13px] leading-snug text-[#d8d1c4]">{b.risk_reason}</p>
          {points.length > 0 && (
            <p className="mt-1 font-mono text-[10.5px] text-[#8d8579]">
              {points.map(([k, name]) => `+${b.score_breakdown[k]} ${name}`).join(' · ')}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat value={String(b.violations.length)} label={`open violations (${fire} fire)`} alert={fire > 0} />
        <Stat value={String(complaints)} label="heat/flood 311 · 12 mo" alert={complaints >= 3} />
        <Stat
          value={b.shed.active ? `${(b.shed.age_days / 365).toFixed(1)}y` : 'None'}
          label={b.shed.active ? `shed up since ${b.shed.since?.slice(0, 7)}` : 'active sidewalk shed'}
          alert={b.shed.active && b.shed.age_days > 730}
        />
      </div>

      <Section title="Ask the inspector · ElevenLabs voice agent">
        <VoiceInspector key={b.bin} bin={b.bin} address={b.address} />
      </Section>

      <Section title={analysis ? `Tenant danger briefing · ${ENGINE_NAME[analysis.engine]}` : 'Tenant danger briefing'}>
        {analysis ? (
          <p className="text-[13px] leading-relaxed text-[#e4ddd0]">{analysis.briefing}</p>
        ) : analysisError ? (
          <p className="text-[12px] text-[#fca5a5]">{analysisError}</p>
        ) : (
          <p className="animate-pulse text-[12px] text-[#8d8579]">Reading the violation history…</p>
        )}
        {src ? (
          <audio className="mt-2.5 h-9 w-full" controls src={src} aria-label="Listen to the danger briefing" />
        ) : (
          analysis && (
            <p className="mt-2 text-[11px] text-[#7d766b]">
              {audioPending ? 'Recording audio briefing…' : 'Audio briefing unavailable.'}
            </p>
          )
        )}
      </Section>

      <Section title={`Heat & flood complaints · 10 years${b.trend_source === 'tiger' ? ' · Tiger Data' : ''}`}>
        <Trend series={b.complaint_trend} insight={b.trend_insight} />
      </Section>

      <Section title="Past coverage">
        {!analysis ? (
          <p className="text-[12px] text-[#7d766b]">Searching the news…</p>
        ) : analysis.news.length ? (
          <ul className="space-y-2">
            {analysis.news.map((n) => (
              <li key={n.url}>
                <a href={n.url} target="_blank" rel="noreferrer" className="text-[12.5px] text-[#ece6da] hover:underline">
                  {n.title}
                </a>
                <p className="line-clamp-2 text-[11px] leading-snug text-[#8d8579]">{n.snippet}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-[#7d766b]">No press coverage found for this address.</p>
        )}
      </Section>

      <p className="border-t border-white/10 pt-2 text-[10px] leading-snug text-[#6f685e]">
        NYC Open Data: DOB sheds &amp; safety violations, HPD violations, 311, building footprints · fetched{' '}
        {new Date(b.fetched_at).toLocaleString()}
        {b.data_gaps.length > 0 && <span className="text-[#fca5a5]"> · unavailable: {b.data_gaps.join(', ')}</span>}
      </p>
      </div>}
    </div>
  )
}

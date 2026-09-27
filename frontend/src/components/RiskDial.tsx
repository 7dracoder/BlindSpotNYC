import type { RiskLabel } from '../types'

export const RISK_COLOR: Record<RiskLabel, string> = {
  LOW: '#84cc16',
  MODERATE: '#f59e0b',
  HIGH: '#ef4444',
}

export function RiskDial({ score, label }: { score: number; label: RiskLabel }) {
  const r = 30
  const circ = 2 * Math.PI * r
  const color = RISK_COLOR[label]
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={`${(Math.min(score, 100) / 100) * circ} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-mono text-[20px] font-medium" style={{ color }}>
        {score}
      </div>
    </div>
  )
}

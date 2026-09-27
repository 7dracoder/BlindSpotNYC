export type RiskLabel = 'LOW' | 'MODERATE' | 'HIGH'

export type Place = {
  label: string
  name: string
  borough: string
  bin: string
  bbl: string | null
  coordinates: [number, number]
}

export type Violation = {
  source: 'HPD' | 'DOB'
  id: string
  class: string | null
  category: string
  description: string
  date: string
  apartment?: string | null
  story?: string | null
  fire: boolean
}

export type Complaint = {
  id: string
  date: string
  type: string
  descriptor: string
  status: string
  kind: 'heat' | 'flood'
}

export type Building = {
  bin: string
  bbl: string | null
  address: string
  borough: string
  location: { type: 'Point'; coordinates: [number, number] }
  footprint: [number, number][]
  height_m: number | null
  ground_m: number | null
  year_built: number | null
  shed: { active: boolean; since: string | null; age_days: number; permit_count: number }
  violations: Violation[]
  complaints: Complaint[]
  complaint_counts: { heat: number; flood: number }
  complaint_trend: { year: number; n: number; heat?: number; flood?: number }[]
  trend_insight?: string | null
  trend_source: 'nyc_open_data' | 'tiger'
  hazard_score: number
  risk_label: RiskLabel
  risk_reason: string
  score_breakdown: Record<'S_fire' | 'S_shed' | 'S_env' | 'S_repeat', number>
  data_gaps: string[]
  fetched_at: string
}

export type NewsItem = {
  title: string
  url: string
  snippet: string
  published_date?: string | null
}

export type Analysis = {
  bin: string
  briefing: string
  engine: 'gemini' | 'grok' | 'rules'
  news: NewsItem[]
  audio_url: string | null
  audio_engine: string | null
}

export type NearbyBuilding = {
  bin: string
  address: string
  location: { coordinates: [number, number] }
  hazard_score: number
  risk_label: RiskLabel
}

export type FinanceAssumptions = {
  monthly_shed_rent: number
  repair_principal: number
  annual_interest_pct: number
  term_months: number
  comparison_months: number
}

export type FinanceScenario = {
  bin: string
  assumptions: FinanceAssumptions
  monthly_loan_payment: number
  monthly_cash_flow_gap: number
  comparison_months: number
  shed_rental_total: number
  loan_payment_total: number
  cumulative_cash_flow_gap: number
  total_loan_interest: number
  active_shed: boolean
  shed_age_days: number | null
  nessie_configured: boolean
  records: {
    provider: 'nessie'
    customer_id: string
    merchant_id: string
    account_id: string
    purchase_id: string
    loan_id: string
    initial_mock_balance: number
    synced_at: string
  } | null
}

export type ViewState = {
  longitude: number
  latitude: number
  zoom: number
  pitch: number
  bearing: number
  transitionDuration?: number | 'auto'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transitionInterpolator?: any
}

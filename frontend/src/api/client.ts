import type { Analysis, Building, FinanceAssumptions, FinanceScenario, NearbyBuilding, Place } from '../types'

const BASE = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      // non-JSON error body
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export function audioSrc(path: string | null): string | null {
  if (!path) return null
  return path.startsWith('http') ? path : `${BASE}${path}`
}

export const api = {
  financeDefault: (bin: string, signal?: AbortSignal) => request<FinanceScenario>(`/api/finance/${bin}`, { signal }),
  finance: (bin: string, body: FinanceAssumptions, publish: boolean, signal?: AbortSignal) =>
    request<FinanceScenario>(`/api/finance/${bin}${publish ? '/nessie' : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
    }),
  search: (q: string) => request<Place[]>(`/api/search?q=${encodeURIComponent(q)}`),
  lookup: (q: string) => request<Building>(`/api/lookup?q=${encodeURIComponent(q)}`),
  lookupAt: (bin: string, lng: number, lat: number) =>
    request<Building>(`/api/lookup?bin=${bin}&lng=${lng}&lat=${lat}`),
  lookupHere: (lng: number, lat: number) => request<Building>(`/api/lookup?lng=${lng}&lat=${lat}`),
  analyze: (bin: string) => request<Analysis>(`/api/analyze/${bin}`),
  audio: (bin: string) => request<Analysis>(`/api/analyze/${bin}/audio`, { method: 'POST' }),
  voiceSession: (bin: string) =>
    request<{ token: string; dynamic_variables: Record<string, string> }>(`/api/voice/${bin}/session`),
  nearby: (lng: number, lat: number, meters = 3000) =>
    request<NearbyBuilding[]>(`/api/nearby?lng=${lng}&lat=${lat}&meters=${meters}`),
}

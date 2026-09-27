import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { FinanceAssumptions, FinanceScenario } from '../types'

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`
const defaults = { monthly_shed_rent: '1500', repair_principal: '300000', annual_interest_pct: '7', term_years: '10', comparison_months: '84' }
type Fields = typeof defaults

function formValues(a: FinanceAssumptions): Fields {
  return { monthly_shed_rent: String(a.monthly_shed_rent), repair_principal: String(a.repair_principal), annual_interest_pct: String(a.annual_interest_pct), term_years: String(a.term_months / 12), comparison_months: String(a.comparison_months) }
}

function assumptions(fields: Fields): FinanceAssumptions {
  return { monthly_shed_rent: Number(fields.monthly_shed_rent), repair_principal: Number(fields.repair_principal), annual_interest_pct: Number(fields.annual_interest_pct), term_months: Number(fields.term_years) * 12, comparison_months: Number(fields.comparison_months) }
}

export function FinancePanel({ bin }: { bin: string }) {
  const [scenario, setScenario] = useState<FinanceScenario | null>(null)
  const [fields, setFields] = useState<Fields>(defaults)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    api.financeDefault(bin, controller.signal).then((value) => {
      setScenario(value)
      setFields(formValues(value.assumptions))
    }).catch((err: Error) => {
      if (!controller.signal.aborted) setError(err.message)
    })
    return () => request.current?.abort()
  }, [bin])

  const calculate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const publish = (event.nativeEvent as SubmitEvent).submitter instanceof HTMLButtonElement &&
      ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement).value === 'nessie'
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError(null)
    try {
      const value = await api.finance(bin, assumptions(fields), publish, controller.signal)
      if (!controller.signal.aborted) {
        setScenario(value)
        setFields(formValues(value.assumptions))
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'The calculation could not be completed.')
        if (publish) setScenario((previous) => previous ? { ...previous, records: null } : null)
      }
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  const dirty = scenario && JSON.stringify(assumptions(fields)) !== JSON.stringify(scenario.assumptions)
  const maxPayment = Math.max(1, scenario?.monthly_loan_payment ?? 1, scenario?.assumptions.monthly_shed_rent ?? 1)

  return (
    <div className="space-y-4" role="tabpanel" id={`money-panel-${bin}`} aria-labelledby={`money-tab-${bin}`}>
      <header className="space-y-1.5">
        <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.14em]">
          <span className="text-[#63c6c0]">Follow the Money</span>
          <span className="rounded-full border border-[#63c6c0]/25 px-2 py-1 text-[#8dafa8]">Hypothetical</span>
        </div>
        <h3 className="text-[21px] font-semibold tracking-tight text-[#f3efe6]">The repair tradeoff</h3>
        <p className="text-[12px] leading-relaxed text-[#a49c90]">Explore shed rental versus financing a facade repair. These are editable assumptions, not this landlord’s finances.</p>
      </header>

      {!scenario && !error && <p role="status" className="text-[12px] text-[#a49c90]">Calculating the scenario…</p>}
      {scenario && <>
        {!scenario.active_shed && <p className="rounded-md border border-white/10 px-3 py-2 text-[11px] text-[#a49c90]">No active shed is recorded here. This is an illustrative rental scenario.</p>}
        {dirty && <p role="status" className="text-[11px] text-[#f0b54d]">Assumptions changed. The amounts below show your last calculation.</p>}
        <div className="space-y-4 border-y border-white/10 py-4">
          <div>
            <div className="mb-2 flex items-end justify-between gap-2">
              <span className="text-[12px] text-[#c9c1b5]">Monthly shed rental</span>
              <span className="font-mono text-[17px] text-[#f0b54d]">{money(scenario.assumptions.monthly_shed_rent)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-[#f0b54d]" style={{ width: `${scenario.assumptions.monthly_shed_rent / maxPayment * 100}%` }} /></div>
          </div>
          <div>
            <div className="mb-2 flex items-end justify-between gap-2">
              <span className="text-[12px] text-[#c9c1b5]">Monthly repair payment</span>
              <span className="font-mono text-[17px] text-[#63c6c0]">{money(scenario.monthly_loan_payment)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-[#63c6c0]" style={{ width: `${scenario.monthly_loan_payment / maxPayment * 100}%` }} /></div>
            <p className="mt-2 text-[10px] text-[#8d8579]">{money(scenario.assumptions.repair_principal)} · {scenario.assumptions.annual_interest_pct}% assumed APR · {scenario.assumptions.term_months / 12} years</p>
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[#8d8579]">Monthly cash-flow gap</p>
          <p className="mt-1 font-mono text-[30px] tracking-tight text-[#f3efe6]">{signed(scenario.monthly_cash_flow_gap)}<span className="ml-1 text-[12px] text-[#8d8579]">/mo</span></p>
          <p className="mt-1 text-[12px] text-[#c9c1b5]">{scenario.monthly_cash_flow_gap > 0 ? 'Shed rent costs less upfront under these assumptions.' : scenario.monthly_cash_flow_gap < 0 ? 'The repair payment is lower under these assumptions.' : 'The two monthly costs are equal.'}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-white/10 bg-black/15 px-3 py-3">
          <div><p className="text-[10px] text-[#8d8579]">{scenario.comparison_months}-month rental total</p><p className="mt-1 font-mono text-[13px] text-[#ece6da]">{money(scenario.shed_rental_total)}</p></div>
          <div><p className="text-[10px] text-[#8d8579]">{scenario.comparison_months}-month loan payments</p><p className="mt-1 font-mono text-[13px] text-[#ece6da]">{money(scenario.loan_payment_total)}</p></div>
          <div className="col-span-2 border-t border-white/10 pt-2"><p className="text-[10px] text-[#8d8579]">Illustrative cumulative cash-flow gap</p><p className="mt-1 font-mono text-[16px] text-[#63c6c0]">{signed(scenario.cumulative_cash_flow_gap)}</p></div>
        </div>
        <p className="text-[10.5px] leading-relaxed text-[#8d8579]">This gap is not profit, verified savings, or evidence of intent. Loan payments repay principal. Repair benefits, fees, penalties, and changing rental costs are excluded. The hazard score is unchanged.</p>
      </>}

      <details className="border-t border-white/10 pt-3" open={!scenario || undefined}>
        <summary className="cursor-pointer text-[12px] font-medium text-[#d8d1c4]">Edit assumptions</summary>
        <form className="mt-3 space-y-3" onSubmit={calculate}>
          <fieldset disabled={pending || !scenario} className="grid grid-cols-2 gap-3 disabled:opacity-60">
            {([
              ['monthly_shed_rent', 'Shed rent ($/month)', 0, 100000, 0.01],
              ['repair_principal', 'Repair amount ($)', 1000, 5000000, 1],
              ['annual_interest_pct', 'Assumed APR (%)', 0, 40, 0.1],
              ['term_years', 'Loan term (years)', 1, 30, 1],
              ['comparison_months', 'Compare months', 1, 360, 1],
            ] as const).map(([key, label, min, max, step]) => <label key={key} className="space-y-1 text-[10px] text-[#a49c90]">
              <span>{label}</span>
              <input type="number" required min={min} max={max} step={step} value={fields[key]} onChange={(event) => setFields((previous) => ({ ...previous, [key]: event.target.value }))} className="w-full rounded-md border border-white/15 bg-black/25 px-2.5 py-2 font-mono text-[12px] text-[#f3efe6] outline-none focus:border-[#63c6c0]" />
            </label>)}
          </fieldset>
          <p className="text-[10px] text-[#8d8579]">Comparison is capped at the loan term. Rental price is an assumption; building geometry does not establish its cost.</p>
          <button type="submit" value="calculate" disabled={pending || !scenario} className="w-full rounded-md bg-[#63c6c0] px-3 py-2 text-[12px] font-semibold text-[#102320] hover:bg-[#82d8d3] disabled:opacity-50">{pending ? 'Working…' : 'Recalculate'}</button>
          {scenario?.nessie_configured && <button type="submit" value="nessie" disabled={pending} className="w-full rounded-md border border-[#63c6c0]/35 px-3 py-2 text-[12px] text-[#a7dfd9] hover:bg-[#63c6c0]/10 disabled:opacity-50">{pending ? 'Working…' : scenario.records && !dirty ? 'Nessie ledger synced' : 'Record scenario in Nessie'}</button>}
        </form>
      </details>
      {error && <p role="alert" className="text-[12px] leading-relaxed text-[#fca5a5]">{error}</p>}
      {scenario && <div className="border-t border-white/10 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#63c6c0]">{scenario.records && !dirty ? 'Nessie · Mock ledger synced' : 'Local simulation'}</p>
        <p className="mt-1 text-[10.5px] leading-relaxed text-[#8d8579]">{scenario.nessie_configured ? 'Nessie stores fictional banking records. Payment math is calculated by BlindSpot, not a bank quote.' : 'Nessie is not connected. The calculator runs locally; no banking records were created.'}</p>
        {scenario.records && !dirty && <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-[#b6aea1]">View Nessie record IDs</summary>
          <dl className="mt-2 space-y-1.5 text-[10px] text-[#8d8579]">{(['customer', 'merchant', 'account', 'purchase', 'loan'] as const).map((name) => <div key={name}><dt className="capitalize">{name}</dt><dd className="break-all font-mono text-[#c9c1b5]">{scenario.records![`${name}_id`]}</dd></div>)}</dl>
          <p className="mt-2 text-[10px] text-[#8d8579]">Initial fictional balance: {money(scenario.records.initial_mock_balance)}. One pending purchase represents one rental month; no automatic monthly charges run.</p>
          <p className="mt-1 text-[10px] text-[#8d8579]">Last verified: {new Date(scenario.records.synced_at).toLocaleString()}</p>
        </details>}
      </div>}
    </div>
  )
}

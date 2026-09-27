import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { GOLDEN_PATH } from '../data/goldenPath'

type Option = { query: string; hint: string }

type Props = {
  busy: boolean
  onPick: (query: string) => void
}

export function SearchPanel({ busy, onPick }: Props) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [results, setResults] = useState<Option[]>([])

  useEffect(() => {
    const q = text.trim()
    if (q.length < 3) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      api
        .search(q)
        .then((places) =>
          setResults(places.map((p) => ({ query: `${p.name}, ${p.borough}`, hint: `BIN ${p.bin}` }))),
        )
        .catch(() => setResults([]))
    }, 220)
    return () => clearTimeout(timer)
  }, [text])

  const options: Option[] =
    text.trim().length < 3 ? GOLDEN_PATH.map((g) => ({ query: g.query, hint: g.note })) : results

  const pick = (query: string) => {
    setText(query)
    setOpen(false)
    onPick(query)
  }

  return (
    <div className="relative">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const chosen = open ? options[active]?.query : undefined
          if (chosen || text.trim()) pick(chosen ?? text.trim())
        }}
      >
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, options.length - 1))
            if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0))
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Any NYC address"
          aria-label="Search an NYC address"
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-[15px] text-[#f3efe6] outline-none placeholder:text-[#7d766b]"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-[#f59e0b] px-3.5 py-2 text-[13px] font-semibold text-[#1a1408] transition hover:bg-[#fbbf24] disabled:opacity-50"
        >
          {busy ? 'Scanning…' : 'Scan'}
        </button>
      </form>

      {open && options.length > 0 && (
        <ul className="mt-2 border-t border-white/10 pt-1">
          {text.trim().length < 3 && (
            <li className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-[0.14em] text-[#7d766b]">
              Demo buildings
            </li>
          )}
          {options.map((o, i) => (
            <li key={o.query}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.query)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full flex-col rounded px-2 py-1.5 text-left ${i === active ? 'bg-white/[0.07]' : ''}`}
              >
                <span className="text-[13px] text-[#ece6da]">{o.query}</span>
                <span className="text-[11px] text-[#8d8579]">{o.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

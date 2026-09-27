import { useEffect, useRef, useState } from 'react'
import {
  ConversationProvider,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from '@elevenlabs/react'
import { api } from '../api/client'

type Line = { role: 'user' | 'agent'; text: string }

const PROMPTS = [
  "What's the biggest danger?",
  'Tell me about the fire exits',
  'How long has the shed been up?',
  'Should I rent here?',
  'What should I ask the landlord?',
]

export function VoiceInspector({ bin, address }: { bin: string; address: string }) {
  const [lines, setLines] = useState<Line[]>([])
  return (
    <ConversationProvider
      onMessage={(m) => {
        const text = m.message?.trim()
        if (!text) return
        setLines((l) => [...l, { role: m.role, text }])
      }}
    >
      <Inspector bin={bin} address={address} lines={lines} clear={() => setLines([])} />
    </ConversationProvider>
  )
}

function Inspector({ bin, address, lines, clear }: { bin: string; address: string; lines: Line[]; clear: () => void }) {
  const { startSession, endSession, sendUserMessage, sendUserActivity, sendContextualUpdate } = useConversationControls()
  const { status, message } = useConversationStatus()
  const { isSpeaking } = useConversationMode()
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [draft, setDraft] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const report = useRef<string | null>(null)
  const pendingAsk = useRef<string | null>(null)

  useEffect(() => endSession, [endSession])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [lines])

  const live = status === 'connected'

  useEffect(() => {
    if (!live) return
    if (report.current) {
      sendContextualUpdate(report.current)
      report.current = null
    }
    if (pendingAsk.current) {
      sendUserMessage(pendingAsk.current)
      pendingAsk.current = null
    }
  }, [live, sendContextualUpdate, sendUserMessage])

  const start = async () => {
    setError(null)
    setPreparing(true)
    clear()
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
      mic.getTracks().forEach((t) => t.stop())
      const session = await api.voiceSession(bin)
      report.current = session.dynamic_variables.building_report
      startSession({
        conversationToken: session.token,
        dynamicVariables: session.dynamic_variables,
        onError: (msg, ctx) => {
          const extra =
            ctx && typeof ctx === 'object' && 'debugMessage' in ctx && ctx.debugMessage
              ? ` ${String(ctx.debugMessage)}`
              : ''
          setError(`${msg}${extra}`)
        },
      })
    } catch (e) {
      pendingAsk.current = null
      setError(
        e instanceof DOMException ? 'Microphone access is needed to talk to the inspector.' : e instanceof Error ? e.message : 'Could not start',
      )
    } finally {
      setPreparing(false)
    }
  }

  const ask = (text: string) => {
    if (live) {
      sendUserMessage(text)
      return
    }
    pendingAsk.current = text
    void start()
  }

  const busy = preparing || status === 'connecting'

  return (
    <div>
      {!live ? (
        <button
          onClick={() => void start()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-[#f59e0b]/50 bg-[#f59e0b]/10 px-3 py-2.5 text-[13px] font-semibold text-[#fbbf24] transition hover:bg-[#f59e0b]/20 disabled:opacity-60"
        >
          <span className={`h-2 w-2 rounded-full bg-[#f59e0b] ${busy ? 'animate-pulse' : ''}`} />
          {busy ? 'Connecting…' : 'Talk to the inspector'}
        </button>
      ) : (
        <div className="flex items-center justify-between rounded-md bg-white/[0.05] px-3 py-2">
          <span className="flex items-center gap-2 text-[12px] text-[#ece6da]">
            <span className={`h-2.5 w-2.5 rounded-full ${isSpeaking ? 'animate-pulse bg-[#f59e0b]' : 'bg-[#84cc16]'}`} />
            {isSpeaking ? 'Inspector speaking' : 'Listening… ask anything'}
          </span>
          <button onClick={endSession} className="text-[12px] font-semibold text-[#fca5a5] hover:underline">
            End
          </button>
        </div>
      )}

      {!live && !lines.length && !error && (
        <p className="mt-1.5 text-[11px] leading-snug text-[#7d766b]">
          A live voice agent that knows the records for {address}. Talk, or tap a question.
        </p>
      )}
      {(error || (status === 'error' && message)) && (
        <p className="mt-1.5 text-[11px] text-[#fca5a5]">{error ?? message}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {PROMPTS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => ask(q)}
            className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-[#c9c2b4] hover:border-[#f59e0b]/50 hover:text-[#f3efe6] disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {lines.length > 0 && (
        <div ref={log} className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
          {lines.map((l, i) => (
            <p key={i} className={`text-[12px] leading-snug ${l.role === 'agent' ? 'text-[#e4ddd0]' : 'text-[#9ec5f0]'}`}>
              <span className="mr-1 font-mono text-[10px] uppercase text-[#7d766b]">{l.role === 'agent' ? 'Inspector' : 'You'}</span>
              {l.text}
            </p>
          ))}
        </div>
      )}

      {live && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!draft.trim()) return
            sendUserMessage(draft.trim())
            setDraft('')
          }}
        >
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              sendUserActivity()
            }}
            placeholder="Or type a question"
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-[12px] text-[#f3efe6] outline-none placeholder:text-[#6f685e] focus:border-[#f59e0b]/60"
          />
          <button type="submit" className="rounded-md bg-white/10 px-2.5 text-[12px] text-[#ece6da] hover:bg-white/15">
            Send
          </button>
        </form>
      )}
    </div>
  )
}

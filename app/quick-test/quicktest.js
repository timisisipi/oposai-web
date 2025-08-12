// OposAI — Quick Test (React + Supabase)
// Single-file drop-in for Next.js (App Router or Pages) or any React app.
// - Uses Tailwind for styling (no custom colors required)
// - Talks to Supabase RPCs: get_random_questions, start_attempt, submit_answer, finish_attempt
// - Minimal, clean, production-ready structure
//
// HOW TO USE
// 1) Install client:  npm i @supabase/supabase-js
// 2) Define env vars (browser-safe):
//    NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
//    NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
// 3) Create a supabaseClient.ts (snippet provided below) and import it here.
// 4) Drop this component into a page (examples for Next.js App Router and Pages provided at bottom).
// 5) Ensure your Supabase RPCs & policies are set as we configured earlier.

import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

// ---------- supabaseClient.ts (copy this into /lib/supabaseClient.ts or similar) ----------
// import { createClient } from '@supabase/supabase-js'
// export const supabase = createClient(
//   process.env.NEXT_PUBLIC_SUPABASE_URL!,
//   process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
//   { auth: { persistSession: true } }
// )
// -----------------------------------------------------------------------------------------

// If you don't want a separate file while testing, we inline it here:
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
if (!supabaseUrl || !supabaseAnon) {
  // eslint-disable-next-line no-console
  console.warn('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
}
const supabase = createClient(supabaseUrl || '', supabaseAnon || '', { auth: { persistSession: true } })

// Types matching your RPC output
export type Option = { label: 'A'|'B'|'C'|'D'; text: string }
export type Question = {
  id: number
  stem: string
  type: 'mcq'|'truefalse'
  difficulty: 1|2|3
  subject?: string
  topic?: string
  options: Option[]
}

// Small helper
function clsx(...arr: Array<string | false | undefined>) { return arr.filter(Boolean).join(' ') }

type Phase = 'idle'|'loading'|'answering'|'finishing'|'finished'

export default function QuickTest() {
  const [count, setCount] = useState<number>(10)
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<number, Option['label']>>({})
  const [attemptId, setAttemptId] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string>('')

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers])
  const progress = useMemo(() => (questions.length ? Math.round((answeredCount/questions.length)*100) : 0), [answeredCount, questions])

  async function start() {
    try {
      setError('')
      setPhase('loading')
      setAnswers({})
      setResult(null)
      setAttemptId(null)

      // 1) Fetch questions (no solutions returned) via RPC
      const { data: qs, error: qErr } = await supabase.rpc('get_random_questions', {
        p_topic_id: null, p_subject_id: null, p_limit: count
      })
      if (qErr) throw qErr
      setQuestions(qs || [])

      // 2) Start attempt
      const { data: attId, error: aErr } = await supabase.rpc('start_attempt', { p_mode: 'test_rapido' })
      if (aErr) throw aErr
      setAttemptId(attId as number)

      setPhase('answering')
    } catch (e: any) {
      setError(e?.message || 'Error iniciando el test')
      setPhase('idle')
    }
  }

  async function choose(qid: number, label: Option['label']) {
    if (!attemptId) return
    setAnswers(prev => ({ ...prev, [qid]: label }))
    // Persist selection immediately
    const { error: sErr } = await supabase.rpc('submit_answer', {
      p_attempt_id: attemptId, p_question_id: qid, p_selected: label
    })
    if (sErr) setError(sErr.message)
  }

  async function finish() {
    if (!attemptId) return
    try {
      setPhase('finishing')
      const { data, error: fErr } = await supabase.rpc('finish_attempt', { p_attempt_id: attemptId })
      if (fErr) throw fErr
      setResult(Array.isArray(data) ? data[0] : data)
      setPhase('finished')
    } catch (e: any) {
      setError(e?.message || 'Error finalizando el test')
      setPhase('answering')
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Test rápido — Auxiliar Administrativo</h1>
        <p className="text-sm opacity-80">Preguntas aleatorias, respuestas de opción múltiple, resultados al instante.</p>
      </header>

      {/* Controls */}
      {phase === 'idle' && (
        <div className="flex items-center gap-3">
          <label className="text-sm">Número de preguntas</label>
          <select
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value))}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            {[5,10,15,20].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={start} className="rounded-2xl px-4 py-2 text-sm shadow hover:shadow-md border">Empezar</button>
        </div>
      )}

      {phase === 'answering' && (
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm">Progreso: {answeredCount}/{questions.length} ({progress}%)</div>
          <button onClick={finish} className={clsx('rounded-2xl px-4 py-2 text-sm shadow border', answeredCount === questions.length || questions.length === 0 ? '' : 'opacity-70')}>Finalizar</button>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border px-3 py-2 text-sm">{error}</div>
      )}

      {/* Questions */}
      {['answering','finishing'].includes(phase) && (
        <div className="space-y-6">
          {questions.map((q, idx) => {
            const selected = answers[q.id]
            return (
              <div key={q.id} className="rounded-2xl border p-4 shadow-sm">
                <div className="mb-2 text-xs opacity-70">Pregunta {idx+1} · {q.topic || 'Tema'}</div>
                <div className="mb-3 font-medium">{q.stem}</div>
                <div className="grid gap-2">
                  {q.options.map(opt => (
                    <button
                      key={opt.label}
                      disabled={phase === 'finishing'}
                      onClick={() => choose(q.id, opt.label)}
                      className={clsx(
                        'text-left rounded-xl border px-3 py-2',
                        selected === opt.label && 'outline outline-2'
                      )}
                    >
                      <span className="mr-2 font-semibold">{opt.label}.</span>
                      <span>{opt.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Result */}
      {phase === 'finished' && result && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border p-4 shadow-sm">
            <div className="text-lg font-semibold">Resultado</div>
            <div className="mt-1 text-sm">Nota: <span className="font-medium">{result.score}%</span> · Correctas: {result.correct}/{result.total}</div>
          </div>
          {Array.isArray(result.by_topic) && (
            <div className="rounded-2xl border p-4 shadow-sm">
              <div className="mb-3 text-lg font-semibold">Desglose por tema</div>
              <div className="grid gap-2">
                {result.by_topic.map((t: any, i: number) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border px-3 py-2">
                    <div className="text-sm">{t.topic || 'Tema'}</div>
                    <div className="text-sm">{t.correct}/{t.total}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => { setPhase('idle'); setQuestions([]); setAnswers({}); setResult(null); setAttemptId(null); }} className="rounded-2xl px-4 py-2 text-sm shadow border">Nuevo test</button>
          </div>
        </div>
      )}

      {/* Loading states */}
      {phase === 'loading' && (
        <div className="mt-6 text-sm">Preparando tu test…</div>
      )}
      {phase === 'finishing' && (
        <div className="mt-6 text-sm">Corrigiendo…</div>
      )}
    </div>
  )
}

// ---------------------- Next.js usage examples ----------------------
// (A) App Router — app/quick-test/page.tsx
// export default function Page() { return <QuickTest /> }
//
// (B) Pages Router — pages/quick-test.tsx
// import QuickTest from '../components/QuickTest'
// export default function QuickTestPage(){ return <QuickTest /> }
// -------------------------------------------------------------------

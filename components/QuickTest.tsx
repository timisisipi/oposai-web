"use client";

import React, { useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: true } }
);

type Option = { label: "A" | "B" | "C" | "D"; text: string };
type Question = {
  id: number;
  stem: string;
  type: "mcq" | "truefalse";
  difficulty: 1 | 2 | 3;
  subject?: string;
  topic?: string;
  options: Option[];
};

export default function QuickTest() {
  const [count, setCount] = useState(5);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, Option["label"]>>({});
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "answering" | "finishing" | "finished">("idle");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>("");

  const answered = useMemo(() => Object.keys(answers).length, [answers]);

  async function start() {
    try {
      setError("");
      setResult(null);
      setAnswers({});
      setPhase("idle");
      // 1) Preguntas
      const { data: qs, error: qErr } = await supabase.rpc("get_random_questions", {
        p_topic_id: null, p_subject_id: null, p_limit: count
      });
      if (qErr) throw qErr;
      setQuestions(qs || []);
      // 2) Intento
      const { data: attId, error: aErr } = await supabase.rpc("start_attempt", { p_mode: "test_rapido" });
      if (aErr) throw aErr;
      setAttemptId(attId as number);
      setPhase("answering");
    } catch (e: any) {
      setError(e?.message || "Error iniciando el test");
    }
  }

  async function choose(qid: number, label: Option["label"]) {
    if (!attemptId) return;
    setAnswers(prev => ({ ...prev, [qid]: label }));
    const { error: sErr } = await supabase.rpc("submit_answer", {
      p_attempt_id: attemptId, p_question_id: qid, p_selected: label
    });
    if (sErr) setError(sErr.message);
  }

  async function finish() {
    if (!attemptId) return;
    try {
      const { data, error: fErr } = await supabase.rpc("finish_attempt", { p_attempt_id: attemptId });
      if (fErr) throw fErr;
      setResult(Array.isArray(data) ? data[0] : data);
      setPhase("finished");
    } catch (e: any) {
      setError(e?.message || "Error finalizando");
    }
  }

  return (
    <div style={{maxWidth: 800, margin: "0 auto", padding: 16}}>
      <h1>Test rápido — Auxiliar Administrativo</h1>

      {phase === "idle" && (
        <div style={{display:"flex", gap:8, alignItems:"center", marginTop:12}}>
          <label>Nº preguntas</label>
          <select value={count} onChange={e => setCount(parseInt(e.target.value))}>
            {[5,10,15,20].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={start}>Empezar</button>
        </div>
      )}

      {error && <div style={{marginTop:12, border:"1px solid #ccc", padding:8}}>{error}</div>}

      {phase === "answering" && (
        <>
          <div style={{marginTop:12}}>Progreso: {answered}/{questions.length}</div>
          <div style={{display:"grid", gap:12, marginTop:12}}>
            {questions.map((q, idx) => (
              <div key={q.id} style={{border:"1px solid #ddd", borderRadius:8, padding:12}}>
                <div style={{opacity:.7, fontSize:12}}>Pregunta {idx+1} · {q.topic || "Tema"}</div>
                <div style={{margin:"8px 0", fontWeight:600}}>{q.stem}</div>
                <div style={{display:"grid", gap:6}}>
                  {q.options.map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => choose(q.id, opt.label)}
                      style={{
                        textAlign:"left",
                        border:"1px solid #ccc",
                        borderRadius:8,
                        padding:8,
                        background: answers[q.id] === opt.label ? "#eef" : "white"
                      }}
                    >
                      <b style={{marginRight:6}}>{opt.label}.</b>{opt.text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{marginTop:16}}>
            <button onClick={finish} disabled={questions.length===0}>Finalizar</button>
          </div>
        </>
      )}

      {phase === "finished" && result && (
        <div style={{marginTop:16, border:"1px solid #ddd", borderRadius:8, padding:12}}>
          <div><b>Nota:</b> {result.score}%</div>
          <div><b>Correctas:</b> {result.correct}/{result.total}</div>
          {Array.isArray(result.by_topic) && (
            <div style={{marginTop:8}}>
              <b>Por tema:</b>
              <ul>
                {result.by_topic.map((t:any, i:number) => (
                  <li key={i}>{t.topic || "Tema"} — {t.correct}/{t.total}</li>
                ))}
              </ul>
            </div>
          )}
          <div style={{marginTop:12}}>
            <button onClick={() => { setPhase("idle"); setQuestions([]); setAnswers({}); setResult(null); setAttemptId(null); }}>
              Nuevo test
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

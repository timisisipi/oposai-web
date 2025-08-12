"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { motion, AnimatePresence } from "framer-motion";

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

type Phase = "idle" | "loading" | "answering" | "finishing" | "finished";

export default function QuickTestPro() {
  const [count, setCount] = useState(10);
  const [phase, setPhase] = useState<Phase>("idle");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, Option["label"]>>({});
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<any>(null);

  // Navegación, timer, marcado y modo entrenamiento
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(45);
  const [marked, setMarked] = useState<Record<number, boolean>>({});
  const [trainingMode, setTrainingMode] = useState<boolean>(false);

  // Tutor IA
  const [tutor, setTutor] = useState<Record<number, string>>({});
  const [loadingTutor, setLoadingTutor] = useState<Record<number, boolean>>({});
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const initialTopicId = searchParams?.get("topic_id");
  const initialTopicName = searchParams?.get("topic") || "";

  const [filterTopicId, setFilterTopicId] = useState<number | null>(
    initialTopicId ? Number(initialTopicId) : null
      );
  const [filterTopicName, setFilterTopicName] = useState<string>(initialTopicName);


React.useEffect(() => {
  supabase.auth.getSession().then(({ data }) => {
    setUserEmail(data.session?.user?.email ?? null);
  });
  const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
    setUserEmail(session?.user?.email ?? null);
  });
  return () => { sub.subscription.unsubscribe(); };
}, []);


  const answered = useMemo(() => Object.keys(answers).length, [answers]);
  const progress = useMemo(
    () => (questions.length ? Math.round((answered / questions.length) * 100) : 0),
    [answered, questions]
  );

  // Iniciar test
  async function start() {
    try {
      setError("");
      setPhase("loading");
      setAnswers({});
      setResult(null);
      setAttemptId(null);
      setTutor({});
      setLoadingTutor({});
      setMarked({});

      const { data: s } = await supabase.auth.getSession();
      if (!s.session) {
        alert("Inicia sesión para empezar el test.");
        router.push("/login");
        return;
}

      const { data: qs, error: qErr } = await supabase.rpc("get_random_questions", {
        p_topic_id: filterTopicId,     // ← usa el filtro si existe
        p_subject_id: null,
        p_limit: count,
      });

      if (qErr) throw qErr;
      setQuestions(qs || []);

      const { data: attId, error: aErr } = await supabase.rpc("start_attempt", {
        p_mode: trainingMode ? "entrenamiento" : "test_rapido",
      });
      if (aErr) throw aErr;

      setAttemptId(attId as number);
      setActiveIdx(0);
      setTimeLeft(45);
      setPhase("answering");
    } catch (e: any) {
      setError(e?.message || "Error iniciando el test");
      setPhase("idle");
    }
  }

  // Elegir respuesta
  async function choose(qid: number, label: Option["label"]) {
    if (!attemptId) return;
    setAnswers((prev) => ({ ...prev, [qid]: label }));
    const { error: sErr } = await supabase.rpc("submit_answer", {
      p_attempt_id: attemptId,
      p_question_id: qid,
      p_selected: label,
    });
    if (sErr) setError(sErr.message);

    if (trainingMode) {
      await askTutor(qid);
    }
  }

  // Finalizar
  async function finish() {
    if (!attemptId) return;
    if (Object.keys(answers).length < questions.length) {
      const ok = confirm("Te faltan preguntas por responder. ¿Finalizar igualmente?");
      if (!ok) return;
    }
    try {
      setPhase("finishing");
      const { data, error: fErr } = await supabase.rpc("finish_attempt", {
        p_attempt_id: attemptId,
      });
      if (fErr) throw fErr;
      setResult(Array.isArray(data) ? data[0] : data);
      setPhase("finished");
    } catch (e: any) {
      setError(e?.message || "Error finalizando el test");
      setPhase("answering");
    }
  }

  // Marcar para revisar
  async function toggleMark(qid: number) {
    const v = !marked[qid];
    setMarked((prev) => ({ ...prev, [qid]: v }));
    if (attemptId) {
      await supabase
        .from("attempt_answers")
        .upsert(
          { attempt_id: attemptId, question_id: qid, marked: v },
          { onConflict: "attempt_id,question_id" }
        );
    }
  }

  // Tutor IA
  async function askTutor(qid: number) {
    if (!attemptId) return;
    setLoadingTutor((prev) => ({ ...prev, [qid]: true }));
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attempt_id: attemptId, question_id: qid }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error del tutor");
      setTutor((prev) => ({ ...prev, [qid]: json.text }));
    } catch (e: any) {
      setTutor((prev) => ({ ...prev, [qid]: `Error: ${e?.message || "no disponible"}` }));
    } finally {
      setLoadingTutor((prev) => ({ ...prev, [qid]: false }));
    }
  }

  // Timer
  React.useEffect(() => {
    if (phase !== "answering") return;
    const t = setInterval(() => setTimeLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [phase, activeIdx]);

  // Auto avance / finalizar
  React.useEffect(() => {
    if (phase !== "answering") return;
    if (timeLeft === 0) {
      if (activeIdx < questions.length - 1) {
        setActiveIdx((i) => i + 1);
        setTimeLeft(45);
      } else {
        finish();
      }
    }
  }, [timeLeft, phase, activeIdx, questions.length]);

  // Atajos teclado
  React.useEffect(() => {
    if (phase !== "answering") return;
    function onKey(e: KeyboardEvent) {
      const map: Record<string, "A" | "B" | "C" | "D"> = { a: "A", b: "B", c: "C", d: "D" };
      const key = e.key.toLowerCase();
      const q = questions[activeIdx];
      if (!q) return;
      if (map[key]) {
        e.preventDefault();
        choose(q.id, map[key]);
      }
      if (key === "enter") {
        e.preventDefault();
        if (activeIdx < questions.length - 1) {
          setActiveIdx((i) => i + 1);
          setTimeLeft(45);
        } else {
          finish();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, activeIdx, questions]);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
      <div>
    <h1 className="text-xl sm:text-2xl font-semibold">Test rápido — Auxiliar Administrativo</h1>
    <p className="text-xs sm:text-sm opacity-70">Tests aleatorios, respuestas inmediatas y desglose por tema.</p>
    </div>

    <div className="flex items-center gap-2">
      <a href="/historial" className="rounded-xl border px-3 py-2 text-xs sm:text-sm shadow-sm">
      Historial
      </a>

    {userEmail ? (
      <a href="/logout" className="rounded-xl border px-3 py-2 text-xs sm:text-sm shadow-sm">Salir</a>
    ) : (
      <a href="/login" className="rounded-xl border px-3 py-2 text-xs sm:text-sm shadow-sm">Entrar</a>
    )}

    <button
      onClick={() => setPhase("idle")}
      className="rounded-xl border px-3 py-2 text-xs sm:text-sm shadow-sm"
    >
      Reiniciar
    </button>

    {filterTopicId !== null && (
      <div className="text-xs sm:text-sm">
        Practicando tema: <span className="font-medium">{filterTopicName || `ID ${filterTopicId}`}</span>{" "}
        <button
          onClick={() => { setFilterTopicId(null); setFilterTopicName(""); }}
          className="underline"
        >
          quitar
        </button>
      </div>
    )}


  </div>
</div>
  

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-4 rounded-xl border px-3 py-2 text-sm"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Idle */}
      {phase === "idle" && (
        <div className="rounded-2xl border p-4 sm:p-6 shadow-sm">
          <div className="mb-4 text-sm">Configura tu test</div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm">Nº preguntas</span>
              <select
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value))}
                className="rounded-lg border px-3 py-2 text-sm"
              >
                {[5, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={trainingMode}
                onChange={(e) => setTrainingMode(e.target.checked)}
              />
              Mostrar explicación al responder (modo entrenamiento)
            </label>

            <button onClick={start} className="rounded-2xl border px-4 py-2 text-sm shadow hover:shadow-md">
              Empezar
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {phase === "loading" && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl border" />
          ))}
        </div>
      )}

      {/* Answering */}
      {phase === "answering" && (
        <div className="space-y-4">
          {/* Barra superior */}
          <div className="flex items-center justify-between">
            <div className="text-xs">Pregunta {activeIdx + 1}/{questions.length}</div>
            <div className="text-xs sm:text-sm font-semibold">Tiempo: {timeLeft}s</div>
          </div>
          <div className="h-2 w-full rounded-full border bg-gray-100">
            <div className="h-2 rounded-full bg-gray-800" style={{ width: `${(timeLeft / 45) * 100}%` }} />
          </div>

          {/* Navegación rápida */}
          <div className="flex flex-wrap gap-2">
            {questions.map((qq, i) => (
              <button
                key={qq.id}
                onClick={() => {
                  setActiveIdx(i);
                  setTimeLeft(45);
                }}
                className={[
                  "w-8 h-8 rounded-full border text-xs",
                  i === activeIdx ? "outline outline-2" : "",
                  marked[qq.id] ? "bg-gray-100" : "",
                ].join(" ")}
              >
                {i + 1}
              </button>
            ))}
          </div>

          {/* Solo la pregunta activa */}
          {questions[activeIdx] && (() => {
            const q = questions[activeIdx];
            const selected = answers[q.id];
            return (
              <motion.div
                key={q.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="rounded-2xl border p-4 sm:p-5 shadow-sm"
              >
                <div className="mb-2 text-[11px] sm:text-xs opacity-70">{q.topic ? `Tema: ${q.topic}` : "Pregunta"}</div>
                <div className="mb-3 text-sm sm:text-base font-medium">{q.stem}</div>
                <div className="grid gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => choose(q.id, opt.label)}
                      className={[
                        "text-left rounded-xl border px-3 py-2 text-sm sm:text-base transition-shadow",
                        selected === opt.label ? "outline outline-2" : "hover:shadow-sm",
                      ].join(" ")}
                    >
                      <span className="mr-2 font-semibold">{opt.label}.</span>
                      <span>{opt.text}</span>
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <button onClick={() => toggleMark(q.id)} className="rounded-xl border px-3 py-2 text-sm">
                    {marked[q.id] ? "✓ Marcada" : "Marcar para revisar"}
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (activeIdx > 0) {
                          setActiveIdx((i) => i - 1);
                          setTimeLeft(45);
                        }
                      }}
                      className="rounded-xl border px-3 py-2 text-sm"
                    >
                      Anterior
                    </button>
                    <button
                      onClick={() => {
                        if (activeIdx < questions.length - 1) {
                          setActiveIdx((i) => i + 1);
                          setTimeLeft(45);
                        } else {
                          finish();
                        }
                      }}
                      className="rounded-xl border px-3 py-2 text-sm"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })()}

          <div className="flex justify-end">
            <button onClick={finish} className="rounded-2xl border px-4 py-2 text-sm shadow hover:shadow-md">
              Finalizar
            </button>
          </div>
        </div>
      )}

      {/* Finishing */}
      {phase === "finishing" && <div className="mt-6 text-sm">Corrigiendo…</div>}

      {/* Finished */}
      {phase === "finished" && result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border p-4 sm:p-5 shadow-sm">
          <div className="text-base sm:text-lg font-semibold">Resultado</div>
          <div className="mt-1 text-sm sm:text-base">
            Nota: <span className="font-medium">{result.score}%</span> · Correctas: {result.correct}/{result.total}
          </div>

          {Array.isArray(result.by_topic) && (
            <div className="mt-4">
              <div className="mb-2 text-sm sm:text-base font-semibold">Desglose por tema</div>
              <div className="grid gap-2">
                {result.by_topic.map((t: any, i: number) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm sm:text-base">
                    <div>{t.topic || "Tema"}</div>
                    <div className="opacity-80">{t.correct}/{t.total}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Explicaciones del tutor */}
          <div className="mt-6 space-y-4">
            <div className="text-base sm:text-lg font-semibold">Explicaciones del tutor</div>
            <div className="grid gap-3">
              {questions.map((q) => (
                <div key={q.id} className="rounded-xl border p-3 sm:p-4">
                  <div className="text-sm sm:text-base font-medium mb-1">{q.stem}</div>
                  <div className="text-xs opacity-70 mb-2">Tu respuesta: {answers[q.id] ?? "—"}</div>

                  {!tutor[q.id] ? (
                    <button
                      onClick={() => askTutor(q.id)}
                      disabled={!!loadingTutor[q.id]}
                      className="rounded-xl border px-3 py-2 text-sm shadow-sm"
                    >
                      {loadingTutor[q.id] ? "Consultando..." : "Pedir explicación al tutor IA"}
                    </button>
                  ) : (
                    <div className="prose prose-sm max-w-none mt-2 whitespace-pre-wrap">{tutor[q.id]}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              onClick={() => {
                setPhase("idle");
                setQuestions([]);
                setAnswers({});
                setResult(null);
                setAttemptId(null);
                setTutor({});
                setLoadingTutor({});
                setMarked({});
                setActiveIdx(0);
                setTimeLeft(45);
              }}
              className="rounded-2xl border px-4 py-2 text-sm shadow"
            >
              Nuevo test
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

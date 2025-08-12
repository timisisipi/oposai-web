"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type AttemptRow = {
  id: number; mode: string | null;
  started_at: string | null; finished_at: string | null;
  total: number | null; correct: number | null; score: number | null;
};

export default function Historial() {
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [kpis, setKpis] = useState<{tests:number; avg:number; last7:number}>({tests:0, avg:0, last7:0});
  const [byTopic, setByTopic] = useState<Array<{topic_id:number|null; topic:string; total:number; correct:number; avg:number;}>>([]);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return;
      setEmail(s.session.user.email ?? null);

      const { data, error } = await supabase
        .from("attempts")
        .select("id, mode, started_at, finished_at, total, correct, score")
        .order("started_at", { ascending: false });
      if (!error && data) {
        const list = data as AttemptRow[];
        setRows(list);

      // Cargar desglose por tema (RPC)
      const { data: stats } = await supabase.rpc("get_topic_stats");
      if (stats) {
        setByTopic(stats.map((r:any)=>({
          topic_id: r.topic_id ?? null,
          topic: r.topic,
          total: r.total,
          correct: r.correct,
          avg: Number(r.avg) || 0
        })));
      }

        const tests = list.length;
        const scored = list.filter(r => r.score != null);
        const avg = scored.length ? Math.round(scored.reduce((a,b)=>a+(b.score||0),0)/scored.length) : 0;
        const last7 = list.filter(r => r.started_at && (new Date(r.started_at).getTime() > Date.now()-7*86400000)).length;
        setKpis({ tests, avg, last7 });
      }
    })();
  }, []);

  if (!email) {
    return (
      <main className="p-6">
        <div className="rounded-xl border p-4 max-w-md">
          <p className="mb-3">Inicia sesión para ver tu historial.</p>
          <a href="/login" className="rounded-xl border px-3 py-2 shadow">Entrar</a>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Historial de {email}</h1>
        <a href="/quick-test" className="rounded-xl border px-3 py-2 text-sm shadow">Nuevo test</a>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border p-4">
          <div className="text-xs opacity-70">Tests totales</div>
          <div className="text-2xl font-semibold">{kpis.tests}</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs opacity-70">Media de nota</div>
          <div className="text-2xl font-semibold">{kpis.avg}%</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs opacity-70">Tests últimos 7 días</div>
          <div className="text-2xl font-semibold">{kpis.last7}</div>
        </div>
      </div>

      {/* Rendimiento por tema */}
      <div className="rounded-2xl border p-4">
        <div className="mb-3 text-sm sm:text-base font-semibold">Rendimiento por tema</div>
        {byTopic.length === 0 ? (
          <div className="text-sm opacity-70">Aún no hay datos suficientes.</div>
        ) : (
          <div className="space-y-2">
            {byTopic.map((t) => (
              <div key={`${t.topic}-${t.topic_id ?? 'n/a'}`} className="flex items-center justify-between gap-3 border rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm truncate">{t.topic}</div>
                  <div className="text-xs opacity-70">{t.correct}/{t.total} · {t.avg}%</div>
                </div>
                <a
                  href={`/quick-test?topic_id=${t.topic_id ?? ''}&topic=${encodeURIComponent(t.topic)}`}
                  className="text-sm rounded-lg border px-3 py-1"
                >
                  Practicar este tema
                </a>
              </div>
            ))}
          </div>
        )}
      </div>


      {/* Lista */}
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.id} className="rounded-xl border p-3 flex items-center justify-between">
            <div>
              <div className="text-sm">
                Intento #{r.id} · {r.mode ?? "test"}
                {typeof r.score === "number" && <span> · {r.score}%</span>}
              </div>
              <div className="text-xs opacity-70">
                {r.started_at ? new Date(r.started_at).toLocaleString() : ""} · {r.finished_at ? "Finalizado" : "En curso"}
              </div>
            </div>
            <div className="text-xs opacity-70">{r.correct ?? 0}/{r.total ?? 0}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-sm opacity-70">Aún no tienes intentos.</div>}
      </div>
    </main>
  );
}

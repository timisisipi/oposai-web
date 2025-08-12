"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type AttemptRow = { id: number; mode: string | null; started_at: string | null; finished_at: string | null; };

export default function Historial() {
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return;
      setEmail(s.session.user.email ?? null);
      const { data, error } = await supabase
        .from("attempts")
        .select("id, mode, started_at, finished_at")
        .order("started_at", { ascending: false });
      if (!error && data) setRows(data as AttemptRow[]);
    })();
  }, []);

  if (!email) {
    return (
      <main className="p-6">
        <a href="/login" className="rounded-xl border px-3 py-2 shadow">Entrar</a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold mb-4">Historial de intentos</h1>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.id} className="rounded-xl border p-3 flex items-center justify-between">
            <div>
              <div className="text-sm">Intento #{r.id} · {r.mode ?? "test"}</div>
              <div className="text-xs opacity-70">
                {r.started_at ? new Date(r.started_at).toLocaleString() : ""} {r.finished_at ? " · Finalizado" : " · En curso"}
              </div>
            </div>
            <a href="/quick-test" className="text-sm rounded-lg border px-3 py-1">Nuevo test</a>
          </div>
        ))}
        {rows.length === 0 && <div className="text-sm opacity-70">Aún no tienes intentos.</div>}
      </div>
    </main>
  );
}

"use client";
import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/quick-test` },
    });
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4">
        <h1 className="text-xl font-semibold">Entrar</h1>
        {sent ? (
          <p className="text-sm">Revisa tu correo y entra con el enlace mágico.</p>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="w-full rounded-xl border px-3 py-2"
            />
            {err && <div className="text-sm">{err}</div>}
            <button className="rounded-xl border px-4 py-2 shadow">Enviar enlace</button>
          </form>
        )}
      </div>
    </main>
  );
}

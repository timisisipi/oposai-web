// app/api/tutor/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE, OPENAI_API_KEY } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL) throw new Error("ENV missing: NEXT_PUBLIC_SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE) throw new Error("ENV missing: SUPABASE_SERVICE_ROLE");
if (!OPENAI_API_KEY) throw new Error("ENV missing: OPENAI_API_KEY");

const supabaseAdmin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// Utilidad simple con timeout
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 30000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function POST(req: Request) {
  try {
    const { attempt_id, question_id } = await req.json();
    if (!attempt_id || !question_id) {
      return NextResponse.json({ ok: false, error: "missing attempt_id or question_id" }, { status: 400 });
    }

    // 1) Carga pregunta + opciones (1 fila + lista)
    const { data: q, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, stem, correct_option, topic_id")
      .eq("id", question_id)
      .maybeSingle();
    if (qErr) throw qErr;
    if (!q) return NextResponse.json({ ok: false, error: "question not found" }, { status: 404 });

    const { data: opts, error: oErr } = await supabaseAdmin
      .from("options")
      .select("label, text")
      .eq("question_id", question_id)
      .order("label");
    if (oErr) throw oErr;

    let topicName = "";
    if (q.topic_id) {
      const { data: t } = await supabaseAdmin.from("topics").select("name").eq("id", q.topic_id).maybeSingle();
      topicName = t?.name ?? "";
    }

    const optionsText = (opts || []).map((o: any) => `${o.label}. ${o.text}`).join("\n");

    const system =
      "Eres un tutor de oposiciones. Responde en español claro y conciso. 4-6 líneas máximo. No repitas la pregunta.";
    const user = `
Pregunta: ${q.stem}
Opciones:
${optionsText}
Respuesta correcta: ${q.correct_option}
Tema: ${topicName || "(Desconocido)"}.
Explica por qué esa opción es correcta y por qué las otras no lo son, brevemente.
`.trim();

    // 2) Intento 1: chat.completions (estable)
    let text: string | undefined;
    {
      const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          max_tokens: 300,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      }, 30000);

      const jr = await r.json().catch(() => ({}));
      if (r.ok) {
        text = jr?.choices?.[0]?.message?.content?.trim();
      } else if (jr?.error?.message) {
        // si hay error claro, devuélvelo
        return NextResponse.json({ ok: false, error: jr.error.message }, { status: r.status });
      }
    }

    // 3) Fallback: responses API (por si el proveedor cambia formato)
    if (!text) {
      const r2 = await fetchWithTimeout("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: `${system}\n\n${user}`,
        }),
      }, 30000);

      const jr2 = await r2.json().catch(() => ({}));
      if (r2.ok) {
        text =
          (typeof jr2.output_text === "string" && jr2.output_text.trim()) ||
          // algunos modelos devuelven array de "output"
          jr2?.output?.[0]?.content?.[0]?.text?.trim();
      } else if (jr2?.error?.message) {
        return NextResponse.json({ ok: false, error: jr2.error.message }, { status: r2.status });
      }
    }

    if (!text) {
      return NextResponse.json(
        { ok: false, error: "El tutor no devolvió texto. Intenta de nuevo en unos minutos." },
        { status: 503 }
      );
    }

    // 4) Cache (opcional; si no quieres user_id, lo dejas null)
    await supabaseAdmin
      .from("tutor_explanations")
      .upsert({ attempt_id, question_id, user_id: null, text }, { onConflict: "attempt_id,question_id" });

    return NextResponse.json({ ok: true, text });
  } catch (e: any) {
    const msg = e?.message || "server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// app/api/tutor/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE, OPENAI_API_KEY } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL) throw new Error("ENV missing: NEXT_PUBLIC_SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE) throw new Error("ENV missing: SUPABASE_SERVICE_ROLE");
if (!OPENAI_API_KEY) throw new Error("ENV missing: OPENAI_API_KEY");

const supabaseAdmin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE);

export async function POST(req: Request) {
  try {
    const { attempt_id, question_id } = await req.json();
    if (!attempt_id || !question_id) {
      return NextResponse.json({ ok: false, error: "missing attempt_id or question_id" }, { status: 400 });
    }

    // 1) Lee la pregunta (una sola fila)
    const { data: q, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, stem, correct_option, topic_id")
      .eq("id", question_id)
      .maybeSingle();
    if (qErr) throw qErr;
    if (!q) return NextResponse.json({ ok: false, error: "question not found" }, { status: 404 });

    // 2) Lee opciones (lista)
    const { data: opts, error: oErr } = await supabaseAdmin
      .from("options")
      .select("label, text")
      .eq("question_id", question_id)
      .order("label");
    if (oErr) throw oErr;

    // (Opcional) etiqueta del tema
    let topicName = "";
    if (q.topic_id) {
      const { data: t } = await supabaseAdmin.from("topics").select("name").eq("id", q.topic_id).maybeSingle();
      topicName = t?.name ?? "";
    }

    // 3) Prompt para el LLM
    const optionsText = (opts || [])
      .map((o: any) => `${o.label}. ${o.text}`)
      .join("\n");

    const prompt = `
Eres un tutor de oposiciones. Explica de forma breve y clara la respuesta correcta.
- Pregunta: ${q.stem}
- Opciones:
${optionsText}
- Respuesta correcta: ${q.correct_option}
- Tema: ${topicName}
Devuelve 4-6 líneas como máximo, en español, sin repetir la pregunta.
`;

    // 4) Llamada a OpenAI (responses API)
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt,
      }),
    });

    const jr = await r.json();
    if (!r.ok) {
      const msg = jr?.error?.message || "openai error";
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }

    const text = typeof jr.output_text === "string" ? jr.output_text.trim() : "Sin respuesta";

    // 5) Cachear (no obligatorio, pero útil)
    await supabaseAdmin
      .from("tutor_explanations")
      .upsert({ attempt_id, question_id, user_id: null, text }, { onConflict: "attempt_id,question_id" });

    return NextResponse.json({ ok: true, text });
  } catch (e: any) {
    const msg = e?.message || "server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


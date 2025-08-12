import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,           // OK leerla en servidor
  process.env.SUPABASE_SERVICE_ROLE!,             // SOLO servidor
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  try {
    const { attempt_id, question_id } = await req.json();

    if (!attempt_id || !question_id) {
      return NextResponse.json({ error: "Faltan attempt_id o question_id" }, { status: 400 });
    }

    // 1) Saca pregunta completa (incluye correct_option) y respuesta del usuario
    const { data: q, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, stem, correct_option, explanation, source, topic_id, topics(name), options:options(label,text)")
      .eq("id", question_id)
      .single();
    if (qErr) throw qErr;

    const { data: ans, error: aErr } = await supabaseAdmin
      .from("attempt_answers")
      .select("selected_option")
      .eq("attempt_id", attempt_id)
      .eq("question_id", question_id)
      .single();
    if (aErr) throw aErr;

    const selected = ans?.selected_option as string | null;
    const correct = q.correct_option as string;

    // 2) Construye el prompt (formato en 3 capas)
    const system = `Eres un tutor de oposiciones de Auxiliar Administrativo.
Responde SIEMPRE en 3 capas: 
**Idea clave** (1–2 frases) 
**Paso a paso** (numerado) 
**Referencia** (norma/tema) 
**Próximo paso (60 s)** (mini tarea).
Lenguaje claro. No inventes artículos.`;
    const user = `
Pregunta: ${q.stem}
Opciones: ${q.options.map((o: any) => `${o.label}) ${o.text}`).join(" | ")}
Respuesta del alumno: ${selected ?? "(no contestó)"}
Respuesta correcta: ${correct}
Explicación base (si existe): ${q.explanation ?? "—"}
Fuente/tema: ${q.source ?? "—"}
Da feedback breve, corrige si está mal y explica por qué las incorrectas no lo son.`;

    // 3) Llama a OpenAI
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      }),
    });

    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`OpenAI error: ${txt}`);
    }
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content ?? "Sin respuesta";

    return NextResponse.json({ ok: true, text });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error" }, { status: 500 });
  }
}

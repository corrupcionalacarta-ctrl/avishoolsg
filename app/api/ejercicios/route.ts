import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const dynamic = 'force-dynamic'

const GEMINI_KEY   = process.env.GEMINI_API_KEY   || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL      || 'gemini-2.5-flash'

export async function POST(req: NextRequest) {
  try {
    const { archivo_id, alumno } = await req.json()
    if (!archivo_id) return NextResponse.json({ error: 'Falta archivo_id' }, { status: 400 })

    // Cargar el archivo analizado
    const { data: archivo, error } = await supabase
      .from('classroom_archivos')
      .select('*')
      .eq('id', archivo_id)
      .maybeSingle()

    if (error || !archivo) return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })

    // Parsear preguntas y temas (pueden venir como string JSON)
    const temas: string[] = Array.isArray(archivo.temas) ? archivo.temas
      : (typeof archivo.temas === 'string' ? JSON.parse(archivo.temas || '[]') : [])

    const preguntas: { numero: string | number; tipo: string; enunciado: string }[] =
      Array.isArray(archivo.preguntas) ? archivo.preguntas
      : (typeof archivo.preguntas === 'string' ? JSON.parse(archivo.preguntas || '[]') : [])

    const nombre = (alumno || archivo.alumno || 'el alumno').split(' ')[0]

    const prompt = `Eres un profesor experto en el currículo chileno de educación básica.
Debes crear ejercicios de práctica para ${nombre}, alumno de 6° básico.

MATERIAL ORIGINAL:
- Asignatura: ${archivo.asignatura || 'Sin asignatura'}
- Título: ${archivo.titulo_inferido || archivo.archivo_nombre}
- Unidad: ${archivo.unidad_tematica || ''}
- Temas: ${temas.slice(0, 6).join(', ')}
- Tipo: ${archivo.tipo_contenido || 'ejercicio'}

${preguntas.length > 0 ? `PREGUNTAS/EJERCICIOS ORIGINALES (como referencia de estilo y dificultad):
${preguntas.slice(0, 8).map(p => `  ${p.numero}. [${p.tipo}] ${(p.enunciado || '').slice(0, 200)}`).join('\n')}` : ''}

GENERA exactamente 5 ejercicios de práctica NUEVOS y DIFERENTES a los originales, del mismo nivel y tema.

Responde SOLO con JSON válido, sin markdown, con esta estructura:
{
  "titulo": "Práctica: [tema principal]",
  "asignatura": "${archivo.asignatura || ''}",
  "ejercicios": [
    {
      "numero": 1,
      "tipo": "desarrollo|seleccion|verdadero_falso|completar|problema",
      "enunciado": "texto completo del ejercicio",
      "alternativas": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "respuesta": "respuesta correcta o null si es desarrollo",
      "pista": "pista breve para orientar al alumno si se traba"
    }
  ],
  "consejo": "un consejo pedagógico corto para este tema"
}`

    const genai = new GoogleGenerativeAI(GEMINI_KEY)
    const model = genai.getGenerativeModel({ model: GEMINI_MODEL })
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
    })

    let raw = result.response.text() || ''
    // Limpiar markdown si viene envuelto
    raw = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

    const data = JSON.parse(raw)

    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    console.error('[ejercicios]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

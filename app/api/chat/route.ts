import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from '@/lib/supabase'
import { buildContext } from '@/lib/rag'

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { pregunta, historial = [], alumno } = body
    if (!pregunta) return Response.json({ error: 'Falta pregunta' }, { status: 400 })

    if (!process.env.GEMINI_API_KEY) {
      return Response.json({ respuesta: 'Error: falta GEMINI_API_KEY en variables de entorno.' }, { status: 500 })
    }

    // Build RAG context — if it fails, continue with empty context
    let contexto = ''
    try {
      contexto = await buildContext(alumno)
    } catch (e) {
      console.error('[chat] buildContext error:', e)
      contexto = '(contexto no disponible)'
    }

    const alumnoCtx = alumno
      ? `Estás ayudando específicamente sobre ${alumno.charAt(0).toUpperCase() + alumno.slice(1)}.`
      : 'Puedes hablar sobre ambos alumnos.'

    const system = `Eres un asistente escolar para apoderados chilenos. Ayudas a Manuel y Clau con la agenda de sus hijos:
- Clemente Aravena, 11 años, 6°D
- Raimundo Aravena, 9 años, 4°A
Colegio Georgian (Saint George), Chile.
${alumnoCtx}

Contexto escolar actual (datos reales de Supabase):
${contexto}

INSTRUCCIONES:
- Responde en español, de forma concisa y directa
- Usa los datos reales del contexto cuando sea posible
- Si te preguntan sobre el estado de un alumno, usa el análisis IA si está disponible
- Si te preguntan qué estudiar, organiza el contenido por asignatura con las fechas de evaluación
- Si no tienes información suficiente sobre algo, dilo claramente
- Puedes sugerir acciones concretas basadas en el análisis longitudinal`

    const model = genai.getGenerativeModel({
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      systemInstruction: system,
    })

    // Gemini requires history to start with 'user' — drop any leading model messages
    const rawHistory = (historial as { rol: string; contenido: string }[])
      .slice(-8)
      .map(m => ({ role: m.rol === 'user' ? 'user' : 'model', parts: [{ text: m.contenido }] }))
    const firstUserIdx = rawHistory.findIndex(m => m.role === 'user')
    const chatHistory = firstUserIdx >= 0 ? rawHistory.slice(firstUserIdx) : []

    const chat = model.startChat({ history: chatHistory })
    const result = await chat.sendMessage(pregunta)
    const respuesta = result.response.text()

    // Persist to DB — fire and forget, never block the response
    supabase.from('mensajes_chat').insert([
      { canal: 'web', rol: 'user', contenido: pregunta, alumno: alumno ?? null },
      { canal: 'web', rol: 'assistant', contenido: respuesta, alumno: alumno ?? null },
    ]).then(({ error }) => {
      if (error) console.error('[chat] insert mensajes_chat:', error.message)
    })

    return Response.json({ respuesta })

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[chat] error:', msg)
    return Response.json({ respuesta: `Error al procesar: ${msg}` }, { status: 500 })
  }
}

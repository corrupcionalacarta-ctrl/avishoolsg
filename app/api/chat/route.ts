import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from '@/lib/supabase'
import { buildContext } from '@/lib/rag'

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function POST(req: Request) {
  const { pregunta, historial = [], alumno } = await req.json()
  if (!pregunta) return Response.json({ error: 'Falta pregunta' }, { status: 400 })

  const contexto = await buildContext(alumno)

  const alumnoCtx = alumno
    ? `Estás ayudando específicamente sobre ${alumno.charAt(0).toUpperCase() + alumno.slice(1)}.`
    : 'Puedes hablar sobre ambos alumnos.'

  const system = `Eres un asistente escolar para apoderados chilenos. Ayudas a Manuel y su señora con la agenda de sus hijos:
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
    model: 'gemini-2.5-flash',
    systemInstruction: system,
  })

  const chatHistory = (historial as { rol: string; contenido: string }[]).slice(-8).map(m => ({
    role: m.rol === 'user' ? 'user' : 'model',
    parts: [{ text: m.contenido }],
  }))

  const chat = model.startChat({ history: chatHistory })
  const result = await chat.sendMessage(pregunta)
  const respuesta = result.response.text()

  try {
    await supabase.from('mensajes_chat').insert([
      { canal: 'web', rol: 'user', contenido: pregunta, alumno: alumno ?? null },
      { canal: 'web', rol: 'assistant', contenido: respuesta, alumno: alumno ?? null },
    ])
  } catch {}

  return Response.json({ respuesta })
}

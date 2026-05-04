import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from '@/lib/supabase'
import { buildContext } from '@/lib/rag'

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function POST(req: Request) {
  const { pregunta, historial = [] } = await req.json()
  if (!pregunta) return Response.json({ error: 'Falta pregunta' }, { status: 400 })

  const contexto = await buildContext()

  const system = `Eres un asistente escolar para apoderados chilenos. Ayudas a Manuel y su señora con la agenda de sus hijos:
- Clemente Aravena, 11 años, 6°D
- Raimundo Aravena, 9 años, 4°A
Colegio Georgian (Saint George), Chile.

Contexto escolar actual:
${contexto}

Responde en español, de forma concisa y práctica. Si no tienes información suficiente, dilo claramente.`

  const model = genai.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: system,
  })

  const chatHistory = (historial as { rol: string; contenido: string }[]).slice(-6).map(m => ({
    role: m.rol === 'user' ? 'user' : 'model',
    parts: [{ text: m.contenido }],
  }))

  const chat = model.startChat({ history: chatHistory })
  const result = await chat.sendMessage(pregunta)
  const respuesta = result.response.text()

  // Guardar en historial
  await supabase.from('mensajes_chat').insert([
    { canal: 'web', rol: 'user', contenido: pregunta },
    { canal: 'web', rol: 'assistant', contenido: respuesta },
  ])

  return Response.json({ respuesta })
}

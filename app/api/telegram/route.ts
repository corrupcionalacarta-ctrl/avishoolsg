import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from '@/lib/supabase'
import { buildContext } from '@/lib/rag'

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID!

async function sendTelegram(chatId: number, text: string) {
  const msg = text.length > 4000 ? text.slice(0, 3990) + '\n...(truncado)' : text
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  })
}

export async function POST(req: Request) {
  const body = await req.json()
  const message = body?.message
  if (!message?.text) return new Response('ok')

  const chatId: number = message.chat.id
  const text: string = message.text.trim()

  // Solo responde al chat autorizado
  if (chatId.toString() !== ALLOWED_CHAT_ID) return new Response('ok')

  // Comandos de ayuda
  if (text === '/start' || text === '/ayuda') {
    await sendTelegram(chatId,
      '👋 <b>AVI School Bot</b>\n\n' +
      'Comandos:\n' +
      '/hoy — resumen del día\n' +
      '/urgente — tareas urgentes\n' +
      '/fechas — próximas pruebas\n' +
      '/utiles — útiles para mañana\n' +
      '/notas — últimas notas\n\n' +
      'O escribe cualquier pregunta sobre Clemente o Raimundo.'
    )
    return new Response('ok')
  }

  // Cargar contexto y último digest para comandos rápidos
  const { data: digest } = await supabase
    .from('digests')
    .select('json_completo, resumen_ejecutivo')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const json = digest?.json_completo as Record<string, unknown> ?? {}

  if (text === '/hoy') {
    const urgentes = (json.urgentes as { titulo: string }[] ?? []).map(u => `• ${u.titulo}`).join('\n')
    const utiles = (json.utiles_mañana as string[] ?? []).map(u => `• ${u}`).join('\n')
    let resp = `📋 <b>Resumen del día</b>\n\n${digest?.resumen_ejecutivo ?? 'Sin datos'}`
    if (urgentes) resp += `\n\n🔴 <b>Urgente:</b>\n${urgentes}`
    if (utiles) resp += `\n\n🎒 <b>Llevar mañana:</b>\n${utiles}`
    await sendTelegram(chatId, resp)
    return new Response('ok')
  }

  if (text === '/urgente') {
    const items = json.urgentes as { titulo: string; detalle: string }[] ?? []
    const resp = items.length
      ? '🔴 <b>Urgentes:</b>\n' + items.map(u => `• <b>${u.titulo}</b>\n  ${u.detalle}`).join('\n\n')
      : 'No hay items urgentes. 👍'
    await sendTelegram(chatId, resp)
    return new Response('ok')
  }

  if (text === '/fechas') {
    const { data } = await supabase
      .from('items_colegio')
      .select('titulo, fecha_evento, asignatura, alumno')
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', new Date().toISOString().split('T')[0])
      .order('fecha_evento')
      .limit(10)
    const resp = data?.length
      ? '📅 <b>Próximas fechas:</b>\n' + data.map(f => `• ${f.fecha_evento} — ${f.titulo} ${f.alumno ? `(${f.alumno})` : ''}`).join('\n')
      : 'No hay fechas próximas registradas.'
    await sendTelegram(chatId, resp)
    return new Response('ok')
  }

  if (text === '/utiles') {
    const utiles = json.utiles_mañana as string[] ?? []
    const resp = utiles.length
      ? '🎒 <b>Llevar mañana:</b>\n' + utiles.map(u => `• ${u}`).join('\n')
      : 'No se detectaron útiles especiales para mañana.'
    await sendTelegram(chatId, resp)
    return new Response('ok')
  }

  if (text === '/notas') {
    const { data } = await supabase
      .from('notas')
      .select('alumno, asignatura, nota, promedio_curso, descripcion')
      .order('extraido_en', { ascending: false })
      .limit(10)
    const resp = data?.length
      ? '📊 <b>Últimas notas:</b>\n' + data.map(n =>
          `• ${n.alumno ?? 'Clemente'} | ${n.asignatura}: <b>${n.nota}</b>${n.promedio_curso ? ` (prom: ${n.promedio_curso})` : ''}`
        ).join('\n')
      : 'No hay notas registradas aún.'
    await sendTelegram(chatId, resp)
    return new Response('ok')
  }

  // Pregunta libre → RAG con Gemini
  const contexto = await buildContext()
  const system = `Eres un asistente escolar para apoderados chilenos. Ayudas a Manuel con la agenda de:
- Clemente Aravena, 11 años, 6°D
- Raimundo Aravena, 9 años, 4°A
Colegio Georgian, Chile. Responde breve y en español.

${contexto}`

  const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: system })
  const result = await model.generateContent(text)
  const respuesta = result.response.text()

  await supabase.from('mensajes_chat').insert([
    { canal: 'telegram', rol: 'user', contenido: text, telegram_chat_id: chatId },
    { canal: 'telegram', rol: 'assistant', contenido: respuesta, telegram_chat_id: chatId },
  ])

  await sendTelegram(chatId, respuesta)
  return new Response('ok')
}

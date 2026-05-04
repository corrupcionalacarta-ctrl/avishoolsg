'use client'

import { useState } from 'react'

type Message = { rol: 'user' | 'assistant'; contenido: string }

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { rol: 'assistant', contenido: '¡Hola! Soy el asistente escolar de AVI School. Puedo ayudarte con la agenda de Clemente y Raimundo, sus notas, fechas de pruebas o cualquier duda del colegio.' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  async function send() {
    if (!input.trim() || loading) return
    const pregunta = input.trim()
    setInput('')
    setMessages(m => [...m, { rol: 'user', contenido: pregunta }])
    setLoading(true)

    try {
      const historial = messages.slice(-6)
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta, historial }),
      })
      const data = await res.json()
      setMessages(m => [...m, { rol: 'assistant', contenido: data.respuesta ?? 'Error al obtener respuesta.' }])
    } catch {
      setMessages(m => [...m, { rol: 'assistant', contenido: 'Error de conexión. Intenta nuevamente.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <h1 className="text-xl font-bold text-[#003366] mb-4">💬 Asistente Escolar</h1>

      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.rol === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
              m.rol === 'user'
                ? 'bg-[#003366] text-white rounded-br-sm'
                : 'bg-white border shadow-sm text-gray-800 rounded-bl-sm'
            }`}>
              {m.contenido}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border shadow-sm rounded-2xl rounded-bl-sm px-4 py-2 text-sm text-gray-400">
              Pensando...
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 border rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003366]"
          placeholder="¿Qué tiene Clemente mañana? ¿Cómo va Raimundo en matemática?"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="bg-[#003366] text-white rounded-full px-5 py-2 text-sm font-medium hover:bg-[#004080] disabled:opacity-50 transition-colors"
        >
          Enviar
        </button>
      </div>
    </div>
  )
}

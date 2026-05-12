'use client'

import { useState } from 'react'

type Ejercicio = {
  numero: number
  tipo: string
  enunciado: string
  alternativas?: string[]
  respuesta?: string | null
  pista?: string
}

type EjerciciosData = {
  titulo: string
  asignatura: string
  ejercicios: Ejercicio[]
  consejo?: string
}

export default function PracticarButton({
  archivoId,
  alumno,
  titulo,
}: {
  archivoId: string
  alumno: string
  titulo: string
}) {
  const [estado, setEstado] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [data, setData] = useState<EjerciciosData | null>(null)
  const [error, setError] = useState('')
  const [revelados, setRevelados] = useState<Set<number>>(new Set())
  const [respuestas, setRespuestas] = useState<Record<number, string>>({})

  async function generar() {
    setEstado('loading')
    setRevelados(new Set())
    setRespuestas({})
    try {
      const r = await fetch('/api/ejercicios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivo_id: archivoId, alumno }),
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json.error || 'Error del servidor')
      setData(json)
      setEstado('done')
    } catch (e) {
      setError(String(e))
      setEstado('error')
    }
  }

  function revelar(num: number) {
    setRevelados(prev => new Set([...prev, num]))
  }

  function setResp(num: number, val: string) {
    setRespuestas(prev => ({ ...prev, [num]: val }))
  }

  if (estado === 'idle') {
    return (
      <button
        onClick={generar}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all active:scale-95"
        style={{ backgroundColor: '#1e3a8a10', color: '#1e3a8a', border: '1px solid #1e3a8a30' }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>exercise</span>
        Practicar
      </button>
    )
  }

  if (estado === 'loading') {
    return (
      <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg" style={{ backgroundColor: '#f8fafc' }}>
        <span className="material-symbols-outlined animate-spin" style={{ fontSize: 16, color: '#94a3b8' }}>progress_activity</span>
        <span className="text-[12px]" style={{ color: '#94a3b8' }}>Generando ejercicios con IA...</span>
      </div>
    )
  }

  if (estado === 'error') {
    return (
      <div className="mt-3 px-3 py-2 rounded-lg flex items-center gap-2" style={{ backgroundColor: '#fef2f2' }}>
        <span className="text-[12px]" style={{ color: '#dc2626' }}>Error: {error}</span>
        <button onClick={() => setEstado('idle')} className="text-[11px] underline" style={{ color: '#dc2626' }}>Reintentar</button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="mt-3 space-y-3 pt-3" style={{ borderTop: '1px solid #f1f5f9' }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-bold" style={{ color: '#1e293b' }}>{data.titulo}</p>
          <p className="text-[11px]" style={{ color: '#94a3b8' }}>5 ejercicios · generados por IA</p>
        </div>
        <button onClick={generar} className="text-[11px]" style={{ color: '#94a3b8' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
        </button>
      </div>

      {/* Ejercicios */}
      {data.ejercicios.map((ej) => {
        const esMC = ej.tipo === 'seleccion' && ej.alternativas?.length
        const esVF = ej.tipo === 'verdadero_falso'
        const tieneRespuesta = !!ej.respuesta
        const revelado = revelados.has(ej.numero)
        const respUsuario = respuestas[ej.numero] || ''
        const correcta = revelado && respUsuario && ej.respuesta
          ? respUsuario.toLowerCase().includes(ej.respuesta.toLowerCase().slice(0, 3))
          : null

        return (
          <div key={ej.numero} className="rounded-xl p-3 space-y-2"
            style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>

            {/* Número + tipo */}
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black"
                style={{ backgroundColor: '#1e3a8a', color: '#fff' }}>
                {ej.numero}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: '#94a3b8' }}>
                {ej.tipo?.replace('_', ' ')}
              </span>
            </div>

            {/* Enunciado */}
            <p className="text-[13px] leading-5" style={{ color: '#1e293b' }}>{ej.enunciado}</p>

            {/* Alternativas (selección múltiple) */}
            {esMC && (
              <div className="space-y-1">
                {ej.alternativas!.map((alt, i) => {
                  const letra = alt.slice(0, 1)
                  const esSeleccionada = respUsuario === letra
                  const esCorrecta = revelado && ej.respuesta?.toUpperCase().startsWith(letra.toUpperCase())
                  return (
                    <button key={i} onClick={() => !revelado && setResp(ej.numero, letra)}
                      className="w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all"
                      style={{
                        backgroundColor: esCorrecta ? '#dcfce7' : esSeleccionada ? '#eff6ff' : '#ffffff',
                        border: `1px solid ${esCorrecta ? '#86efac' : esSeleccionada ? '#bfdbfe' : '#e2e8f0'}`,
                        color: '#1e293b',
                      }}>
                      {alt}
                    </button>
                  )
                })}
              </div>
            )}

            {/* V/F */}
            {esVF && (
              <div className="flex gap-2">
                {['Verdadero', 'Falso'].map(op => {
                  const esSeleccionada = respUsuario === op
                  const esCorrecta = revelado && ej.respuesta?.toLowerCase() === op.toLowerCase()
                  return (
                    <button key={op} onClick={() => !revelado && setResp(ej.numero, op)}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all"
                      style={{
                        backgroundColor: esCorrecta ? '#dcfce7' : esSeleccionada ? '#eff6ff' : '#f8fafc',
                        border: `1px solid ${esCorrecta ? '#86efac' : esSeleccionada ? '#bfdbfe' : '#e2e8f0'}`,
                        color: esCorrecta ? '#16a34a' : '#475569',
                      }}>
                      {op}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Respuesta libre */}
            {!esMC && !esVF && (
              <textarea
                placeholder="Escribe tu respuesta..."
                value={respUsuario}
                onChange={e => setResp(ej.numero, e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-[12px] resize-none outline-none"
                style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', color: '#1e293b' }}
              />
            )}

            {/* Footer: pista + revelar */}
            <div className="flex items-center justify-between pt-1">
              {ej.pista && !revelado && (
                <p className="text-[10px] italic" style={{ color: '#94a3b8' }}>
                  💡 {ej.pista}
                </p>
              )}
              {revelado && ej.respuesta && (
                <p className="text-[11px] font-semibold" style={{ color: '#16a34a' }}>
                  ✓ {ej.respuesta}
                </p>
              )}
              <div className="ml-auto">
                {tieneRespuesta && !revelado && (
                  <button onClick={() => revelar(ej.numero)}
                    className="text-[11px] px-2 py-1 rounded-lg font-semibold"
                    style={{ backgroundColor: '#f1f5f9', color: '#64748b' }}>
                    Ver respuesta
                  </button>
                )}
                {correcta !== null && (
                  <span className="text-[11px] font-bold" style={{ color: correcta ? '#16a34a' : '#ef4444' }}>
                    {correcta ? '✓ Correcto' : '✗ Revisa'}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* Consejo */}
      {data.consejo && (
        <div className="px-3 py-2 rounded-lg flex items-start gap-2"
          style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 14, color: '#16a34a' }}>lightbulb</span>
          <p className="text-[11px] leading-4" style={{ color: '#166534' }}>{data.consejo}</p>
        </div>
      )}

      <button onClick={() => setEstado('idle')} className="text-[11px]" style={{ color: '#94a3b8' }}>
        ← Cerrar ejercicios
      </button>
    </div>
  )
}

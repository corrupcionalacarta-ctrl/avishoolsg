'use client'

import { useState } from 'react'

type UrgItem = { titulo: string; detalle: string; dia?: string }

function MarcarModal({ item, tipo, onClose, onDone }: {
  item: UrgItem
  tipo: string
  onClose: () => void
  onDone: (titulo: string) => void
}) {
  const [porcentaje, setPorcentaje] = useState(100)
  const [nota, setNota] = useState('')
  const [loading, setLoading] = useState(false)

  async function guardar() {
    setLoading(true)
    await fetch('/api/acciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_titulo: item.titulo, item_tipo: tipo, porcentaje, nota_padre: nota || null }),
    })
    setLoading(false)
    onDone(item.titulo)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-2xl p-6 space-y-4"
        style={{ backgroundColor: '#fff' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-bold" style={{ color: '#1e293b' }}>Marcar acción</h3>
          <button onClick={onClose} className="text-gray-400">✕</button>
        </div>
        <p className="text-[13px] font-semibold" style={{ color: '#475569' }}>{item.titulo}</p>

        {/* Porcentaje */}
        <div className="space-y-1">
          <div className="flex justify-between text-[12px]" style={{ color: '#94a3b8' }}>
            <span>¿Cuánto se cumplió?</span>
            <span className="font-bold" style={{ color: porcentaje === 100 ? '#0d9488' : '#d97706' }}>{porcentaje}%</span>
          </div>
          <input type="range" min={0} max={100} step={10} value={porcentaje}
            onChange={e => setPorcentaje(Number(e.target.value))}
            className="w-full accent-teal-600" />
          <div className="flex justify-between text-[10px]" style={{ color: '#cbd5e1' }}>
            <span>Sin cumplir</span><span>Parcial</span><span>Completo</span>
          </div>
        </div>

        {/* Nota */}
        <div className="space-y-1">
          <label className="text-[12px] font-semibold" style={{ color: '#94a3b8' }}>¿Cómo? (opcional)</label>
          <textarea value={nota} onChange={e => setNota(e.target.value)}
            placeholder="Ej: Firmé la autorización y la entregué a Clemente"
            className="w-full text-[13px] rounded-xl border p-3 resize-none focus:outline-none"
            style={{ borderColor: '#e2e8f0', color: '#1e293b', minHeight: 72 }} />
        </div>

        <button onClick={guardar} disabled={loading}
          className="w-full py-3 rounded-xl text-[14px] font-bold text-white"
          style={{ backgroundColor: porcentaje === 100 ? '#0d9488' : '#d97706', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Guardando...' : porcentaje === 100 ? '✓ Marcar como cumplida' : '◑ Guardar progreso'}
        </button>
      </div>
    </div>
  )
}

export default function UrgentesSection({ urgentes, tipo = 'urgente' }: { urgentes: UrgItem[]; tipo?: string }) {
  const [modal, setModal] = useState<UrgItem | null>(null)
  const [cumplidas, setCumplidas] = useState<Set<string>>(new Set())

  if (!urgentes.length) return null

  const color = tipo === 'urgente' ? '#ef4444' : '#7c3aed'
  const bg    = tipo === 'urgente' ? '#fef2f2' : '#faf5ff'
  const bord  = tipo === 'urgente' ? '#fca5a5' : '#e9d5ff'
  const icon  = tipo === 'urgente' ? 'warning'  : 'info'
  const label = tipo === 'urgente' ? 'Requieren Acción' : 'Importante esta semana'

  return (
    <>
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: color }} />
          <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>{label}</h2>
        </div>

        {urgentes.map((u, i) => {
          const done = cumplidas.has(u.titulo)
          return (
            <details key={i} className="rounded-xl overflow-hidden group"
              style={{ backgroundColor: done ? '#f0fdf4' : bg, border: `1px solid ${done ? '#86efac' : bord}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', opacity: done ? 0.7 : 1 }}>
              <summary className="p-4 flex items-start gap-3 cursor-pointer list-none">
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: done ? '#16a34a' : color, fontSize: 18 }}>
                  {done ? 'check_circle' : icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold" style={{ color: '#1e293b', textDecoration: done ? 'line-through' : 'none' }}>{u.titulo}</p>
                  {u.dia && !done && (
                    <p className="text-[11px] mt-0.5 uppercase font-semibold" style={{ color }}>{u.dia}</p>
                  )}
                  {done && <p className="text-[11px] mt-0.5 font-semibold" style={{ color: '#16a34a' }}>Registrada ✓</p>}
                </div>
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5 transition-transform group-open:rotate-180"
                  style={{ color: '#94a3b8', fontSize: 18 }}>expand_more</span>
              </summary>
              <div className="px-4 pb-4 pt-2 space-y-3" style={{ borderTop: `1px solid ${bord}44` }}>
                <p className="text-[13px] leading-5" style={{ color: '#475569' }}>{u.detalle}</p>
                {!done && (
                  <button onClick={() => setModal(u)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold text-white"
                    style={{ backgroundColor: color }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>check_circle</span>
                    Marcar cumplida
                  </button>
                )}
              </div>
            </details>
          )
        })}
      </section>

      {modal && (
        <MarcarModal item={modal} tipo={tipo}
          onClose={() => setModal(null)}
          onDone={titulo => setCumplidas(prev => new Set([...prev, titulo]))} />
      )}
    </>
  )
}

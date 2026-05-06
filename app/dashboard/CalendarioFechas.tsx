'use client'

import { useState } from 'react'

type FechaItem = {
  titulo: string
  fecha_evento: string
  asignatura?: string | null
  alumno?: string | null
  detalle?: string | null
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
               'Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS  = ['L','M','X','J','V','S','D']

function alumnoColor(alumno: string | null | undefined): string {
  if (!alumno) return '#64748b'
  return alumno.toLowerCase().includes('raimundo') ? '#7c3aed' : '#1e3a8a'
}

function tipoIcon(titulo: string, detalle?: string | null): string {
  const t = (titulo + ' ' + (detalle || '')).toLowerCase()
  if (t.includes('prueba') || t.includes('control')) return '📝'
  if (t.includes('entrega') || t.includes('trabajo')) return '📋'
  if (t.includes('reuni') || t.includes('citaci')) return '👥'
  if (t.includes('acto') || t.includes('ceremonia')) return '🎭'
  return '•'
}

export default function CalendarioFechas({
  fechas,
  titulo = 'Próximas Fechas',
  accentColor = '#1e3a8a',
}: {
  fechas: FechaItem[]
  titulo?: string
  accentColor?: string
}) {
  const today = new Date()
  const [offset, setOffset] = useState(0)

  const viewDate = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const mesStr = `${year}-${String(month + 1).padStart(2, '0')}`
  const hoyStr = today.toISOString().split('T')[0]

  if (fechas.length === 0) return null

  // Build events map
  const byDate: Record<string, FechaItem[]> = {}
  for (const f of fechas) {
    if (!byDate[f.fecha_evento]) byDate[f.fecha_evento] = []
    byDate[f.fecha_evento].push(f)
  }

  // Build calendar grid
  const firstDay   = new Date(year, month, 1)
  const lastDay    = new Date(year, month + 1, 0)
  const startOffset = (firstDay.getDay() + 6) % 7   // 0=Mon
  const totalDays  = lastDay.getDate()
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  // Events this month for the bottom list
  const eventosDelMes = fechas
    .filter(f => f.fecha_evento.startsWith(mesStr))
    .sort((a, b) => a.fecha_evento.localeCompare(b.fecha_evento))

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: accentColor }} />
        <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>{titulo}</h2>
      </div>

      <div className="rounded-2xl overflow-hidden"
        style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>

        {/* Month navigation */}
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid #f1f5f9' }}>
          <button onClick={() => setOffset(o => o - 1)}
            className="w-7 h-7 rounded-full flex items-center justify-center active:bg-slate-100"
            style={{ color: '#94a3b8' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
          </button>
          <p className="text-[14px] font-bold capitalize" style={{ color: '#1e293b' }}>
            {MESES[month]} {year}
          </p>
          <button onClick={() => setOffset(o => o + 1)}
            className="w-7 h-7 rounded-full flex items-center justify-center active:bg-slate-100"
            style={{ color: '#94a3b8' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 px-1 pt-2" style={{ borderBottom: '1px solid #f1f5f9' }}>
          {DIAS.map(d => (
            <div key={d} className="text-center pb-1">
              <span className="text-[10px] font-bold uppercase" style={{ color: '#cbd5e1' }}>{d}</span>
            </div>
          ))}
        </div>

        {/* Calendar grid — events inside cells */}
        <div className="px-1 pb-2">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7"
              style={{ borderBottom: wi < weeks.length - 1 ? '1px solid #f8fafc' : 'none' }}>
              {week.map((day, di) => {
                if (!day) return <div key={di} className="py-1" />
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const events  = byDate[dateStr] ?? []
                const isToday = dateStr === hoyStr
                const isWeekend = di >= 5

                return (
                  <div key={di} className="py-1 px-0.5 min-h-[52px]"
                    style={{ backgroundColor: isToday ? '#eff6ff' : 'transparent',
                             outline: isToday ? '2px solid #3b82f6' : 'none',
                             outlineOffset: '-1px', borderRadius: isToday ? 6 : 0 }}>
                    {/* Day number */}
                    <p className="text-[11px] font-bold text-center mb-0.5 leading-tight"
                      style={{ color: isToday ? '#1e3a8a' : isWeekend ? '#94a3b8' : '#475569' }}>
                      {day}
                    </p>
                    {/* Events */}
                    {events.slice(0, 2).map((ev, ei) => {
                      const color = alumnoColor(ev.alumno)
                      const slug  = ev.alumno?.split(' ')[0] ?? ''
                      const asig  = (ev.asignatura || ev.titulo || '').split(' ').slice(0, 2).join(' ')
                      return (
                        <div key={ei} className="rounded px-1 py-0.5 mb-0.5 leading-tight"
                          style={{ backgroundColor: color + '15' }}>
                          <p className="text-[9px] font-bold truncate" style={{ color }}>{slug}</p>
                          <p className="text-[8.5px] truncate leading-tight" style={{ color: '#475569' }}>{asig}</p>
                        </div>
                      )
                    })}
                    {events.length > 2 && (
                      <p className="text-[8px] text-center" style={{ color: '#94a3b8' }}>+{events.length - 2}</p>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Event list for this month */}
        {eventosDelMes.length > 0 && (
          <div style={{ borderTop: '1px solid #e2e8f0' }}>
            {Object.entries(
              eventosDelMes.reduce<Record<string, FechaItem[]>>((acc, f) => {
                if (!acc[f.fecha_evento]) acc[f.fecha_evento] = []
                acc[f.fecha_evento].push(f)
                return acc
              }, {})
            ).sort(([a], [b]) => a.localeCompare(b)).map(([dateStr, evs]) => {
              const d = new Date(dateStr + 'T12:00:00')
              const daysLeft = Math.ceil((d.getTime() - Date.now()) / 86400000)
              const badge = daysLeft < 0 ? null : daysLeft === 0 ? 'HOY' : daysLeft === 1 ? 'MÑN' : `${daysLeft}d`
              const badgeColor = daysLeft <= 0 ? '#ef4444' : daysLeft <= 2 ? '#d97706' : '#64748b'

              return (
                <div key={dateStr} className="flex gap-3 px-4 py-2.5"
                  style={{ borderBottom: '1px solid #f8fafc' }}>
                  {/* Date column */}
                  <div className="w-9 flex-shrink-0 text-center">
                    <p className="text-[10px] font-semibold uppercase" style={{ color: '#94a3b8' }}>
                      {d.toLocaleDateString('es-CL', { weekday: 'short' })}
                    </p>
                    <p className="text-[17px] font-black leading-tight" style={{ color: '#1e293b' }}>
                      {d.getDate()}
                    </p>
                  </div>
                  <div className="w-px self-stretch flex-shrink-0" style={{ backgroundColor: '#e2e8f0' }} />
                  {/* Events */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {evs.map((ev, i) => {
                      const color = alumnoColor(ev.alumno)
                      const slug  = ev.alumno?.split(' ')[0] ?? ''
                      return (
                        <div key={i} className="flex items-start gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                            style={{ backgroundColor: color }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold leading-snug" style={{ color: '#1e293b' }}>
                              {ev.titulo}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {ev.asignatura && (
                                <span className="text-[10px]" style={{ color: '#94a3b8' }}>{ev.asignatura}</span>
                              )}
                              {ev.alumno && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white"
                                  style={{ backgroundColor: color }}>
                                  {slug}
                                </span>
                              )}
                            </div>
                          </div>
                          {badge && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ color: badgeColor, border: `1px solid ${badgeColor}`, backgroundColor: badgeColor + '12' }}>
                              {badge}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {eventosDelMes.length === 0 && (
          <div className="py-6 text-center" style={{ borderTop: '1px solid #e2e8f0' }}>
            <p className="text-[12px]" style={{ color: '#94a3b8' }}>Sin eventos este mes</p>
          </div>
        )}
      </div>
    </section>
  )
}

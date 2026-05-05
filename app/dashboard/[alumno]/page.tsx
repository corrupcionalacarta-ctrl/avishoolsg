import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import CalendarioFechas from '../CalendarioFechas'

export const dynamic = 'force-dynamic'

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes']

type NotaRow = {
  asignatura: string
  tipo: string | null
  nota: number | null
  promedio_curso: number | null
  descripcion: string | null
}

type FechaRow = {
  titulo: string
  fecha_evento: string
  asignatura: string | null
}

type AnotacionRow = {
  titulo: string | null
  descripcion: string | null
  fecha: string | null
  tipo: string | null
}

type HorarioRow = {
  dia: string
  bloque: number | null
  hora_inicio: string | null
  hora_fin: string | null
  asignatura: string
  sala: string
  tipo: string
}

type AsistenciaRow = {
  asistencia_pct: number | null
  inasistencias: number | null
  horas_efectuadas: number | null
  foto_b64: string | null
  prof_jefe: string | null
}

const ALUMNOS: Record<string, { nombre: string; curso: string; color: string; initial: string }> = {
  clemente: { nombre: 'Clemente Aravena', curso: '6° D', color: '#1e3a8a', initial: 'C' },
  raimundo: { nombre: 'Raimundo Aravena', curso: '4° A', color: '#7c3aed', initial: 'R' },
}

function notaColor(nota: number | null) {
  if (!nota) return '#94a3b8'
  if (nota >= 6) return '#0d9488'
  if (nota >= 5) return '#7c3aed'
  return '#ef4444'
}

function diaHoy(): string {
  const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  return dias[new Date().getDay()]
}

// SVG Gauge for conduct (semicircle 180°)
function ConductaGauge({
  positivas, negativas, observaciones, color,
}: { positivas: number; negativas: number; observaciones: number; color: string }) {
  const total = positivas + negativas + observaciones
  if (total === 0) return null

  // Semicircle arc helper (r=40, center=50,50, start at left=180°, end at right=0°)
  const R = 40
  const cx = 50
  const cy = 52
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const arcPath = (startDeg: number, endDeg: number) => {
    const start = { x: cx + R * Math.cos(toRad(startDeg)), y: cy + R * Math.sin(toRad(startDeg)) }
    const end = { x: cx + R * Math.cos(toRad(endDeg)), y: cy + R * Math.sin(toRad(endDeg)) }
    const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
    return `M ${start.x} ${start.y} A ${R} ${R} 0 ${large} 1 ${end.x} ${end.y}`
  }

  // Map values to degrees (180° = left, 0° = right, going clockwise from left through bottom)
  const posAngle = (positivas / total) * 180
  const negAngle = (negativas / total) * 180
  const obsAngle = (observaciones / total) * 180

  // Draw from 180° to 0°, clockwise (so add angles left→right)
  const seg1End = 180 - posAngle
  const seg2End = seg1End - negAngle

  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 100 56" width="140" height="80">
        {/* Background arc */}
        <path d={arcPath(180, 0)} fill="none" stroke="#f1f5f9" strokeWidth="10" strokeLinecap="round" />
        {/* Observaciones arc (gray) */}
        {observaciones > 0 && (
          <path d={arcPath(180, seg2End - obsAngle)} fill="none" stroke="#cbd5e1" strokeWidth="10" strokeLinecap="round" />
        )}
        {/* Negativas arc (red) */}
        {negativas > 0 && (
          <path d={arcPath(180, seg1End)} fill="none" stroke="#ef4444" strokeWidth="10" strokeLinecap="round" />
        )}
        {/* Positivas arc (green) */}
        {positivas > 0 && (
          <path d={arcPath(180, 180 - posAngle)} fill="none" stroke="#0d9488" strokeWidth="10" strokeLinecap="round" />
        )}
        {/* Center text */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="16" fontWeight="700" fill="#1e293b">{total}</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize="7" fill="#94a3b8">registros</text>
      </svg>

      {/* Legend */}
      <div className="flex gap-3 text-center">
        <div>
          <p className="text-[18px] font-bold" style={{ color: '#0d9488' }}>{positivas}</p>
          <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#0d9488' }}>Positivas</p>
        </div>
        <div>
          <p className="text-[18px] font-bold" style={{ color: '#94a3b8' }}>{observaciones}</p>
          <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#94a3b8' }}>Neutras</p>
        </div>
        <div>
          <p className="text-[18px] font-bold" style={{ color: '#ef4444' }}>{negativas}</p>
          <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#ef4444' }}>Negativas</p>
        </div>
      </div>
    </div>
  )
}

export default async function AlumnoPage({ params }: { params: Promise<{ alumno: string }> }) {
  const { alumno: slugRaw } = await params
  const slug = slugRaw.toLowerCase()
  const alumno = ALUMNOS[slug]
  if (!alumno) notFound()

  const hoy = new Date().toISOString().split('T')[0]
  const primerNombre = alumno.nombre.split(' ')[0]
  const diaActual = diaHoy()

  const [notasRes, fechasRes, anotacionesRes, horarioRes, asistenciaRes] = await Promise.all([
    supabase
      .from('notas')
      .select('asignatura, tipo, nota, promedio_curso, descripcion')
      .ilike('alumno', `%${primerNombre}%`)
      .order('extraido_en', { ascending: false })
      .limit(40),
    supabase
      .from('items_colegio')
      .select('titulo, fecha_evento, asignatura')
      .ilike('alumno', `%${primerNombre}%`)
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', hoy)
      .order('fecha_evento')
      .limit(20),
    supabase
      .from('anotaciones')
      .select('titulo, descripcion, fecha, tipo')
      .ilike('alumno', `%${primerNombre}%`)
      .order('fecha', { ascending: false })
      .limit(30),
    supabase
      .from('horario')
      .select('dia, bloque, hora_inicio, hora_fin, asignatura, sala, tipo')
      .ilike('alumno', `%${primerNombre}%`)
      .order('bloque', { ascending: true }),
    supabase
      .from('asistencia')
      .select('asistencia_pct, inasistencias, horas_efectuadas, foto_b64, prof_jefe')
      .ilike('alumno', `%${primerNombre}%`)
      .maybeSingle(),
  ])

  const notas = (notasRes.data as NotaRow[] ?? [])
  const fechas = (fechasRes.data as FechaRow[] ?? [])
    .filter(f => {
      if (!f.titulo?.trim() || !f.fecha_evento) return false
      const d = new Date(f.fecha_evento + 'T12:00:00')
      return !isNaN(d.getTime())
    })
  const anotaciones = (anotacionesRes.data as AnotacionRow[] ?? [])
  const horarioRaw = (horarioRes.data as HorarioRow[] ?? [])
  const asistencia = (asistenciaRes.data as AsistenciaRow | null)

  const negativas = anotaciones.filter(a => a.tipo === 'negativa')
  const positivas = anotaciones.filter(a => a.tipo === 'positiva')
  const observaciones = anotaciones.filter(a => a.tipo === 'observacion')

  const promedio = notas.filter(n => n.nota).length > 0
    ? (notas.filter(n => n.nota).reduce((a, n) => a + (n.nota ?? 0), 0) / notas.filter(n => n.nota).length).toFixed(1)
    : null

  const notasPorAsignatura: Record<string, NotaRow[]> = {}
  for (const n of notas) {
    if (!notasPorAsignatura[n.asignatura]) notasPorAsignatura[n.asignatura] = []
    notasPorAsignatura[n.asignatura].push(n)
  }

  const horarioPorDia: Record<string, HorarioRow[]> = {}
  for (const dia of DIAS) horarioPorDia[dia] = []
  for (const h of horarioRaw) {
    const d = h.dia.toLowerCase().replace('é', 'e').replace('á', 'a')
    if (horarioPorDia[d]) horarioPorDia[d].push(h)
  }

  const tipoHorarioColor = (tipo: string) => {
    if (tipo === 'recreo') return { bg: '#f0fdfa', border: '#99f6e4', text: '#0d9488' }
    if (tipo === 'almuerzo') return { bg: '#f5f3ff', border: '#ddd6fe', text: '#7c3aed' }
    return { bg: '#ffffff', border: '#e2e8f0', text: '#1e293b' }
  }

  return (
    <div className="space-y-5 mt-4">

      {/* SELECTOR ALUMNOS */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-widest shrink-0" style={{ color: '#94a3b8' }}>
          {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <div className="flex items-center gap-1">
          {Object.entries(ALUMNOS).map(([key, a]) => (
            <Link key={key} href={`/dashboard/${key}`}
              className="px-3 py-1 rounded-full text-[12px] font-bold transition-all"
              style={{
                backgroundColor: key === slug ? a.color : '#f1f5f9',
                color: key === slug ? '#ffffff' : '#94a3b8',
                border: `1px solid ${key === slug ? a.color : '#e2e8f0'}`,
              }}>
              {a.nombre.split(' ')[0]}
            </Link>
          ))}
        </div>
      </div>

      {/* PERFIL */}
      <section className="rounded-xl overflow-hidden"
        style={{ backgroundColor: alumno.color, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
        <div className="p-5 flex items-center gap-4">
          {asistencia?.foto_b64 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/foto_${slug}.jpg`}
              alt={primerNombre}
              className="w-14 h-14 rounded-full flex-shrink-0 object-cover"
              style={{ border: '2px solid rgba(255,255,255,0.4)' }}
            />
          ) : (
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-[24px] font-bold flex-shrink-0"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: '#ffffff' }}>
              {alumno.initial}
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white leading-tight">{alumno.nombre}</h1>
            <p className="text-[13px] mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {alumno.curso} · Colegio Georgian
            </p>
            {asistencia?.prof_jefe && (
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Prof. Jefe: {asistencia.prof_jefe.split(' ').slice(0, 2).join(' ')}
              </p>
            )}
          </div>
          {promedio && (
            <div className="text-center px-3 py-2 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-white opacity-75">Prom.</p>
              <p className="text-[28px] font-bold text-white leading-tight">{promedio}</p>
            </div>
          )}
        </div>

        {/* Stats bar */}
        {(asistencia?.asistencia_pct || negativas.length > 0 || fechas.length > 0) && (
          <div className="flex divide-x px-2 pb-3" style={{ borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.1)' }}>
            {asistencia?.asistencia_pct && (
              <div className="flex-1 text-center py-2">
                <p className="text-[16px] font-bold text-white">{asistencia.asistencia_pct}%</p>
                <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.6)' }}>Asistencia</p>
              </div>
            )}
            <div className="flex-1 text-center py-2">
              <p className="text-[16px] font-bold" style={{ color: negativas.length > 0 ? '#fca5a5' : 'rgba(255,255,255,0.9)' }}>
                {negativas.length}
              </p>
              <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.6)' }}>Anotaciones</p>
            </div>
            <div className="flex-1 text-center py-2">
              <p className="text-[16px] font-bold text-white">{fechas.length}</p>
              <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.6)' }}>Próx. fechas</p>
            </div>
          </div>
        )}
      </section>

      {/* ANOTACIONES NEGATIVAS */}
      {negativas.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#ef4444' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Anotaciones Negativas</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: '#fef2f2', color: '#ef4444', border: '1px solid #fca5a5' }}>
              {negativas.length}
            </span>
          </div>
          <div className="space-y-2">
            {negativas.map((a, i) => (
              <div key={i} className="rounded-xl p-4"
                style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5' }}>
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined flex-shrink-0 mt-0.5"
                    style={{ color: '#ef4444', fontSize: 16 }}>report</span>
                  <div className="flex-1">
                    {a.titulo && <p className="text-[13px] font-bold" style={{ color: '#1e293b' }}>{a.titulo}</p>}
                    {a.descripcion && (
                      <p className="text-[12px] mt-0.5 leading-5" style={{ color: '#475569' }}>{a.descripcion}</p>
                    )}
                    {a.fecha && <p className="text-[10px] mt-1" style={{ color: '#94a3b8' }}>{a.fecha}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CONDUCTA — resumen gauge */}
      {anotaciones.length > 0 && (
        <section className="rounded-xl p-4 space-y-3"
          style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ color: '#0d9488', fontSize: 18 }}>emoji_events</span>
            <h2 className="text-[15px] font-semibold" style={{ color: '#1e293b' }}>Registros del estudiante</h2>
          </div>

          <div className="flex items-center justify-center">
            <ConductaGauge
              positivas={positivas.length}
              negativas={negativas.length}
              observaciones={observaciones.length}
              color={alumno.color}
            />
          </div>

          {/* Positivas + Observaciones (colapsable) */}
          {(positivas.length > 0 || observaciones.length > 0) && (
            <details className="rounded-lg overflow-hidden"
              style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <summary className="px-3 py-2.5 cursor-pointer list-none flex items-center justify-between">
                <span className="text-[13px] font-semibold" style={{ color: '#475569' }}>
                  Ver positivas y observaciones
                </span>
                <span className="material-symbols-outlined" style={{ color: '#94a3b8', fontSize: 16 }}>expand_more</span>
              </summary>
              <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid #e2e8f0' }}>
                {[...positivas, ...observaciones].map((a, i) => (
                  <div key={i} className="pt-2">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                        style={a.tipo === 'positiva'
                          ? { backgroundColor: '#f0fdf4', color: '#0d9488', border: '1px solid #99f6e4' }
                          : { backgroundColor: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0' }}>
                        {a.tipo === 'positiva' ? 'Positiva' : 'Observación'}
                      </span>
                      {a.fecha && <span className="text-[10px]" style={{ color: '#cbd5e1' }}>{a.fecha}</span>}
                    </div>
                    {a.titulo && <p className="text-[13px] font-semibold" style={{ color: '#1e293b' }}>{a.titulo}</p>}
                    {a.descripcion && <p className="text-[12px] mt-0.5" style={{ color: '#94a3b8' }}>{a.descripcion}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {/* PRÓXIMAS FECHAS — calendario */}
      <CalendarioFechas
        fechas={fechas}
        titulo="Próximas Fechas"
        accentColor={alumno.color}
      />

      {/* NOTAS POR ASIGNATURA */}
      {Object.keys(notasPorAsignatura).length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#7c3aed' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Calificaciones</h2>
          </div>
          <div className="rounded-xl overflow-hidden"
            style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            {Object.entries(notasPorAsignatura).map(([asig, notasAsig], idx) => (
              <div key={asig}
                style={{ borderTop: idx > 0 ? '1px solid #f1f5f9' : 'none' }}>
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: '#1e293b' }}>{asig}</p>
                    {notasAsig[0]?.promedio_curso && (
                      <p className="text-[11px]" style={{ color: '#94a3b8' }}>
                        Promedio curso: {notasAsig[0].promedio_curso}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3 items-center">
                    {notasAsig.slice(0, 4).map((n, i) => (
                      <div key={i} className="text-center">
                        <p className="text-[20px] font-bold leading-tight" style={{ color: notaColor(n.nota) }}>
                          {n.nota ?? '–'}
                        </p>
                        {n.descripcion && notasAsig.length > 1 && (
                          <p className="text-[9px] max-w-[44px] truncate" style={{ color: '#94a3b8' }}>
                            {n.descripcion}
                          </p>
                        )}
                      </div>
                    ))}
                    {notasAsig.length > 4 && (
                      <span className="text-[11px]" style={{ color: '#94a3b8' }}>+{notasAsig.length - 4}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* HORARIO SEMANAL */}
      {horarioRaw.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#0d9488' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Horario Semanal</h2>
          </div>

          {DIAS.map(dia => {
            const bloques = horarioPorDia[dia]
            if (!bloques || bloques.length === 0) return null
            const esHoy = dia === diaActual || (dia === 'miercoles' && diaActual === 'miércoles')
            return (
              <details key={dia} open={esHoy}
                className="rounded-xl overflow-hidden"
                style={{ backgroundColor: '#ffffff', border: `1px solid ${esHoy ? '#99f6e4' : '#e2e8f0'}`, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <summary className="px-4 py-3 cursor-pointer list-none flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold capitalize" style={{ color: esHoy ? '#0d9488' : '#1e293b' }}>
                      {dia.charAt(0).toUpperCase() + dia.slice(1)}
                    </span>
                    {esHoy && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                        style={{ backgroundColor: '#f0fdfa', color: '#0d9488' }}>HOY</span>
                    )}
                    <span className="text-[11px]" style={{ color: '#94a3b8' }}>
                      {bloques.filter(b => b.tipo === 'clase').length} bloques
                    </span>
                  </div>
                  <span className="material-symbols-outlined" style={{ color: '#94a3b8', fontSize: 18 }}>expand_more</span>
                </summary>

                <div style={{ borderTop: '1px solid #e2e8f0' }}>
                  {bloques.map((b, i) => {
                    const c = tipoHorarioColor(b.tipo)
                    return (
                      <div key={i} className="px-4 py-2.5 flex items-center gap-3"
                        style={{ backgroundColor: c.bg, borderTop: i > 0 ? '1px solid #f8fafc' : 'none' }}>
                        <div className="w-20 flex-shrink-0">
                          {b.hora_inicio && b.hora_fin ? (
                            <p className="text-[11px] font-semibold tabular-nums" style={{ color: '#94a3b8' }}>
                              {b.hora_inicio}–{b.hora_fin}
                            </p>
                          ) : b.bloque && (
                            <p className="text-[11px]" style={{ color: '#cbd5e1' }}>Bl. {b.bloque}</p>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {b.tipo === 'recreo' ? (
                            <p className="text-[13px] font-semibold" style={{ color: c.text }}>Recreo</p>
                          ) : b.tipo === 'almuerzo' ? (
                            <p className="text-[13px] font-semibold" style={{ color: c.text }}>Almuerzo</p>
                          ) : (
                            <p className="text-[13px] font-semibold truncate" style={{ color: '#1e293b' }}>
                              {b.asignatura || '—'}
                            </p>
                          )}
                        </div>
                        {b.sala && b.tipo === 'clase' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ backgroundColor: '#f1f5f9', color: '#94a3b8' }}>
                            {b.sala}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </details>
            )
          })}
        </section>
      )}

      {/* EMPTY STATE */}
      {notas.length === 0 && fechas.length === 0 && anotaciones.length === 0 && horarioRaw.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#cbd5e1' }}>school</span>
          <p className="font-semibold" style={{ color: '#94a3b8' }}>Sin datos para {primerNombre}</p>
          <p className="text-[13px]" style={{ color: '#cbd5e1' }}>Corre el pipeline de SchoolNet para sincronizar</p>
        </div>
      )}

    </div>
  )
}

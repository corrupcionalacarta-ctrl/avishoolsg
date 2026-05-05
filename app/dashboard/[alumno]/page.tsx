import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import CalendarioFechas from '../CalendarioFechas'

export const dynamic = 'force-dynamic'

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes']
const DIAS_LABEL: Record<string, string> = {
  lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie'
}

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

export default async function AlumnoPage({ params }: { params: Promise<{ alumno: string }> }) {
  const { alumno: slugRaw } = await params
  const slug = slugRaw.toLowerCase()
  const alumno = ALUMNOS[slug]
  if (!alumno) notFound()

  const hoy = new Date().toISOString().split('T')[0]
  const primerNombre = alumno.nombre.split(' ')[0]
  const diaActual = diaHoy()

  const [notasRes, fechasRes, anotacionesRes, horarioRes] = await Promise.all([
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

  // Horario por día
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

      {/* HEADER con tabs */}
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
      <section className="rounded-xl p-5 flex items-center gap-4"
        style={{ backgroundColor: '#ffffff', border: `1px solid ${alumno.color}33`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-[24px] font-bold text-white flex-shrink-0"
          style={{ backgroundColor: alumno.color }}>
          {alumno.initial}
        </div>
        <div className="flex-1">
          <h1 className="text-[20px] font-bold" style={{ color: '#1e293b' }}>{alumno.nombre}</h1>
          <p className="text-[13px]" style={{ color: '#94a3b8' }}>{alumno.curso} — Colegio Georgian</p>
        </div>
        {promedio && (
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: '#94a3b8' }}>Promedio</p>
            <p className="text-[32px] font-bold leading-tight" style={{ color: notaColor(parseFloat(promedio)) }}>
              {promedio}
            </p>
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
              style={{ backgroundColor: '#fef2f2', color: '#ef4444', border: '1px solid #fca5a5' }}>{negativas.length}</span>
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
                    {a.descripcion && <p className="text-[12px] mt-0.5 leading-5" style={{ color: '#475569' }}>{a.descripcion}</p>}
                    {a.fecha && <p className="text-[10px] mt-1" style={{ color: '#94a3b8' }}>{a.fecha}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ANOTACIONES POSITIVAS + OBSERVACIONES (colapsables) */}
      {(positivas.length > 0 || observaciones.length > 0) && (
        <details className="rounded-xl overflow-hidden"
          style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <summary className="px-4 py-3 cursor-pointer list-none flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: '#0d9488', fontSize: 18 }}>check_circle</span>
              <span className="text-[14px] font-semibold" style={{ color: '#1e293b' }}>
                Conducta — {positivas.length} positivas · {observaciones.length} observaciones
              </span>
            </div>
            <span className="material-symbols-outlined" style={{ color: '#94a3b8', fontSize: 18 }}>expand_more</span>
          </summary>
          <div className="px-4 pb-4 space-y-2" style={{ borderTop: '1px solid #e2e8f0' }}>
            {[...positivas, ...observaciones].map((a, i) => (
              <div key={i} className="pt-2">
                {a.titulo && <p className="text-[13px] font-semibold" style={{ color: '#1e293b' }}>{a.titulo}</p>}
                {a.descripcion && <p className="text-[12px] mt-0.5" style={{ color: '#94a3b8' }}>{a.descripcion}</p>}
                {a.fecha && <p className="text-[10px] mt-0.5" style={{ color: '#cbd5e1' }}>{a.fecha}</p>}
              </div>
            ))}
          </div>
        </details>
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
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Notas por Asignatura</h2>
          </div>
          <div className="space-y-2">
            {Object.entries(notasPorAsignatura).map(([asig, notasAsig]) => (
              <div key={asig} className="rounded-xl p-4"
                style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] font-bold" style={{ color: '#1e293b' }}>{asig}</p>
                  {notasAsig.length > 1 && (
                    <p className="text-[11px]" style={{ color: '#94a3b8' }}>{notasAsig.length} notas</p>
                  )}
                </div>
                <div className="flex gap-4 overflow-x-auto hide-scrollbar">
                  {notasAsig.map((n, i) => (
                    <div key={i} className="flex-shrink-0 text-center min-w-[48px]">
                      <p className="text-[24px] font-bold leading-tight" style={{ color: notaColor(n.nota) }}>
                        {n.nota ?? '–'}
                      </p>
                      {n.descripcion && (
                        <p className="text-[10px] mt-0.5 max-w-[56px] truncate" style={{ color: '#94a3b8' }}>
                          {n.descripcion}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {notasAsig[0]?.promedio_curso && (
                  <p className="text-[11px] mt-3 pt-2" style={{ color: '#94a3b8', borderTop: '1px solid #e2e8f0' }}>
                    Promedio del curso: {notasAsig[0].promedio_curso}
                  </p>
                )}
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
                      {esHoy && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded font-bold"
                        style={{ backgroundColor: '#f0fdfa', color: '#0d9488' }}>HOY</span>}
                    </span>
                    <span className="text-[11px]" style={{ color: '#94a3b8' }}>
                      {bloques.filter(b => b.tipo === 'clase').length} bloques
                    </span>
                  </div>
                  <span className="material-symbols-outlined" style={{ color: '#94a3b8', fontSize: 18 }}>expand_more</span>
                </summary>

                <div className="divide-y" style={{ borderColor: '#e2e8f0', borderTop: '1px solid #e2e8f0' }}>
                  {bloques.map((b, i) => {
                    const c = tipoHorarioColor(b.tipo)
                    return (
                      <div key={i} className="px-4 py-2.5 flex items-center gap-3"
                        style={{ backgroundColor: c.bg }}>
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

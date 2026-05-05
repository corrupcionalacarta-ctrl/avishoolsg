import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { notFound } from 'next/navigation'

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
  clemente: { nombre: 'Clemente Aravena', curso: '6° D', color: '#1d4ed8', initial: 'C' },
  raimundo: { nombre: 'Raimundo Aravena', curso: '4° A', color: '#7c3aed', initial: 'R' },
}

function notaColor(nota: number | null) {
  if (!nota) return '#8e90a0'
  if (nota >= 6) return '#6bd8cb'
  if (nota >= 5) return '#d2bbff'
  return '#ffb4ab'
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
    if (tipo === 'recreo') return { bg: '#6bd8cb22', border: '#6bd8cb44', text: '#6bd8cb' }
    if (tipo === 'almuerzo') return { bg: '#b7c4ff22', border: '#b7c4ff44', text: '#b7c4ff' }
    return { bg: '#1e1f27', border: '#434655', text: '#e2e1ed' }
  }

  return (
    <div className="space-y-5 mt-4">

      {/* HEADER con tabs */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-widest shrink-0" style={{ color: '#8e90a0' }}>
          {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <div className="flex items-center gap-1">
          {Object.entries(ALUMNOS).map(([key, a]) => (
            <Link key={key} href={`/dashboard/${key}`}
              className="px-3 py-1 rounded-full text-[12px] font-bold transition-all"
              style={{
                backgroundColor: key === slug ? a.color : '#1e1f27',
                color: key === slug ? '#ffffff' : '#8e90a0',
                border: `1px solid ${key === slug ? a.color : '#434655'}`,
              }}>
              {a.nombre.split(' ')[0]}
            </Link>
          ))}
        </div>
      </div>

      {/* PERFIL */}
      <section className="rounded-xl p-5 flex items-center gap-4"
        style={{ backgroundColor: '#1e1f27', border: `1px solid ${alumno.color}` }}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-[24px] font-bold text-white flex-shrink-0"
          style={{ backgroundColor: alumno.color }}>
          {alumno.initial}
        </div>
        <div className="flex-1">
          <h1 className="text-[20px] font-bold" style={{ color: '#e2e1ed' }}>{alumno.nombre}</h1>
          <p className="text-[13px]" style={{ color: '#8e90a0' }}>{alumno.curso} — Colegio Georgian</p>
        </div>
        {promedio && (
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: '#8e90a0' }}>Promedio</p>
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
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#ffb4ab' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Anotaciones Negativas</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: '#93000a', color: '#ffdad6' }}>{negativas.length}</span>
          </div>
          <div className="space-y-2">
            {negativas.map((a, i) => (
              <div key={i} className="rounded-xl p-4"
                style={{ backgroundColor: '#1e1f27', border: '1px solid #93000a' }}>
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined flex-shrink-0 mt-0.5"
                    style={{ color: '#ffb4ab', fontSize: 16 }}>report</span>
                  <div className="flex-1">
                    {a.titulo && <p className="text-[13px] font-bold" style={{ color: '#e2e1ed' }}>{a.titulo}</p>}
                    {a.descripcion && <p className="text-[12px] mt-0.5 leading-5" style={{ color: '#c4c5d7' }}>{a.descripcion}</p>}
                    {a.fecha && <p className="text-[10px] mt-1" style={{ color: '#8e90a0' }}>{a.fecha}</p>}
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
          style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}>
          <summary className="px-4 py-3 cursor-pointer list-none flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: '#6bd8cb', fontSize: 18 }}>check_circle</span>
              <span className="text-[14px] font-semibold" style={{ color: '#e2e1ed' }}>
                Conducta — {positivas.length} positivas · {observaciones.length} observaciones
              </span>
            </div>
            <span className="material-symbols-outlined" style={{ color: '#8e90a0', fontSize: 18 }}>expand_more</span>
          </summary>
          <div className="px-4 pb-4 space-y-2" style={{ borderTop: '1px solid #33343d' }}>
            {[...positivas, ...observaciones].map((a, i) => (
              <div key={i} className="pt-2">
                {a.titulo && <p className="text-[13px] font-semibold" style={{ color: '#e2e1ed' }}>{a.titulo}</p>}
                {a.descripcion && <p className="text-[12px] mt-0.5" style={{ color: '#8e90a0' }}>{a.descripcion}</p>}
                {a.fecha && <p className="text-[10px] mt-0.5" style={{ color: '#434655' }}>{a.fecha}</p>}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* PRÓXIMAS FECHAS */}
      {fechas.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#b7c4ff' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Próximas Fechas</h2>
          </div>
          <div className="space-y-2">
            {fechas.map((f, i) => {
              const date = new Date(f.fecha_evento + 'T12:00:00')
              const day = date.getDate()
              const month = date.toLocaleDateString('es-CL', { month: 'short' }).toUpperCase()
              const dias = Math.ceil((date.getTime() - Date.now()) / 86400000)
              const badge = dias <= 0 ? 'HOY' : dias === 1 ? 'MAÑANA' : `${dias}d`
              const badgeColor = dias <= 0 ? '#ffb4ab' : dias <= 2 ? '#d2bbff' : '#6bd8cb'
              return (
                <div key={i} className="rounded-xl p-4 flex items-center gap-3"
                  style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}>
                  <div className="text-center w-10 flex-shrink-0">
                    <p className="text-[10px] font-semibold uppercase" style={{ color: '#6bd8cb' }}>{month}</p>
                    <p className="text-[18px] font-bold leading-tight" style={{ color: '#e2e1ed' }}>{day}</p>
                  </div>
                  <div className="w-px h-8 flex-shrink-0" style={{ backgroundColor: '#434655' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold truncate" style={{ color: '#e2e1ed' }}>{f.titulo}</p>
                    {f.asignatura && <p className="text-[11px] mt-0.5" style={{ color: '#8e90a0' }}>{f.asignatura}</p>}
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ color: badgeColor, border: `1px solid ${badgeColor}` }}>{badge}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* NOTAS POR ASIGNATURA */}
      {Object.keys(notasPorAsignatura).length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#d2bbff' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Notas por Asignatura</h2>
          </div>
          <div className="space-y-2">
            {Object.entries(notasPorAsignatura).map(([asig, notasAsig]) => (
              <div key={asig} className="rounded-xl p-4"
                style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] font-bold" style={{ color: '#e2e1ed' }}>{asig}</p>
                  {notasAsig.length > 1 && (
                    <p className="text-[11px]" style={{ color: '#8e90a0' }}>{notasAsig.length} notas</p>
                  )}
                </div>
                <div className="flex gap-4 overflow-x-auto hide-scrollbar">
                  {notasAsig.map((n, i) => (
                    <div key={i} className="flex-shrink-0 text-center min-w-[48px]">
                      <p className="text-[24px] font-bold leading-tight" style={{ color: notaColor(n.nota) }}>
                        {n.nota ?? '–'}
                      </p>
                      {n.descripcion && (
                        <p className="text-[10px] mt-0.5 max-w-[56px] truncate" style={{ color: '#8e90a0' }}>
                          {n.descripcion}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {notasAsig[0]?.promedio_curso && (
                  <p className="text-[11px] mt-3 pt-2" style={{ color: '#434655', borderTop: '1px solid #33343d' }}>
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
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#6bd8cb' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Horario Semanal</h2>
          </div>

          {DIAS.map(dia => {
            const bloques = horarioPorDia[dia]
            if (!bloques || bloques.length === 0) return null
            const esHoy = dia === diaActual || (dia === 'miercoles' && diaActual === 'miércoles')
            return (
              <details key={dia} open={esHoy}
                className="rounded-xl overflow-hidden"
                style={{ backgroundColor: '#1e1f27', border: `1px solid ${esHoy ? '#6bd8cb66' : '#434655'}` }}>
                <summary className="px-4 py-3 cursor-pointer list-none flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold capitalize" style={{ color: esHoy ? '#6bd8cb' : '#e2e1ed' }}>
                      {dia.charAt(0).toUpperCase() + dia.slice(1)}
                      {esHoy && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded font-bold"
                        style={{ backgroundColor: '#6bd8cb22', color: '#6bd8cb' }}>HOY</span>}
                    </span>
                    <span className="text-[11px]" style={{ color: '#8e90a0' }}>
                      {bloques.filter(b => b.tipo === 'clase').length} bloques
                    </span>
                  </div>
                  <span className="material-symbols-outlined" style={{ color: '#8e90a0', fontSize: 18 }}>expand_more</span>
                </summary>

                <div className="divide-y" style={{ borderColor: '#33343d', borderTop: '1px solid #33343d' }}>
                  {bloques.map((b, i) => {
                    const c = tipoHorarioColor(b.tipo)
                    return (
                      <div key={i} className="px-4 py-2.5 flex items-center gap-3"
                        style={{ backgroundColor: c.bg }}>
                        <div className="w-20 flex-shrink-0">
                          {b.hora_inicio && b.hora_fin ? (
                            <p className="text-[11px] font-semibold tabular-nums" style={{ color: '#8e90a0' }}>
                              {b.hora_inicio}–{b.hora_fin}
                            </p>
                          ) : b.bloque && (
                            <p className="text-[11px]" style={{ color: '#434655' }}>Bl. {b.bloque}</p>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {b.tipo === 'recreo' ? (
                            <p className="text-[13px] font-semibold" style={{ color: c.text }}>Recreo</p>
                          ) : b.tipo === 'almuerzo' ? (
                            <p className="text-[13px] font-semibold" style={{ color: c.text }}>Almuerzo</p>
                          ) : (
                            <p className="text-[13px] font-semibold truncate" style={{ color: '#e2e1ed' }}>
                              {b.asignatura || '—'}
                            </p>
                          )}
                        </div>
                        {b.sala && b.tipo === 'clase' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ backgroundColor: '#33343d', color: '#8e90a0' }}>
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
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#434655' }}>school</span>
          <p className="font-semibold" style={{ color: '#8e90a0' }}>Sin datos para {primerNombre}</p>
          <p className="text-[13px]" style={{ color: '#434655' }}>Corre el pipeline de SchoolNet para sincronizar</p>
        </div>
      )}

    </div>
  )
}

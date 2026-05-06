import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { semaforo, correlacionSemanal } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

const ALUMNOS: Record<string, { nombre: string; curso: string; color: string; border: string; bg: string }> = {
  clemente: { nombre: 'Clemente Aravena', curso: '6°D', color: '#1e3a8a', border: '#bfdbfe', bg: '#eff6ff' },
  raimundo: { nombre: 'Raimundo Aravena', curso: '4°A', color: '#7c3aed', border: '#e9d5ff', bg: '#faf5ff' },
}

const SEMAFORO_META = {
  verde:    { label: 'Sobre el curso', color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' },
  amarillo: { label: 'Cerca del curso', color: '#d97706', bg: '#fffbeb', border: '#fcd34d' },
  rojo:     { label: 'Bajo el curso',   color: '#ef4444', bg: '#fef2f2', border: '#fca5a5' },
  gris:     { label: 'Sin comparativo', color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0' },
}

export default async function AlumnoDetalle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const alumno = ALUMNOS[slug]
  if (!alumno) notFound()

  const hace60 = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().split('T')[0]
  const hoy = new Date().toISOString().split('T')[0]

  const [notasRes, anotRes, analisisRes, asistRes, fechasRes] = await Promise.all([
    supabase.from('notas').select('asignatura, nota, promedio_curso, tipo, descripcion, fecha').ilike('alumno', `%${slug}%`).order('fecha', { ascending: false }).limit(100),
    supabase.from('anotaciones').select('tipo, titulo, descripcion, fecha, asignatura').ilike('alumno', `%${slug}%`).gte('fecha', hace60).order('fecha', { ascending: false }),
    supabase.from('analisis_alumno').select('resumen, tendencia_academica, tendencia_conducta, nivel_alerta, prediccion, alertas, recomendaciones, generado_en').ilike('alumno', `%${slug}%`).order('generado_en', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('asistencia').select('asistencia_pct, inasistencias, prof_jefe').ilike('alumno', `%${slug}%`).maybeSingle(),
    supabase.from('items_colegio').select('titulo, fecha_evento, asignatura').eq('categoria', 'fecha_proxima').gte('fecha_evento', hoy).or(`alumno.ilike.%${slug}%,alumno.is.null`).order('fecha_evento').limit(10),
  ])

  const notas    = (notasRes.data    ?? []) as { asignatura: string; nota: number | null; promedio_curso: number | null; tipo: string | null; descripcion: string | null; fecha: string | null }[]
  const anot     = (anotRes.data     ?? []) as { tipo: string | null; titulo: string | null; descripcion: string | null; fecha: string | null; asignatura: string | null }[]
  const analisis = analisisRes.data ?? null
  const asist    = asistRes.data    ?? null
  const fechas   = (fechasRes.data   ?? []) as { titulo: string; fecha_evento: string; asignatura: string | null }[]

  const semData   = semaforo(notas)
  const correlData = correlacionSemanal(notas, anot)

  const negativas     = anot.filter(a => a.tipo === 'negativa')
  const positivas     = anot.filter(a => a.tipo === 'positiva')
  const observaciones = anot.filter(a => a.tipo === 'observacion' || (a.tipo !== 'negativa' && a.tipo !== 'positiva'))

  const maxNota = 7.0
  const alertas   = (analisis?.alertas        as { titulo: string; prioridad: string }[] | null) ?? []
  const recomendaciones = (analisis?.recomendaciones as { accion: string }[] | null) ?? []

  return (
    <div className="space-y-5 mt-4">

      {/* HEADER */}
      <div className="flex items-center gap-3">
        <Link href="/alumnos" className="material-symbols-outlined" style={{ color: '#94a3b8', fontSize: 22 }}>arrow_back</Link>
        <div className="flex-1">
          <h1 className="text-[20px] font-bold" style={{ color: alumno.color }}>{alumno.nombre.split(' ')[0]}</h1>
          <p className="text-[12px]" style={{ color: '#94a3b8' }}>{alumno.curso} · Saint George{asist?.prof_jefe ? ` · ${asist.prof_jefe}` : ''}</p>
        </div>
        {asist?.asistencia_pct != null && (
          <div className="text-right">
            <p className="text-[18px] font-black" style={{ color: asist.asistencia_pct < 90 ? '#ef4444' : '#0d9488' }}>{asist.asistencia_pct}%</p>
            <p className="text-[10px]" style={{ color: '#94a3b8' }}>asistencia</p>
          </div>
        )}
      </div>

      {/* ANALISIS IA */}
      {analisis && (
        <section className="rounded-2xl overflow-hidden" style={{ backgroundColor: alumno.bg, border: `1px solid ${alumno.border}` }}>
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ color: alumno.color, fontSize: 18, fontVariationSettings: "'FILL' 1" }}>psychology</span>
            <p className="text-[13px] font-bold uppercase tracking-widest" style={{ color: alumno.color }}>Análisis IA</p>
            {analisis.generado_en && (
              <p className="text-[10px] ml-auto" style={{ color: '#94a3b8' }}>
                {new Date(analisis.generado_en).toLocaleDateString('es-CL')}
              </p>
            )}
          </div>
          {analisis.resumen && (
            <p className="px-4 pb-3 text-[13px] leading-5" style={{ color: '#475569' }}>{analisis.resumen}</p>
          )}
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {[
              { label: 'Académico', val: analisis.tendencia_academica },
              { label: 'Conducta', val: analisis.tendencia_conducta },
              { label: 'Alerta', val: analisis.nivel_alerta },
            ].map(({ label, val }) => val && (
              <span key={label} className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: alumno.color + '18', color: alumno.color }}>
                {label}: {val}
              </span>
            ))}
          </div>
          {analisis.prediccion && (
            <div className="mx-4 mb-4 p-3 rounded-xl" style={{ backgroundColor: '#f1f5f9' }}>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: '#94a3b8' }}>Predicción</p>
              <p className="text-[13px] leading-5" style={{ color: '#475569' }}>{analisis.prediccion}</p>
            </div>
          )}
          {alertas.length > 0 && (
            <div className="px-4 pb-4 space-y-1">
              {alertas.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: a.prioridad === 'alta' ? '#fee2e2' : '#fef9c3', color: a.prioridad === 'alta' ? '#dc2626' : '#a16207' }}>
                    {a.prioridad?.toUpperCase()}
                  </span>
                  <p className="text-[12px]" style={{ color: '#475569' }}>{a.titulo}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SEMÁFORO POR ASIGNATURA */}
      {semData.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: alumno.color }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Semáforo por asignatura</h2>
          </div>
          <div className="space-y-2">
            {semData.map((s, i) => {
              const meta = SEMAFORO_META[s.color]
              const barWidth = Math.min(100, (s.promAlumno / maxNota) * 100)
              return (
                <div key={i} className="rounded-xl p-3" style={{ backgroundColor: meta.bg, border: `1px solid ${meta.border}` }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[13px] font-bold" style={{ color: '#1e293b' }}>{s.asignatura}</p>
                    <div className="flex items-center gap-2">
                      {s.promCurso && (
                        <p className="text-[11px]" style={{ color: '#94a3b8' }}>curso: {s.promCurso}</p>
                      )}
                      <p className="text-[15px] font-black" style={{ color: meta.color }}>{s.promAlumno}</p>
                    </div>
                  </div>
                  {/* Barra visual */}
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#e2e8f0' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${barWidth}%`, backgroundColor: meta.color }} />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[10px]" style={{ color: meta.color }}>{meta.label}</p>
                    {s.diff !== null && (
                      <p className="text-[10px] font-semibold" style={{ color: meta.color }}>
                        {s.diff >= 0 ? '+' : ''}{s.diff.toFixed(1)} vs curso
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* CORRELACIÓN CONDUCTA-RENDIMIENTO */}
      {correlData.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#6366f1' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Conducta vs Rendimiento</h2>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#fafafa', border: '1px solid #e2e8f0' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9' }}>
                    <th className="px-3 py-2 text-left font-semibold" style={{ color: '#64748b' }}>Semana</th>
                    <th className="px-3 py-2 text-center font-semibold" style={{ color: '#64748b' }}>Nota prom</th>
                    <th className="px-3 py-2 text-center font-semibold" style={{ color: '#ef4444' }}>Neg</th>
                    <th className="px-3 py-2 text-center font-semibold" style={{ color: '#0d9488' }}>Pos</th>
                    <th className="px-3 py-2 text-center font-semibold" style={{ color: '#64748b' }}>Correlación</th>
                  </tr>
                </thead>
                <tbody>
                  {correlData.map((row, i) => {
                    const notaColor = !row.promNotas ? '#94a3b8' : row.promNotas >= 5.5 ? '#0d9488' : row.promNotas >= 5.0 ? '#d97706' : '#ef4444'
                    const riesgo = (row.negativas >= 2 && row.promNotas && row.promNotas < 5.0)
                    return (
                      <tr key={i} style={{ backgroundColor: riesgo ? '#fff5f5' : i % 2 === 0 ? '#ffffff' : '#fafafa', borderTop: '1px solid #f1f5f9' }}>
                        <td className="px-3 py-2.5 font-medium" style={{ color: '#475569' }}>{row.semana}</td>
                        <td className="px-3 py-2.5 text-center font-bold" style={{ color: notaColor }}>
                          {row.promNotas ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold" style={{ color: row.negativas > 0 ? '#ef4444' : '#94a3b8' }}>
                          {row.negativas > 0 ? row.negativas : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold" style={{ color: row.positivas > 0 ? '#0d9488' : '#94a3b8' }}>
                          {row.positivas > 0 ? row.positivas : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {riesgo ? (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>⚠ patrón</span>
                          ) : (
                            <span style={{ color: '#e2e8f0' }}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-3 py-2 text-[10px]" style={{ color: '#94a3b8' }}>
              ⚠ patrón = semana con 2+ anotaciones negativas y nota bajo 5.0
            </p>
          </div>
        </section>
      )}

      {/* PRÓXIMAS FECHAS */}
      {fechas.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#d97706' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Próximas fechas</h2>
          </div>
          {fechas.map((f, i) => (
            <div key={i} className="rounded-xl p-3 flex items-center gap-3"
              style={{ backgroundColor: '#fffbeb', border: '1px solid #fcd34d' }}>
              <span className="material-symbols-outlined flex-shrink-0" style={{ color: '#d97706', fontSize: 18 }}>event</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold truncate" style={{ color: '#1e293b' }}>{f.titulo}</p>
                {f.asignatura && <p className="text-[11px]" style={{ color: '#94a3b8' }}>{f.asignatura}</p>}
              </div>
              <p className="text-[11px] font-semibold shrink-0" style={{ color: '#d97706' }}>{f.fecha_evento}</p>
            </div>
          ))}
        </section>
      )}

      {/* ANOTACIONES RECIENTES */}
      {anot.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#6366f1' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Anotaciones</h2>
            <span className="text-[11px]" style={{ color: '#94a3b8' }}>(60 días)</span>
          </div>

          {/* Resumen visual */}
          <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div className="flex items-center justify-between gap-2">
              {[
                { label: 'Positivas', count: positivas.length, color: '#16a34a', bg: '#dcfce7', icon: 'thumb_up' },
                { label: 'Negativas', count: negativas.length, color: '#ef4444', bg: '#fee2e2', icon: 'report' },
                { label: 'Observaciones', count: observaciones.length, color: '#6366f1', bg: '#e0e7ff', icon: 'visibility' },
              ].map(({ label, count, color, bg, icon }) => (
                <div key={label} className="flex-1 flex flex-col items-center gap-1 py-2 rounded-xl" style={{ backgroundColor: bg }}>
                  <span className="material-symbols-outlined" style={{ color, fontSize: 18, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
                  <p className="text-[22px] font-black leading-none" style={{ color }}>{count}</p>
                  <p className="text-[10px] font-semibold text-center leading-tight" style={{ color }}>{label}</p>
                </div>
              ))}
            </div>

            {/* Barra proporcional */}
            {anot.length > 0 && (
              <div className="h-2 rounded-full overflow-hidden flex gap-0.5">
                {positivas.length > 0 && (
                  <div className="h-full rounded-l-full" style={{ width: `${(positivas.length / anot.length) * 100}%`, backgroundColor: '#16a34a' }} />
                )}
                {observaciones.length > 0 && (
                  <div className="h-full" style={{ width: `${(observaciones.length / anot.length) * 100}%`, backgroundColor: '#6366f1' }} />
                )}
                {negativas.length > 0 && (
                  <div className="h-full rounded-r-full" style={{ width: `${(negativas.length / anot.length) * 100}%`, backgroundColor: '#ef4444' }} />
                )}
              </div>
            )}
          </div>

          {/* Lista completa ordenada por fecha */}
          <div className="space-y-2">
            {[...anot].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '')).map((a, i) => {
              const isNeg  = a.tipo === 'negativa'
              const isPos  = a.tipo === 'positiva'
              const bg     = isNeg ? '#fef2f2' : isPos ? '#f0fdf4' : '#f5f3ff'
              const border = isNeg ? '#fca5a5' : isPos ? '#86efac' : '#c4b5fd'
              const color  = isNeg ? '#ef4444'  : isPos ? '#16a34a'  : '#6366f1'
              const icon   = isNeg ? 'report'   : isPos ? 'thumb_up' : 'visibility'
              return (
                <div key={i} className="rounded-xl p-3 flex items-start gap-3"
                  style={{ backgroundColor: bg, border: `1px solid ${border}` }}>
                  <span className="material-symbols-outlined flex-shrink-0 mt-0.5"
                    style={{ color, fontSize: 16, fontVariationSettings: "'FILL' 1" }}>
                    {icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    {a.titulo && <p className="text-[13px] font-bold" style={{ color: '#1e293b' }}>{a.titulo}</p>}
                    {a.descripcion && <p className="text-[12px] leading-5" style={{ color: '#475569' }}>{a.descripcion}</p>}
                    <p className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                      {a.fecha}{a.asignatura ? ` · ${a.asignatura}` : ''}
                    </p>
                  </div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase shrink-0"
                    style={{ backgroundColor: color + '20', color }}>
                    {isNeg ? 'neg' : isPos ? 'pos' : 'obs'}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* RECOMENDACIONES IA */}
      {recomendaciones.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#0d9488' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Recomendaciones</h2>
          </div>
          {recomendaciones.map((r, i) => (
            <div key={i} className="rounded-xl p-3 flex items-start gap-3"
              style={{ backgroundColor: '#f0fdfa', border: '1px solid #99f6e4' }}>
              <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#0d9488', fontSize: 16 }}>lightbulb</span>
              <p className="text-[13px] leading-5" style={{ color: '#475569' }}>{r.accion}</p>
            </div>
          ))}
        </section>
      )}

    </div>
  )
}

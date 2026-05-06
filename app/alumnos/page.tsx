import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const ALUMNOS = [
  { slug: 'clemente', nombre: 'Clemente Aravena', curso: '6°D', color: '#1e3a8a', colorLight: '#eff6ff', border: '#bfdbfe' },
  { slug: 'raimundo', nombre: 'Raimundo Aravena', curso: '4°A', color: '#7c3aed', colorLight: '#faf5ff', border: '#e9d5ff' },
]

type AsistenciaRow = { alumno: string; asistencia_pct: number | null; prof_jefe: string | null }
type NotaRow = { alumno: string | null; nota: number | null }
type AnotRow = { alumno: string | null; tipo: string | null }
type AnalisisRow = { alumno: string; nivel_alerta: string | null; tendencia_academica: string | null; tendencia_conducta: string | null; resumen: string | null }
type FechaRow = { alumno: string | null; fecha_evento: string; titulo: string }

function alertaColor(nivel: string | null) {
  if (nivel === 'alto') return '#ef4444'
  if (nivel === 'medio') return '#d97706'
  return '#0d9488'
}

function tendenciaIcon(t: string | null) {
  if (t === 'mejorando') return { icon: 'trending_up', color: '#0d9488' }
  if (t === 'descendiendo') return { icon: 'trending_down', color: '#ef4444' }
  return { icon: 'trending_flat', color: '#94a3b8' }
}

function promedioColor(p: string | null) {
  if (!p) return '#94a3b8'
  const n = parseFloat(p)
  if (n >= 6) return '#0d9488'
  if (n >= 5) return '#d97706'
  return '#ef4444'
}

export default async function AlumnosPage() {
  const hoy = new Date().toISOString().split('T')[0]
  const en14 = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().split('T')[0]

  const [asistRes, notasRes, anotRes, analisisRes, fechasRes] = await Promise.all([
    supabase.from('asistencia').select('alumno, asistencia_pct, prof_jefe'),
    supabase.from('notas').select('alumno, nota').order('extraido_en', { ascending: false }).limit(60),
    supabase.from('anotaciones').select('alumno, tipo').order('fecha', { ascending: false }).limit(60),
    supabase.from('analisis_alumno').select('alumno, nivel_alerta, tendencia_academica, tendencia_conducta, resumen').order('generado_en', { ascending: false }).limit(4),
    supabase.from('items_colegio').select('alumno, fecha_evento, titulo').eq('categoria', 'fecha_proxima').gte('fecha_evento', hoy).lte('fecha_evento', en14).order('fecha_evento'),
  ])

  const asistencia = (asistRes.data ?? []) as AsistenciaRow[]
  const todasNotas = (notasRes.data ?? []) as NotaRow[]
  const todasAnot = (anotRes.data ?? []) as AnotRow[]
  const analisisAll = (analisisRes.data ?? []) as AnalisisRow[]
  const todasFechas = (fechasRes.data ?? []) as FechaRow[]

  const analisisByAlumno: Record<string, AnalisisRow> = {}
  for (const a of analisisAll) {
    const key = a.alumno.split(' ')[0].toLowerCase()
    if (!analisisByAlumno[key]) analisisByAlumno[key] = a
  }

  function statsAlumno(slug: string) {
    const asist = asistencia.find(a => a.alumno.toLowerCase().includes(slug)) ?? null
    const notas = todasNotas.filter(n => (n.alumno ?? '').toLowerCase().includes(slug) && n.nota)
    const promedio = notas.length
      ? (notas.reduce((s, n) => s + (n.nota ?? 0), 0) / notas.length).toFixed(1)
      : null
    const anot = todasAnot.filter(a => (a.alumno ?? '').toLowerCase().includes(slug))
    const negativas = anot.filter(a => a.tipo === 'negativa').length
    const positivas = anot.filter(a => a.tipo === 'positiva').length
    const fechas = todasFechas.filter(f => !f.alumno || (f.alumno ?? '').toLowerCase().includes(slug))
    const analisis = analisisByAlumno[slug] ?? null
    return { asist, promedio, negativas, positivas, fechas, analisis }
  }

  return (
    <div className="space-y-4 mt-4">

      <div>
        <h1 className="text-[20px] font-bold" style={{ color: '#1e293b' }}>Mis hijos</h1>
        <p className="text-[12px] mt-0.5" style={{ color: '#94a3b8' }}>
          Saint George · {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {ALUMNOS.map(({ slug, nombre, curso, color, colorLight, border }) => {
        const { asist, promedio, negativas, positivas, fechas, analisis } = statsAlumno(slug)
        const acad = tendenciaIcon(analisis?.tendencia_academica ?? null)
        const cond = tendenciaIcon(analisis?.tendencia_conducta ?? null)

        return (
          <div key={slug} className="space-y-1.5">
          <Link href={`/dashboard/${slug}`}
            className="block rounded-2xl overflow-hidden transition-transform active:scale-[0.99]"
            style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.08)', border: `1px solid ${border}` }}>

            {/* Header azul/morado */}
            <div className="px-4 py-4 flex items-center gap-3" style={{ backgroundColor: color }}>
              {/* Avatar inicial */}
              <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-[18px] flex-shrink-0"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: '#ffffff', border: '2px solid rgba(255,255,255,0.5)' }}>
                {nombre.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-[16px] leading-tight">{nombre.split(' ')[0]}</p>
                <p className="text-[12px] leading-tight" style={{ color: 'rgba(255,255,255,0.75)' }}>{curso} · Colegio Saint George</p>
                {asist?.prof_jefe && (
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    Prof. Jefe: {asist.prof_jefe}
                  </p>
                )}
              </div>
              <span className="material-symbols-outlined" style={{ color: 'rgba(255,255,255,0.6)', fontSize: 22 }}>chevron_right</span>
            </div>

            {/* Stats en 3 columnas */}
            <div className="grid grid-cols-3" style={{ backgroundColor: colorLight }}>
              {[
                {
                  valor: asist?.asistencia_pct != null ? `${asist.asistencia_pct}%` : '—',
                  label: 'Asistencia',
                  valColor: asist?.asistencia_pct != null && asist.asistencia_pct < 90 ? '#ef4444' : color,
                },
                {
                  valor: promedio ?? '—',
                  label: 'Promedio',
                  valColor: promedioColor(promedio),
                },
                {
                  valor: String(fechas.length),
                  label: 'Próx. fechas',
                  valColor: fechas.length > 0 ? '#d97706' : '#94a3b8',
                },
              ].map((stat, i) => (
                <div key={i} className="py-3 text-center" style={{ borderRight: i < 2 ? `1px solid ${border}` : undefined }}>
                  <p className="text-[20px] font-bold leading-tight" style={{ color: stat.valColor }}>{stat.valor}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: '#94a3b8' }}>{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Cuerpo */}
            <div className="px-4 py-3 space-y-2.5" style={{ backgroundColor: '#ffffff' }}>

              {/* Conducta */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold" style={{ color: '#94a3b8' }}>Conducta:</span>
                {positivas > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold"
                    style={{ backgroundColor: '#d1fae5', color: '#059669' }}>
                    {positivas} positiva{positivas !== 1 ? 's' : ''}
                  </span>
                )}
                {negativas > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold"
                    style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
                    {negativas} negativa{negativas !== 1 ? 's' : ''}
                  </span>
                )}
                {positivas === 0 && negativas === 0 && (
                  <span className="text-[11px]" style={{ color: '#cbd5e1' }}>Sin registros</span>
                )}
              </div>

              {/* Próximas fechas (primeras 2) */}
              {fechas.length > 0 && (
                <div className="space-y-1">
                  {fechas.slice(0, 2).map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px]">
                      <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 14, color: '#d97706' }}>event</span>
                      <span style={{ color: '#64748b' }}>{f.fecha_evento}:</span>
                      <span className="truncate font-medium" style={{ color: '#1e293b' }}>{f.titulo}</span>
                    </div>
                  ))}
                  {fechas.length > 2 && (
                    <p className="text-[11px]" style={{ color: '#94a3b8' }}>+{fechas.length - 2} más…</p>
                  )}
                </div>
              )}

              {/* Tendencias IA */}
              {analisis && (
                <div className="flex items-center gap-3 flex-wrap pt-2 border-t" style={{ borderColor: '#f1f5f9' }}>
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined" style={{ fontSize: 15, color: acad.color, fontVariationSettings: "'FILL' 1" }}>{acad.icon}</span>
                    <span className="text-[11px]" style={{ color: '#64748b' }}>Académico</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined" style={{ fontSize: 15, color: cond.color, fontVariationSettings: "'FILL' 1" }}>{cond.icon}</span>
                    <span className="text-[11px]" style={{ color: '#64748b' }}>Conducta</span>
                  </div>
                  {analisis.nivel_alerta && (
                    <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: alertaColor(analisis.nivel_alerta) + '18', color: alertaColor(analisis.nivel_alerta) }}>
                      Alerta {analisis.nivel_alerta}
                    </span>
                  )}
                </div>
              )}

              {/* Resumen IA */}
              {analisis?.resumen && (
                <p className="text-[12px] leading-[1.5] line-clamp-2" style={{ color: '#475569' }}>{analisis.resumen}</p>
              )}

            </div>

          </Link>

          {/* Acceso directo IA predictiva */}
          {analisis && (
            <Link href={`/alumnos/${slug}#ia`}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl -mt-1"
              style={{ backgroundColor: color + '0d', border: `1px solid ${border}` }}>
              <span className="material-symbols-outlined" style={{ color, fontSize: 17, fontVariationSettings: "'FILL' 1" }}>psychology</span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold" style={{ color }}>Ver Análisis IA predictivo</p>
                <p className="text-[10px]" style={{ color: '#94a3b8' }}>
                  {analisis.tendencia_academica === 'mejorando' ? 'Mejorando académicamente' :
                   analisis.tendencia_academica === 'descendiendo' ? 'Tendencia descendente' : 'Tendencia estable'} · Alerta {analisis.nivel_alerta ?? '?'}
                </p>
              </div>
              <span className="material-symbols-outlined" style={{ color: '#94a3b8', fontSize: 16 }}>chevron_right</span>
            </Link>
          )}
          </div>
        )
      })}

      {/* Acciones rápidas */}
      <div className="pt-1">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: '#cbd5e1' }}>Acciones</p>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/chat"
            className="rounded-xl p-3.5 flex items-center gap-3"
            style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe' }}>
            <span className="material-symbols-outlined" style={{ color: '#1e3a8a', fontSize: 20, fontVariationSettings: "'FILL' 1" }}>chat_bubble</span>
            <div>
              <p className="text-[13px] font-bold" style={{ color: '#1e3a8a' }}>Preguntar</p>
              <p className="text-[10px]" style={{ color: '#64748b' }}>Consulta a la IA</p>
            </div>
          </Link>
          <Link href="/estudiar"
            className="rounded-xl p-3.5 flex items-center gap-3"
            style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <span className="material-symbols-outlined" style={{ color: '#059669', fontSize: 20, fontVariationSettings: "'FILL' 1" }}>menu_book</span>
            <div>
              <p className="text-[13px] font-bold" style={{ color: '#059669' }}>Estudiar</p>
              <p className="text-[10px]" style={{ color: '#64748b' }}>Guías y material</p>
            </div>
          </Link>
        </div>
      </div>

    </div>
  )
}

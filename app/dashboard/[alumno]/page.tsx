import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type NotaRow = {
  asignatura: string
  tipo: string | null
  nota: number | null
  promedio_curso: number | null
  descripcion: string | null
  extraido_en: string
}

type FechaRow = {
  titulo: string
  fecha_evento: string
  asignatura: string | null
  categoria: string | null
}

type AnotacionRow = {
  titulo: string | null
  descripcion: string | null
  fecha: string | null
  tipo: string | null
}

const ALUMNOS: Record<string, { nombre: string; apellido: string; curso: string; color: string; initial: string }> = {
  clemente: { nombre: 'Clemente', apellido: 'Aravena', curso: '6° D', color: '#1d4ed8', initial: 'C' },
  raimundo: { nombre: 'Raimundo', apellido: 'Aravena', curso: '4° A', color: '#7c3aed', initial: 'R' },
}

function notaColor(nota: number | null) {
  if (!nota) return '#8e90a0'
  if (nota >= 6) return '#6bd8cb'
  if (nota >= 5) return '#d2bbff'
  return '#ffb4ab'
}

export default async function AlumnoPage({ params }: { params: { alumno: string } }) {
  const slug = params.alumno.toLowerCase()
  const alumno = ALUMNOS[slug]
  if (!alumno) notFound()

  const hoy = new Date().toISOString().split('T')[0]
  const nombreFiltro = alumno.nombre

  const [notasRes, fechasRes, anotacionesRes] = await Promise.all([
    supabase
      .from('notas')
      .select('asignatura, tipo, nota, promedio_curso, descripcion, extraido_en')
      .ilike('alumno', `%${nombreFiltro}%`)
      .order('extraido_en', { ascending: false })
      .limit(30),
    supabase
      .from('items_colegio')
      .select('titulo, fecha_evento, asignatura, categoria')
      .or(`alumno.ilike.%${nombreFiltro}%,alumno.ilike.%ambos%,alumno.is.null`)
      .gte('fecha_evento', hoy)
      .order('fecha_evento')
      .limit(20),
    supabase
      .from('anotaciones')
      .select('titulo, descripcion, fecha, tipo')
      .ilike('alumno', `%${nombreFiltro}%`)
      .order('fecha', { ascending: false })
      .limit(10),
  ])

  const notas = (notasRes.data as NotaRow[] ?? [])
  const fechas = (fechasRes.data as FechaRow[] ?? [])
  const anotaciones = (anotacionesRes.data as AnotacionRow[] ?? [])

  const promedio = notas.filter(n => n.nota).length > 0
    ? (notas.filter(n => n.nota).reduce((a, n) => a + (n.nota ?? 0), 0) / notas.filter(n => n.nota).length).toFixed(1)
    : null

  // Agrupamos notas por asignatura (última por asignatura)
  const notasPorAsignatura: Record<string, NotaRow[]> = {}
  for (const n of notas) {
    if (!notasPorAsignatura[n.asignatura]) notasPorAsignatura[n.asignatura] = []
    notasPorAsignatura[n.asignatura].push(n)
  }

  const anotacionesNegativas = anotaciones.filter(a => a.tipo?.toLowerCase().includes('negat') || a.tipo?.toLowerCase().includes('mala'))
  const anotacionesPositivas = anotaciones.filter(a => !anotacionesNegativas.includes(a))

  return (
    <div className="space-y-5 mt-4">

      {/* HEADER */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="flex items-center gap-1 text-[12px] font-semibold"
          style={{ color: '#8e90a0' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
          Dashboard
        </Link>
      </div>

      {/* PERFIL ALUMNO */}
      <section className="rounded-xl p-5 flex items-center gap-4"
        style={{ backgroundColor: '#1e1f27', border: `1px solid ${alumno.color}` }}>
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-[24px] font-bold text-white flex-shrink-0"
          style={{ backgroundColor: alumno.color }}>
          {alumno.initial}
        </div>
        <div className="flex-1">
          <h1 className="text-[20px] font-bold" style={{ color: '#e2e1ed' }}>
            {alumno.nombre} {alumno.apellido}
          </h1>
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
                    {f.asignatura && (
                      <p className="text-[11px] mt-0.5" style={{ color: '#8e90a0' }}>{f.asignatura}</p>
                    )}
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ color: badgeColor, border: `1px solid ${badgeColor}` }}>
                    {badge}
                  </span>
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
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Notas</h2>
          </div>
          <div className="space-y-2">
            {Object.entries(notasPorAsignatura).map(([asig, notas]) => {
              const ultima = notas[0]
              const promedioAsig = notas.filter(n => n.nota).length > 0
                ? (notas.filter(n => n.nota).reduce((a, n) => a + (n.nota ?? 0), 0) / notas.filter(n => n.nota).length).toFixed(1)
                : null
              return (
                <div key={asig} className="rounded-xl p-4"
                  style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-bold" style={{ color: '#e2e1ed' }}>{asig}</p>
                    {notas.length > 1 && (
                      <p className="text-[11px]" style={{ color: '#8e90a0' }}>{notas.length} notas</p>
                    )}
                  </div>
                  <div className="flex gap-2 overflow-x-auto hide-scrollbar">
                    {notas.map((n, i) => (
                      <div key={i} className="flex-shrink-0 text-center">
                        <p className="text-[22px] font-bold leading-tight" style={{ color: notaColor(n.nota) }}>
                          {n.nota ?? '–'}
                        </p>
                        {n.descripcion && (
                          <p className="text-[10px] max-w-[64px] truncate" style={{ color: '#8e90a0' }}>{n.descripcion}</p>
                        )}
                      </div>
                    ))}
                  </div>
                  {ultima.promedio_curso && (
                    <p className="text-[11px] mt-2" style={{ color: '#434655' }}>
                      Promedio del curso: {ultima.promedio_curso}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ANOTACIONES */}
      {anotaciones.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full"
              style={{ backgroundColor: anotacionesNegativas.length > 0 ? '#ffb4ab' : '#6bd8cb' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Conducta</h2>
          </div>
          <div className="space-y-2">
            {anotaciones.map((a, i) => {
              const negativa = anotacionesNegativas.includes(a)
              return (
                <div key={i} className="rounded-xl p-4"
                  style={{ backgroundColor: '#1e1f27', border: `1px solid ${negativa ? '#93000a' : '#434655'}` }}>
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined flex-shrink-0 mt-0.5"
                      style={{ color: negativa ? '#ffb4ab' : '#6bd8cb', fontSize: 16 }}>
                      {negativa ? 'report' : 'check_circle'}
                    </span>
                    <div className="flex-1">
                      {a.titulo && <p className="text-[13px] font-bold" style={{ color: '#e2e1ed' }}>{a.titulo}</p>}
                      {a.descripcion && <p className="text-[12px] mt-0.5" style={{ color: '#8e90a0' }}>{a.descripcion}</p>}
                      {a.fecha && <p className="text-[10px] mt-1" style={{ color: '#434655' }}>{a.fecha}</p>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* EMPTY STATE */}
      {notas.length === 0 && fechas.length === 0 && anotaciones.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#434655' }}>school</span>
          <p className="font-semibold" style={{ color: '#8e90a0' }}>Sin datos para {alumno.nombre}</p>
        </div>
      )}

    </div>
  )
}

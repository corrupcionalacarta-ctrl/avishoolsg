import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const ALUMNOS: Record<string, { nombre: string; curso: string; color: string; bg: string; border: string }> = {
  clemente: { nombre: 'Clemente Aravena', curso: '6°D', color: '#1e3a8a', bg: '#eff6ff', border: '#bfdbfe' },
  raimundo: { nombre: 'Raimundo Aravena', curso: '4°A', color: '#7c3aed', bg: '#faf5ff', border: '#e9d5ff' },
}

export default async function NotasRamoPage({
  params,
}: {
  params: Promise<{ slug: string; asig: string }>
}) {
  const { slug, asig } = await params
  const alumno = ALUMNOS[slug]
  if (!alumno) notFound()

  const asignatura = decodeURIComponent(asig)
  const hoy = new Date().toISOString().split('T')[0]

  const [notasRes, fechasRes, anotRes] = await Promise.all([
    supabase
      .from('notas')
      .select('tipo, nota, promedio_curso, descripcion, fecha')
      .ilike('alumno', `%${slug}%`)
      .ilike('asignatura', `%${asignatura.split(' ')[0]}%`)
      .order('tipo')
      .order('fecha', { ascending: false }),
    supabase
      .from('items_colegio')
      .select('titulo, fecha_evento, detalle')
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', hoy)
      .or(`alumno.ilike.%${slug}%,alumno.is.null`)
      .ilike('asignatura', `%${asignatura.split(' ')[0]}%`)
      .order('fecha_evento')
      .limit(10),
    supabase
      .from('anotaciones')
      .select('tipo, titulo, descripcion, fecha')
      .ilike('alumno', `%${slug}%`)
      .ilike('asignatura', `%${asignatura.split(' ')[0]}%`)
      .order('fecha', { ascending: false })
      .limit(10),
  ])

  const notas  = notasRes.data  ?? []
  const fechas = fechasRes.data ?? []
  const anot   = anotRes.data   ?? []

  const promedio = notas.find(n => n.tipo === 'promedio')
  const pruebas  = notas.filter(n => n.tipo === 'prueba')
  const promVal  = promedio?.nota
  const promCurso = promedio?.promedio_curso

  const notaColor = !promVal ? '#94a3b8'
    : promVal >= 6.0 ? '#0d9488'
    : promVal >= 5.0 ? '#d97706'
    : '#ef4444'

  const maxNota = 7.0

  return (
    <div className="space-y-5 mt-4">

      {/* HEADER */}
      <div className="flex items-center gap-3">
        <Link href={`/alumnos/${slug}`} className="material-symbols-outlined" style={{ color: '#94a3b8', fontSize: 22 }}>
          arrow_back
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-[18px] font-bold leading-tight" style={{ color: alumno.color }}>{asignatura}</h1>
          <p className="text-[12px]" style={{ color: '#94a3b8' }}>{alumno.nombre.split(' ')[0]} · {alumno.curso}</p>
        </div>
      </div>

      {/* PROMEDIO CARD */}
      <section className="rounded-2xl p-5" style={{ backgroundColor: alumno.bg, border: `2px solid ${alumno.border}` }}>
        <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#94a3b8' }}>Promedio actual</p>
        <div className="flex items-end gap-4">
          <p className="text-[56px] font-black leading-none" style={{ color: notaColor }}>
            {promVal?.toFixed(1) ?? '—'}
          </p>
          {promCurso && (
            <div className="pb-2">
              <p className="text-[13px] font-semibold" style={{ color: '#64748b' }}>
                Curso: {promCurso.toFixed(1)}
              </p>
              <p className="text-[12px]" style={{ color: notaColor }}>
                {promVal && promCurso
                  ? `${(promVal - promCurso) >= 0 ? '+' : ''}${(promVal - promCurso).toFixed(1)} vs curso`
                  : ''}
              </p>
            </div>
          )}
        </div>
        {promVal && (
          <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#e2e8f0' }}>
            <div className="h-full rounded-full"
              style={{ width: `${Math.min(100, (promVal / maxNota) * 100)}%`, backgroundColor: notaColor }} />
          </div>
        )}
        {!promVal && (
          <p className="text-[13px] mt-1" style={{ color: '#94a3b8' }}>Sin nota registrada aún</p>
        )}
      </section>

      {/* EVALUACIONES DEL SEMESTRE */}
      {pruebas.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: alumno.color }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Evaluaciones del semestre</h2>
          </div>
          <div className="space-y-2">
            {pruebas.map((p, i) => {
              const nc = !p.nota ? '#94a3b8'
                : p.nota >= 6.0 ? '#0d9488'
                : p.nota >= 5.0 ? '#d97706'
                : '#ef4444'
              return (
                <div key={i} className="rounded-xl px-4 py-3 flex items-center gap-3"
                  style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <span className="material-symbols-outlined flex-shrink-0"
                    style={{ color: p.nota ? nc : '#cbd5e1', fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
                    {p.nota ? 'assignment_turned_in' : 'assignment'}
                  </span>
                  <p className="flex-1 text-[13px] font-medium" style={{ color: '#1e293b' }}>
                    {p.descripcion}
                  </p>
                  <p className="text-[17px] font-black shrink-0" style={{ color: p.nota ? nc : '#cbd5e1' }}>
                    {p.nota?.toFixed(1) ?? '—'}
                  </p>
                </div>
              )
            })}
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
              <p className="flex-1 text-[13px] font-bold" style={{ color: '#1e293b' }}>{f.titulo}</p>
              <p className="text-[11px] font-semibold shrink-0" style={{ color: '#d97706' }}>{f.fecha_evento}</p>
            </div>
          ))}
        </section>
      )}

      {/* ANOTACIONES EN ESTA ASIGNATURA */}
      {anot.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#6366f1' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Anotaciones</h2>
          </div>
          {anot.map((a, i) => {
            const isNeg = a.tipo === 'negativa'
            const isPos = a.tipo === 'positiva'
            const color  = isNeg ? '#ef4444' : isPos ? '#16a34a' : '#6366f1'
            const bg     = isNeg ? '#fef2f2' : isPos ? '#f0fdf4' : '#f5f3ff'
            const border = isNeg ? '#fca5a5' : isPos ? '#86efac' : '#c4b5fd'
            const icon   = isNeg ? 'report'  : isPos ? 'thumb_up' : 'visibility'
            return (
              <div key={i} className="rounded-xl p-3 flex items-start gap-3"
                style={{ backgroundColor: bg, border: `1px solid ${border}` }}>
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5"
                  style={{ color, fontSize: 16, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
                <div className="flex-1 min-w-0">
                  {a.titulo && <p className="text-[13px] font-bold" style={{ color: '#1e293b' }}>{a.titulo}</p>}
                  {a.descripcion && <p className="text-[12px] leading-5" style={{ color: '#475569' }}>{a.descripcion}</p>}
                  <p className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>{a.fecha}</p>
                </div>
              </div>
            )
          })}
        </section>
      )}

      {notas.length === 0 && fechas.length === 0 && anot.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#cbd5e1' }}>assignment</span>
          <p className="font-semibold" style={{ color: '#94a3b8' }}>Sin datos para {asignatura}</p>
        </div>
      )}

    </div>
  )
}

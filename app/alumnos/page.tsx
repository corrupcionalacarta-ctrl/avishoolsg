import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALUMNOS = [
  { nombre: 'Clemente Aravena', curso: '6°D', color: '#1d4ed8', initial: 'C' },
  { nombre: 'Raimundo Aravena', curso: '4°A', color: '#7c3aed', initial: 'R' },
]

function NoteColor(nota: number | null) {
  if (!nota) return '#8e90a0'
  if (nota >= 6) return '#6bd8cb'
  if (nota >= 5) return '#d2bbff'
  return '#ffb4ab'
}

export default async function AlumnosPage() {
  const [{ data: notas }, { data: anotaciones }] = await Promise.all([
    supabase
      .from('notas')
      .select('alumno, asignatura, nota, promedio_curso, descripcion, fecha')
      .order('extraido_en', { ascending: false })
      .limit(60),
    supabase
      .from('anotaciones')
      .select('alumno, fecha, tipo, descripcion, asignatura')
      .order('fecha', { ascending: false })
      .limit(40),
  ])

  return (
    <div className="space-y-6 mt-4">
      <h1 className="text-[24px] font-bold tracking-tight" style={{ color: '#e2e1ed' }}>Alumnos</h1>

      {ALUMNOS.map(({ nombre, curso, color, initial }) => {
        const notasAlumno = (notas ?? []).filter(n => n.alumno === nombre)
        const anotAlumno = (anotaciones ?? []).filter(a => a.alumno === nombre)
        const promedio = notasAlumno.filter(n => n.nota).length > 0
          ? (notasAlumno.filter(n => n.nota).reduce((s, n) => s + n.nota, 0) / notasAlumno.filter(n => n.nota).length).toFixed(1)
          : null

        return (
          <section key={nombre} className="space-y-3">
            {/* Header alumno */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                style={{ backgroundColor: color }}>
                {initial}
              </div>
              <div>
                <h2 className="text-[18px] font-semibold leading-tight" style={{ color: '#e2e1ed' }}>{nombre.split(' ')[0]}</h2>
                <p className="text-[12px]" style={{ color: '#8e90a0' }}>{curso} · Saint George</p>
              </div>
              {promedio && (
                <div className="ml-auto text-right">
                  <p className="text-[28px] font-bold leading-none tracking-tight" style={{ color: NoteColor(parseFloat(promedio)) }}>{promedio}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#8e90a0' }}>Prom.</p>
                </div>
              )}
            </div>

            {/* Notas */}
            {notasAlumno.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #434655' }}>
                <div className="px-4 py-2.5 flex items-center gap-2" style={{ backgroundColor: '#282932' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#d2bbff' }}>grade</span>
                  <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#d2bbff' }}>Notas</p>
                </div>
                <div className="divide-y" style={{ backgroundColor: '#1e1f27', borderColor: '#434655' }}>
                  {notasAlumno.slice(0, 8).map((n, i) => {
                    const pct = n.nota ? Math.round((n.nota / 7) * 100) : 0
                    return (
                      <div key={i} className="px-4 py-3 flex items-center gap-3">
                        <span className="text-[20px] font-bold w-10 text-right flex-shrink-0 leading-none"
                          style={{ color: NoteColor(n.nota) }}>{n.nota ?? '–'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium truncate" style={{ color: '#e2e1ed' }}>{n.asignatura}</p>
                          {n.descripcion && <p className="text-[11px] truncate" style={{ color: '#8e90a0' }}>{n.descripcion}</p>}
                          <div className="mt-1.5 w-full rounded-full h-0.5" style={{ backgroundColor: '#33343d' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: NoteColor(n.nota) }} />
                          </div>
                        </div>
                        {n.promedio_curso && (
                          <span className="text-[11px] flex-shrink-0" style={{ color: '#8e90a0' }}>prom {n.promedio_curso}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Anotaciones */}
            {anotAlumno.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #434655' }}>
                <div className="px-4 py-2.5 flex items-center gap-2" style={{ backgroundColor: '#282932' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#b7c4ff' }}>edit_note</span>
                  <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#b7c4ff' }}>Anotaciones</p>
                </div>
                <div className="divide-y" style={{ backgroundColor: '#1e1f27', borderColor: '#434655' }}>
                  {anotAlumno.slice(0, 5).map((a, i) => {
                    const dotColor = a.tipo === 'positiva' ? '#6bd8cb' : a.tipo === 'negativa' ? '#ffb4ab' : '#8e90a0'
                    return (
                      <div key={i} className="px-4 py-3 flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: dotColor }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px]" style={{ color: '#e2e1ed' }}>{a.descripcion}</p>
                          <div className="flex gap-2 mt-1">
                            {a.asignatura && <span className="text-[11px]" style={{ color: '#8e90a0' }}>{a.asignatura}</span>}
                            {a.fecha && <span className="text-[11px]" style={{ color: '#434655' }}>{a.fecha}</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {notasAlumno.length === 0 && anotAlumno.length === 0 && (
              <div className="rounded-xl p-6 text-center" style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}>
                <p className="text-[13px]" style={{ color: '#434655' }}>Sin datos aún</p>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type DigestRow = {
  id: string
  created_at: string
  run_mode: string
  resumen_ejecutivo: string
  n_urgentes: number
  n_importantes: number
  n_informativos: number
  n_fechas: number
  json_completo: Record<string, unknown>
}

type NotaRow = {
  alumno: string
  asignatura: string
  nota: number | null
  promedio_curso: number | null
}

type FechaRow = {
  titulo: string
  fecha_evento: string
  asignatura: string | null
  alumno: string | null
}

function StudentTag({ alumno }: { alumno: string | null }) {
  const name = alumno ?? 'Clemente'
  const bg = name.toLowerCase().includes('raimundo')
    ? '#7c3aed'
    : name.toLowerCase().includes('shared') || name.toLowerCase().includes('ambos')
    ? '#0d9488'
    : '#1d4ed8'
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-tight"
      style={{ backgroundColor: bg }}
    >
      {name.split(' ')[0]}
    </span>
  )
}

function NoteColor(nota: number | null) {
  if (!nota) return '#8e90a0'
  if (nota >= 6) return '#6bd8cb'
  if (nota >= 5) return '#d2bbff'
  return '#ffb4ab'
}

export default async function DashboardPage() {
  const [{ data: digests }, { data: proximasFechas }, { data: notas }] = await Promise.all([
    supabase
      .from('digests')
      .select('id, created_at, run_mode, resumen_ejecutivo, n_urgentes, n_importantes, n_informativos, n_fechas, json_completo')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('items_colegio')
      .select('titulo, fecha_evento, asignatura, alumno')
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', new Date().toISOString().split('T')[0])
      .order('fecha_evento')
      .limit(10),
    supabase
      .from('notas')
      .select('alumno, asignatura, nota, promedio_curso')
      .order('extraido_en', { ascending: false })
      .limit(6),
  ])

  const latestDigest = (digests as DigestRow[] ?? [])[0]
  const urgentes = (latestDigest?.json_completo?.urgentes as { titulo: string; detalle: string }[] ?? [])
  const utiles = (latestDigest?.json_completo?.utiles_mañana as string[] ?? [])

  const totalUrgentes = (digests as DigestRow[] ?? []).reduce((a, d) => a + (d.n_urgentes ?? 0), 0)
  const totalEvals = (digests as DigestRow[] ?? []).reduce((a, d) => a + (d.n_importantes ?? 0), 0)
  const promedioNotas = notas && notas.length > 0
    ? ((notas as NotaRow[]).filter(n => n.nota).reduce((a, n) => a + (n.nota ?? 0), 0) / (notas as NotaRow[]).filter(n => n.nota).length).toFixed(1)
    : '–'

  return (
    <div className="space-y-5 mt-4">

      {/* STATS BAR */}
      <section>
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: 'notification_important', value: urgentes.length || '0', label: 'Urg.', color: '#ffb4ab' },
            { icon: 'assignment', value: String(totalEvals), label: 'Eval.', color: '#6bd8cb' },
            { icon: 'grade', value: promedioNotas, label: 'Prom.', color: '#d2bbff' },
            { icon: 'calendar_today', value: String((proximasFechas as FechaRow[] ?? []).length), label: 'Fechas', color: '#b7c4ff' },
          ].map(({ icon, value, label, color }) => (
            <div
              key={label}
              className="rounded-xl p-3 flex flex-col items-center gap-1"
              style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}
            >
              <span className="material-symbols-outlined" style={{ color, fontSize: 20 }}>{icon}</span>
              <span className="text-2xl font-bold leading-none tracking-tight" style={{ color: '#e2e1ed' }}>{value}</span>
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#8e90a0' }}>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* REQUIEREN ACCIÓN */}
      {urgentes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#ffb4ab' }} />
            <h2 className="text-[18px] font-semibold leading-6 tracking-tight" style={{ color: '#e2e1ed' }}>Requieren Acción</h2>
          </div>
          {urgentes.map((u, i) => (
            <div
              key={i}
              className="rounded-xl p-4 flex items-start justify-between gap-3"
              style={{ backgroundColor: '#1e1f27', border: '1px solid #93000a' }}
            >
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#ffb4ab' }}>Urgente</p>
                <h3 className="text-[14px] font-bold" style={{ color: '#e2e1ed' }}>{u.titulo}</h3>
                <p className="text-[12px] mt-0.5" style={{ color: '#8e90a0' }}>{u.detalle}</p>
              </div>
              <span className="material-symbols-outlined flex-shrink-0" style={{ color: '#ffb4ab', fontSize: 20 }}>warning</span>
            </div>
          ))}
        </section>
      )}

      {/* ÚTILES MAÑANA */}
      {utiles.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#6bd8cb' }} />
            <h2 className="text-[18px] font-semibold leading-6 tracking-tight" style={{ color: '#e2e1ed' }}>Útiles para mañana</h2>
          </div>
          <div className="rounded-xl overflow-hidden divide-y" style={{ backgroundColor: '#1e1f27', border: '1px solid #434655', borderColor: '#434655' }}>
            {utiles.map((u, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <span className="material-symbols-outlined" style={{ color: '#6bd8cb', fontSize: 18 }}>backpack</span>
                <span className="text-[14px]" style={{ color: '#e2e1ed' }}>{u}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* NOTAS RECIENTES */}
      {notas && (notas as NotaRow[]).length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#d2bbff' }} />
            <h2 className="text-[18px] font-semibold leading-6 tracking-tight" style={{ color: '#e2e1ed' }}>Notas Recientes</h2>
          </div>
          <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
            {(notas as NotaRow[]).map((n, i) => {
              const pct = n.nota ? Math.round((n.nota / 7) * 100) : 0
              return (
                <div
                  key={i}
                  className="flex-shrink-0 w-36 rounded-xl p-4"
                  style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}
                >
                  <StudentTag alumno={n.alumno} />
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#8e90a0' }}>{n.asignatura}</p>
                    <p className="text-[28px] font-bold leading-none tracking-tight" style={{ color: NoteColor(n.nota) }}>
                      {n.nota ?? '–'}
                    </p>
                  </div>
                  <div className="mt-2 w-full rounded-full h-1 overflow-hidden" style={{ backgroundColor: '#33343d' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: NoteColor(n.nota) }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* AGENDA PRÓXIMA */}
      {(proximasFechas as FechaRow[] ?? []).length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#6bd8cb' }} />
            <h2 className="text-[18px] font-semibold leading-6 tracking-tight" style={{ color: '#e2e1ed' }}>Agenda Próxima</h2>
          </div>
          <div className="space-y-2">
            {(proximasFechas as FechaRow[]).map((f, i) => {
              const date = new Date(f.fecha_evento)
              const day = date.getDate()
              const month = date.toLocaleDateString('es-CL', { month: 'short' }).toUpperCase()
              const dias = Math.ceil((date.getTime() - Date.now()) / 86400000)
              const badge = dias === 0 ? 'HOY' : dias === 1 ? 'MAÑANA' : `${dias}d`
              const badgeColor = dias === 0 ? '#ffb4ab' : dias <= 3 ? '#d2bbff' : '#6bd8cb'
              return (
                <div
                  key={i}
                  className="rounded-xl p-4 flex items-center gap-4"
                  style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}
                >
                  <div className="text-center w-10 flex-shrink-0">
                    <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#6bd8cb' }}>{month}</p>
                    <p className="text-[18px] font-bold leading-tight" style={{ color: '#e2e1ed' }}>{day}</p>
                  </div>
                  <div className="w-px h-10 flex-shrink-0" style={{ backgroundColor: '#434655' }} />
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[14px] font-bold truncate" style={{ color: '#e2e1ed' }}>{f.titulo}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      {f.alumno && <StudentTag alumno={f.alumno} />}
                      {f.asignatura && <span className="text-[11px]" style={{ color: '#8e90a0' }}>{f.asignatura}</span>}
                    </div>
                  </div>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ color: badgeColor, border: `1px solid ${badgeColor}` }}
                  >
                    {badge}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* EMPTY STATE */}
      {!(digests as DigestRow[] ?? []).length && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#434655' }}>inbox</span>
          <div>
            <p className="font-semibold" style={{ color: '#8e90a0' }}>Sin datos aún</p>
            <p className="text-[13px] mt-1" style={{ color: '#434655' }}>Corre el pipeline para poblar el dashboard</p>
          </div>
        </div>
      )}

      {/* HISTORIAL DIGESTS */}
      {(digests as DigestRow[] ?? []).length > 0 && (
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#8e90a0' }} />
          <h2 className="text-[18px] font-semibold leading-6 tracking-tight" style={{ color: '#e2e1ed' }}>Historial</h2>
        </div>
        <div className="space-y-2">
          {(digests as DigestRow[] ?? []).map((d) => {
            const fecha = new Date(d.created_at)
            const json = d.json_completo
            const urgentesD = json?.urgentes as { titulo: string; detalle: string }[] ?? []
            const utilesD = json?.utiles_mañana as string[] ?? []
            return (
              <details
                key={d.id}
                className="rounded-xl overflow-hidden"
                style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}
              >
                <summary className="p-4 cursor-pointer list-none flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#8e90a0' }}>
                        {fecha.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {' · '}
                        {fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#33343d', color: '#c4c5d7' }}>{d.run_mode}</span>
                      {d.n_urgentes > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#93000a', color: '#ffdad6' }}>
                          {d.n_urgentes} urgente{d.n_urgentes > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] leading-5 line-clamp-2" style={{ color: '#c4c5d7' }}>{d.resumen_ejecutivo}</p>
                  </div>
                  <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#8e90a0', fontSize: 18 }}>expand_more</span>
                </summary>
                <div className="px-4 pb-4 space-y-3 text-[13px]" style={{ borderTop: '1px solid #434655' }}>
                  {urgentesD.length > 0 && (
                    <div className="pt-3">
                      <p className="font-semibold mb-2" style={{ color: '#ffb4ab' }}>Urgente</p>
                      {urgentesD.map((u, i) => (
                        <p key={i} className="mb-1" style={{ color: '#c4c5d7' }}>
                          · <b style={{ color: '#e2e1ed' }}>{u.titulo}</b>: {u.detalle}
                        </p>
                      ))}
                    </div>
                  )}
                  {utilesD.length > 0 && (
                    <div>
                      <p className="font-semibold mb-2" style={{ color: '#6bd8cb' }}>Útiles mañana</p>
                      {utilesD.map((u, i) => (
                        <p key={i} className="mb-1" style={{ color: '#c4c5d7' }}>· {u}</p>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      </section>
      )}

    </div>
  )
}

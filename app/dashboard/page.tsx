import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import RefreshButton from './RefreshButton'

export const dynamic = 'force-dynamic'

type NotaRow = {
  alumno: string | null
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

function notaColor(nota: number | null) {
  if (!nota) return '#8e90a0'
  if (nota >= 6) return '#6bd8cb'
  if (nota >= 5) return '#d2bbff'
  return '#ffb4ab'
}

function StudentTag({ alumno }: { alumno: string | null }) {
  const name = alumno ?? 'Clemente'
  const isRaimundo = name.toLowerCase().includes('raimundo')
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-tight"
      style={{ backgroundColor: isRaimundo ? '#7c3aed' : '#1d4ed8' }}
    >
      {name.split(' ')[0]}
    </span>
  )
}

export default async function DashboardPage() {
  const hoy = new Date().toISOString().split('T')[0]
  const en7 = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split('T')[0]

  const [digestRes, fechasRes, notasRes] = await Promise.all([
    supabase
      .from('digests')
      .select('resumen_ejecutivo, created_at, json_completo')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('items_colegio')
      .select('titulo, fecha_evento, asignatura, alumno')
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', hoy)
      .order('fecha_evento')
      .limit(20),
    supabase
      .from('notas')
      .select('alumno, asignatura, nota, promedio_curso')
      .order('extraido_en', { ascending: false })
      .limit(20),
  ])

  const digest = digestRes.data
  const json = (digest?.json_completo ?? {}) as Record<string, unknown>
  const urgentes = (json.urgentes as { titulo: string; detalle: string }[] ?? [])
  const importantes = (json.importantes as { titulo: string; detalle: string }[] ?? [])
  const utiles = (json.utiles_mañana as string[] ?? [])

  const allFechas = (fechasRes.data as FechaRow[] ?? [])
  const semanaFechas = allFechas.filter(f => f.fecha_evento <= en7)
  const allNotas = (notasRes.data as NotaRow[] ?? [])

  const clementeNotas = allNotas.filter(n => !n.alumno || n.alumno.toLowerCase().includes('clemente'))
  const raimundoNotas = allNotas.filter(n => n.alumno?.toLowerCase().includes('raimundo'))
  const clementeFechas = allFechas.filter(f => !f.alumno || f.alumno.toLowerCase().includes('clemente') || f.alumno.toLowerCase().includes('ambos'))
  const raimundoFechas = allFechas.filter(f => !f.alumno || f.alumno.toLowerCase().includes('raimundo') || f.alumno.toLowerCase().includes('ambos'))

  const avg = (notas: NotaRow[]) => {
    const con = notas.filter(n => n.nota)
    return con.length ? (con.reduce((a, n) => a + (n.nota ?? 0), 0) / con.length).toFixed(1) : null
  }
  const clementePromedio = avg(clementeNotas)
  const raimundoPromedio = avg(raimundoNotas)

  const digestHora = digest?.created_at
    ? new Date(digest.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    : null

  const hayContenido = urgentes.length > 0 || utiles.length > 0 || importantes.length > 0 || allFechas.length > 0 || allNotas.length > 0

  return (
    <div className="space-y-5 mt-4">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: '#8e90a0' }}>
          {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <RefreshButton />
      </div>

      {/* 1. ACTUALIZACIÓN DEL DÍA */}
      {(digest || utiles.length > 0) && (
        <section className="rounded-xl p-4 space-y-3" style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ color: '#6bd8cb', fontSize: 18 }}>wb_sunny</span>
            <h2 className="text-[14px] font-bold uppercase tracking-widest" style={{ color: '#6bd8cb' }}>
              Hoy{digestHora ? ` · ${digestHora}` : ''}
            </h2>
          </div>

          {digest?.resumen_ejecutivo && (
            <p className="text-[13px] leading-5" style={{ color: '#c4c5d7' }}>{digest.resumen_ejecutivo}</p>
          )}

          {utiles.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#8e90a0' }}>Llevar mañana</p>
              <div className="space-y-1">
                {utiles.map((u, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="material-symbols-outlined" style={{ color: '#6bd8cb', fontSize: 16 }}>backpack</span>
                    <span className="text-[13px]" style={{ color: '#e2e1ed' }}>{u}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 2. URGENTE */}
      {urgentes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#ffb4ab' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Requieren Acción</h2>
          </div>
          {urgentes.map((u, i) => (
            <div key={i} className="rounded-xl p-4 flex items-start gap-3"
              style={{ backgroundColor: '#1e1f27', border: '1px solid #93000a' }}>
              <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#ffb4ab', fontSize: 18 }}>warning</span>
              <div>
                <p className="text-[13px] font-bold" style={{ color: '#e2e1ed' }}>{u.titulo}</p>
                <p className="text-[12px] mt-0.5" style={{ color: '#8e90a0' }}>{u.detalle}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 3. IMPORTANTE */}
      {importantes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#d2bbff' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Importante esta semana</h2>
          </div>
          {importantes.map((u, i) => (
            <div key={i} className="rounded-xl p-4 flex items-start gap-3"
              style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}>
              <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#d2bbff', fontSize: 18 }}>info</span>
              <div>
                <p className="text-[13px] font-bold" style={{ color: '#e2e1ed' }}>{u.titulo}</p>
                <p className="text-[12px] mt-0.5" style={{ color: '#8e90a0' }}>{u.detalle}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 4. PRUEBAS / FECHAS PRÓXIMOS 7 DÍAS */}
      {semanaFechas.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#b7c4ff' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Próximos 7 días</h2>
          </div>
          <div className="space-y-2">
            {semanaFechas.map((f, i) => {
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
                    <div className="flex items-center gap-2 mt-0.5">
                      {f.alumno && <StudentTag alumno={f.alumno} />}
                      {f.asignatura && <span className="text-[11px]" style={{ color: '#8e90a0' }}>{f.asignatura}</span>}
                    </div>
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

      {/* 5. ALUMNOS */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#8e90a0' }} />
          <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Alumnos</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* Clemente */}
          <Link href="/dashboard/clemente" className="block rounded-xl p-4 space-y-3 hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#1e1f27', border: '1px solid #1d4ed8' }}>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-[15px] font-bold text-white flex-shrink-0"
                style={{ backgroundColor: '#1d4ed8' }}>C</div>
              <div>
                <p className="text-[14px] font-bold leading-tight" style={{ color: '#e2e1ed' }}>Clemente</p>
                <p className="text-[11px]" style={{ color: '#8e90a0' }}>6° D</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: '#8e90a0' }}>Prom.</p>
                <p className="text-[22px] font-bold leading-tight"
                  style={{ color: clementePromedio ? notaColor(parseFloat(clementePromedio)) : '#434655' }}>
                  {clementePromedio ?? '–'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: '#8e90a0' }}>Fechas</p>
                <p className="text-[22px] font-bold leading-tight" style={{ color: '#6bd8cb' }}>{clementeFechas.length}</p>
              </div>
              <span className="material-symbols-outlined" style={{ color: '#434655', fontSize: 20 }}>chevron_right</span>
            </div>
          </Link>

          {/* Raimundo */}
          <Link href="/dashboard/raimundo" className="block rounded-xl p-4 space-y-3 hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#1e1f27', border: '1px solid #7c3aed' }}>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-[15px] font-bold text-white flex-shrink-0"
                style={{ backgroundColor: '#7c3aed' }}>R</div>
              <div>
                <p className="text-[14px] font-bold leading-tight" style={{ color: '#e2e1ed' }}>Raimundo</p>
                <p className="text-[11px]" style={{ color: '#8e90a0' }}>4° A</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: '#8e90a0' }}>Prom.</p>
                <p className="text-[22px] font-bold leading-tight"
                  style={{ color: raimundoPromedio ? notaColor(parseFloat(raimundoPromedio)) : '#434655' }}>
                  {raimundoPromedio ?? '–'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: '#8e90a0' }}>Fechas</p>
                <p className="text-[22px] font-bold leading-tight" style={{ color: '#6bd8cb' }}>{raimundoFechas.length}</p>
              </div>
              <span className="material-symbols-outlined" style={{ color: '#434655', fontSize: 20 }}>chevron_right</span>
            </div>
          </Link>
        </div>
      </section>

      {/* EMPTY STATE */}
      {!hayContenido && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#434655' }}>inbox</span>
          <div>
            <p className="font-semibold" style={{ color: '#8e90a0' }}>Sin datos aún</p>
            <p className="text-[13px] mt-1" style={{ color: '#434655' }}>Corre el pipeline para poblar el dashboard</p>
          </div>
        </div>
      )}

    </div>
  )
}

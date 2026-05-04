import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type FechaRow = {
  id: string
  titulo: string
  fecha_evento: string
  asignatura: string | null
  alumno: string | null
  detalle: string | null
}

function StudentTag({ alumno }: { alumno: string | null }) {
  const name = alumno ?? ''
  if (!name) return null
  const bg = name.toLowerCase().includes('raimundo') ? '#7c3aed'
    : name.toLowerCase().includes('ambos') || name.toLowerCase().includes('shared') ? '#0d9488'
    : '#1d4ed8'
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-tight flex-shrink-0" style={{ backgroundColor: bg }}>
      {name.split(' ')[0]}
    </span>
  )
}

export default async function AgendaPage() {
  const hoy = new Date().toISOString().split('T')[0]

  const [{ data: proximas }, { data: pasadas }] = await Promise.all([
    supabase
      .from('items_colegio')
      .select('id, titulo, fecha_evento, asignatura, alumno, detalle')
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', hoy)
      .order('fecha_evento')
      .limit(30),
    supabase
      .from('items_colegio')
      .select('id, titulo, fecha_evento, asignatura, alumno, detalle')
      .eq('categoria', 'fecha_proxima')
      .lt('fecha_evento', hoy)
      .order('fecha_evento', { ascending: false })
      .limit(10),
  ])

  const renderItem = (f: FechaRow) => {
    const date = new Date(f.fecha_evento)
    const day = date.getDate()
    const month = date.toLocaleDateString('es-CL', { month: 'short' }).toUpperCase()
    const weekday = date.toLocaleDateString('es-CL', { weekday: 'short' }).toUpperCase()
    const dias = Math.ceil((date.getTime() - Date.now()) / 86400000)
    const isHoy = dias === 0
    const isMañana = dias === 1
    const isPasado = dias < 0

    return (
      <div key={f.id} className="rounded-xl p-4 flex items-start gap-4"
        style={{ backgroundColor: '#1e1f27', border: `1px solid ${isHoy ? '#ffb4ab' : '#434655'}` }}>
        <div className="text-center w-12 flex-shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: isPasado ? '#434655' : '#6bd8cb' }}>{month}</p>
          <p className="text-[22px] font-bold leading-tight" style={{ color: isPasado ? '#434655' : '#e2e1ed' }}>{day}</p>
          <p className="text-[10px] font-semibold uppercase" style={{ color: '#8e90a0' }}>{weekday}</p>
        </div>
        <div className="w-px self-stretch flex-shrink-0" style={{ backgroundColor: '#434655' }} />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold leading-snug" style={{ color: isPasado ? '#8e90a0' : '#e2e1ed' }}>{f.titulo}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <StudentTag alumno={f.alumno} />
            {f.asignatura && <span className="text-[11px]" style={{ color: '#8e90a0' }}>{f.asignatura}</span>}
          </div>
          {f.detalle && f.detalle !== f.titulo && (
            <p className="text-[12px] mt-1 line-clamp-2" style={{ color: '#8e90a0' }}>{f.detalle}</p>
          )}
        </div>
        {!isPasado && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 self-start mt-0.5"
            style={{
              color: isHoy ? '#ffb4ab' : isMañana ? '#d2bbff' : '#6bd8cb',
              border: `1px solid ${isHoy ? '#ffb4ab' : isMañana ? '#d2bbff' : '#6bd8cb'}`
            }}>
            {isHoy ? 'HOY' : isMañana ? 'MAÑANA' : `${dias}d`}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 mt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-bold tracking-tight" style={{ color: '#e2e1ed' }}>Agenda</h1>
        <p className="text-[12px] font-semibold uppercase tracking-widest" style={{ color: '#8e90a0' }}>
          {new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })}
        </p>
      </div>

      {!(proximas ?? []).length && !(pasadas ?? []).length ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#434655' }}>calendar_month</span>
          <p className="font-semibold" style={{ color: '#8e90a0' }}>Sin fechas en la agenda</p>
        </div>
      ) : (
        <>
          {(proximas ?? []).length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#6bd8cb' }} />
                <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: '#e2e1ed' }}>Próximas</h2>
              </div>
              {(proximas as FechaRow[]).map(renderItem)}
            </section>
          )}
          {(pasadas ?? []).length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#434655' }} />
                <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: '#8e90a0' }}>Pasadas</h2>
              </div>
              {(pasadas as FechaRow[]).map(renderItem)}
            </section>
          )}
        </>
      )}
    </div>
  )
}

// Server component — sin estado cliente, funciona con SSR

type FechaItem = {
  titulo: string
  fecha_evento: string
  asignatura?: string | null
  alumno?: string | null
}

function StudentDot({ alumno }: { alumno?: string | null }) {
  if (!alumno) return <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: '#1d4ed8' }} />
  if (alumno.toLowerCase().includes('raimundo')) return <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: '#7c3aed' }} />
  if (alumno.toLowerCase().includes('clemente')) return <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: '#1d4ed8' }} />
  return <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: '#6bd8cb' }} />
}

function tipoColor(tipo?: string | null) {
  if (!tipo) return '#6bd8cb'
  const t = tipo.toLowerCase()
  if (t.includes('prueba') || t.includes('control')) return '#ffb4ab'
  if (t.includes('entrega')) return '#d2bbff'
  if (t.includes('reunion') || t.includes('reunión')) return '#6bd8cb'
  return '#b7c4ff'
}

export default function CalendarioFechas({
  fechas,
  titulo = 'Próximas Fechas',
  accentColor = '#b7c4ff',
}: {
  fechas: FechaItem[]
  titulo?: string
  accentColor?: string
}) {
  if (fechas.length === 0) return null

  const hoy = new Date()
  const hoyStr = hoy.toISOString().split('T')[0]

  // Construir mapa de eventos por fecha
  const eventosPorFecha: Record<string, FechaItem[]> = {}
  for (const f of fechas) {
    if (!eventosPorFecha[f.fecha_evento]) eventosPorFecha[f.fecha_evento] = []
    eventosPorFecha[f.fecha_evento].push(f)
  }

  // Determinar rango de meses a mostrar
  const mesesAMostrar: { year: number; month: number }[] = []
  const primerFecha = new Date(fechas[0].fecha_evento + 'T12:00:00')
  const ultimaFecha = new Date(fechas[fechas.length - 1].fecha_evento + 'T12:00:00')

  let cur = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  const fin = new Date(ultimaFecha.getFullYear(), ultimaFecha.getMonth(), 1)
  while (cur <= fin) {
    mesesAMostrar.push({ year: cur.getFullYear(), month: cur.getMonth() })
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    if (mesesAMostrar.length >= 3) break
  }

  const DIAS_CORTO = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: accentColor }} />
        <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>{titulo}</h2>
      </div>

      {mesesAMostrar.map(({ year, month }) => {
        const primerDia = new Date(year, month, 1)
        const ultimoDia = new Date(year, month + 1, 0)
        const mesStr = `${year}-${String(month + 1).padStart(2, '0')}`
        const eventosDelMes = fechas.filter(f => f.fecha_evento.startsWith(mesStr))
        if (eventosDelMes.length === 0 && mesesAMostrar.length > 1) return null

        // Desplazamiento inicial (Lun=0)
        const offsetInicio = (primerDia.getDay() + 6) % 7
        const totalDias = ultimoDia.getDate()
        const celdas: (number | null)[] = [
          ...Array(offsetInicio).fill(null),
          ...Array.from({ length: totalDias }, (_, i) => i + 1),
        ]
        // Rellenar hasta múltiplo de 7
        while (celdas.length % 7 !== 0) celdas.push(null)

        return (
          <div key={`${year}-${month}`} className="rounded-xl overflow-hidden"
            style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}>

            {/* Encabezado mes */}
            <div className="px-4 py-3 flex items-center justify-between"
              style={{ borderBottom: '1px solid #33343d' }}>
              <p className="text-[13px] font-bold capitalize" style={{ color: '#e2e1ed' }}>
                {MESES[month]} {year}
              </p>
              <p className="text-[11px]" style={{ color: '#8e90a0' }}>
                {eventosDelMes.length} evento{eventosDelMes.length !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Grid días de la semana */}
            <div className="grid grid-cols-7 px-2 pt-2 pb-1">
              {DIAS_CORTO.map(d => (
                <div key={d} className="text-center py-1">
                  <span className="text-[10px] font-bold uppercase" style={{ color: '#434655' }}>{d}</span>
                </div>
              ))}
            </div>

            {/* Grid días */}
            <div className="grid grid-cols-7 px-2 pb-3">
              {celdas.map((dia, i) => {
                if (!dia) return <div key={i} />
                const fechaStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
                const eventos = eventosPorFecha[fechaStr] ?? []
                const esHoy = fechaStr === hoyStr
                const tienePrueba = eventos.some(e => e.titulo.toLowerCase().includes('prueba') || e.titulo.toLowerCase().includes('control'))
                const color = eventos.length > 0 ? tipoColor(tienePrueba ? 'prueba' : eventos[0].titulo) : null

                return (
                  <div key={i} className="flex flex-col items-center py-0.5">
                    <div
                      className="w-7 h-7 flex items-center justify-center rounded-full text-[12px] font-semibold"
                      style={{
                        backgroundColor: esHoy ? accentColor : eventos.length > 0 ? color + '22' : 'transparent',
                        color: esHoy ? '#11131b' : eventos.length > 0 ? color! : '#8e90a0',
                        fontWeight: esHoy || eventos.length > 0 ? 700 : 400,
                      }}
                    >
                      {dia}
                    </div>
                    {/* Dots de eventos */}
                    {eventos.length > 0 && !esHoy && (
                      <div className="flex gap-0.5 mt-0.5">
                        {eventos.slice(0, 3).map((e, j) => (
                          <span key={j} className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: tipoColor(e.titulo) }} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Lista agenda del mes */}
            <div className="divide-y" style={{ borderTop: '1px solid #33343d', borderColor: '#33343d' }}>
              {Object.entries(eventosPorFecha)
                .filter(([fecha]) => fecha.startsWith(mesStr))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([fechaStr, evs]) => {
                  const date = new Date(fechaStr + 'T12:00:00')
                  const dias = Math.ceil((date.getTime() - Date.now()) / 86400000)
                  const badge = dias <= 0 ? 'HOY' : dias === 1 ? 'MÑN' : `${dias}d`
                  const badgeColor = dias <= 0 ? '#ffb4ab' : dias <= 2 ? '#d2bbff' : '#6bd8cb'
                  const dayName = date.toLocaleDateString('es-CL', { weekday: 'short' })
                  const dayNum = date.getDate()

                  return (
                    <div key={fechaStr} className="px-4 py-3 flex gap-3">
                      {/* Fecha */}
                      <div className="flex-shrink-0 text-center w-10">
                        <p className="text-[10px] font-semibold uppercase" style={{ color: '#8e90a0' }}>{dayName}</p>
                        <p className="text-[18px] font-bold leading-tight" style={{ color: '#e2e1ed' }}>{dayNum}</p>
                      </div>

                      <div className="w-px self-stretch flex-shrink-0" style={{ backgroundColor: '#33343d' }} />

                      {/* Eventos del día */}
                      <div className="flex-1 space-y-2">
                        {evs.map((ev, j) => {
                          const color = tipoColor(ev.titulo)
                          return (
                            <div key={j} className="flex items-start gap-2">
                              <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                                style={{ backgroundColor: color }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold leading-tight" style={{ color: '#e2e1ed' }}>
                                  {ev.titulo}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {ev.asignatura && (
                                    <span className="text-[11px]" style={{ color: '#8e90a0' }}>{ev.asignatura}</span>
                                  )}
                                  {ev.alumno && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold text-white"
                                      style={{ backgroundColor: ev.alumno.toLowerCase().includes('raimundo') ? '#7c3aed' : '#1d4ed8' }}>
                                      {ev.alumno.split(' ')[0]}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{ color: badgeColor, border: `1px solid ${badgeColor}` }}>
                                {badge}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )
      })}
    </section>
  )
}

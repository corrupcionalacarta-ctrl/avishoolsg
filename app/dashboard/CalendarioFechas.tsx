// Server component — sin estado cliente, funciona con SSR

type FechaItem = {
  titulo: string
  fecha_evento: string
  asignatura?: string | null
  alumno?: string | null
}

function tipoColor(tipo?: string | null) {
  if (!tipo) return '#0d9488'
  const t = tipo.toLowerCase()
  if (t.includes('prueba') || t.includes('control')) return '#ef4444'
  if (t.includes('entrega')) return '#7c3aed'
  if (t.includes('reunion') || t.includes('reunión')) return '#0d9488'
  return '#3b82f6'
}

export default function CalendarioFechas({
  fechas,
  titulo = 'Próximas Fechas',
  accentColor = '#1e3a8a',
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
        <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>{titulo}</h2>
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
            style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>

            {/* Encabezado mes */}
            <div className="px-4 py-3 flex items-center justify-between"
              style={{ borderBottom: '1px solid #e2e8f0' }}>
              <p className="text-[13px] font-bold capitalize" style={{ color: '#1e293b' }}>
                {MESES[month]} {year}
              </p>
              <p className="text-[11px]" style={{ color: '#94a3b8' }}>
                {eventosDelMes.length} evento{eventosDelMes.length !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Grid días de la semana */}
            <div className="grid grid-cols-7 px-2 pt-2 pb-1">
              {DIAS_CORTO.map(d => (
                <div key={d} className="text-center py-1">
                  <span className="text-[10px] font-bold uppercase" style={{ color: '#cbd5e1' }}>{d}</span>
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
                        backgroundColor: esHoy ? accentColor : eventos.length > 0 ? color + '18' : 'transparent',
                        color: esHoy ? '#ffffff' : eventos.length > 0 ? color! : '#94a3b8',
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
            <div className="divide-y" style={{ borderTop: '1px solid #e2e8f0', borderColor: '#e2e8f0' }}>
              {Object.entries(eventosPorFecha)
                .filter(([fecha]) => fecha.startsWith(mesStr))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([fechaStr, evs]) => {
                  const date = new Date(fechaStr + 'T12:00:00')
                  const dias = Math.ceil((date.getTime() - Date.now()) / 86400000)
                  const badge = dias <= 0 ? 'HOY' : dias === 1 ? 'MÑN' : `${dias}d`
                  const badgeColor = dias <= 0 ? '#ef4444' : dias <= 2 ? '#d97706' : '#0d9488'
                  const dayName = date.toLocaleDateString('es-CL', { weekday: 'short' })
                  const dayNum = date.getDate()

                  return (
                    <div key={fechaStr} className="px-4 py-3 flex gap-3">
                      {/* Fecha */}
                      <div className="flex-shrink-0 text-center w-10">
                        <p className="text-[10px] font-semibold uppercase" style={{ color: '#94a3b8' }}>{dayName}</p>
                        <p className="text-[18px] font-bold leading-tight" style={{ color: '#1e293b' }}>{dayNum}</p>
                      </div>

                      <div className="w-px self-stretch flex-shrink-0" style={{ backgroundColor: '#e2e8f0' }} />

                      {/* Eventos del día */}
                      <div className="flex-1 space-y-2">
                        {evs.map((ev, j) => {
                          const color = tipoColor(ev.titulo)
                          return (
                            <div key={j} className="flex items-start gap-2">
                              <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                                style={{ backgroundColor: color }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold leading-tight" style={{ color: '#1e293b' }}>
                                  {ev.titulo}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {ev.asignatura && (
                                    <span className="text-[11px]" style={{ color: '#94a3b8' }}>{ev.asignatura}</span>
                                  )}
                                  {ev.alumno && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold text-white"
                                      style={{ backgroundColor: ev.alumno.toLowerCase().includes('raimundo') ? '#7c3aed' : '#1e3a8a' }}>
                                      {ev.alumno.split(' ')[0]}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{ color: badgeColor, border: `1px solid ${badgeColor}`, backgroundColor: badgeColor + '12' }}>
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

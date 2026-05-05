import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Card = {
  id: string
  titulo: string
  detalle?: string | null
  alumno?: string | null
  asignatura?: string | null
  fecha?: string | null
  dias?: number | null
  tipo: 'prueba' | 'entrega' | 'reunion' | 'evento' | 'autorizacion' | 'urgente' | 'importante' | 'anotacion'
  fuente: 'agenda' | 'digest' | 'conducta'
}

type Columna = {
  id: string
  label: string
  sublabel: string
  color: string
  bgColor: string
  icon: string
  cards: Card[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tipoCard(titulo: string, tipoRaw?: string): Card['tipo'] {
  const t = (tipoRaw || titulo).toLowerCase()
  if (t.includes('prueba') || t.includes('control') || t.includes('examen')) return 'prueba'
  if (t.includes('entrega') || t.includes('trabajo') || t.includes('tarea')) return 'entrega'
  if (t.includes('reunion') || t.includes('reunión') || t.includes('apoderado')) return 'reunion'
  if (t.includes('autoriza') || t.includes('firmar') || t.includes('permiso')) return 'autorizacion'
  return 'evento'
}

const TIPO_META: Record<Card['tipo'], { label: string; color: string; icon: string }> = {
  prueba:       { label: 'Prueba',        color: '#ffb4ab', icon: 'quiz' },
  entrega:      { label: 'Entrega',       color: '#d2bbff', icon: 'assignment_turned_in' },
  reunion:      { label: 'Reunión',       color: '#6bd8cb', icon: 'groups' },
  evento:       { label: 'Evento',        color: '#b7c4ff', icon: 'event' },
  autorizacion: { label: 'Autorización',  color: '#ffb4ab', icon: 'edit_document' },
  urgente:      { label: 'Urgente',       color: '#ffb4ab', icon: 'warning' },
  importante:   { label: 'Importante',    color: '#d2bbff', icon: 'info' },
  anotacion:    { label: 'Anotación',     color: '#ffb4ab', icon: 'report' },
}

function alumnoColor(alumno?: string | null) {
  if (!alumno) return '#1d4ed8'
  return alumno.toLowerCase().includes('raimundo') ? '#7c3aed' : '#1d4ed8'
}

function CardUI({ card }: { card: Card }) {
  const meta = TIPO_META[card.tipo]
  const aColor = alumnoColor(card.alumno)

  return (
    <div className="rounded-xl p-3 space-y-2.5"
      style={{ backgroundColor: '#1e1f27', border: '1px solid #2a2b35' }}>

      {/* Header: tipo + alumno */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined" style={{ color: meta.color, fontSize: 14 }}>{meta.icon}</span>
          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>
        {card.alumno && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: aColor }}>
            {card.alumno.split(' ')[0]}
          </span>
        )}
      </div>

      {/* Título */}
      <p className="text-[13px] font-semibold leading-tight" style={{ color: '#e2e1ed' }}>
        {card.titulo}
      </p>

      {/* Detalle */}
      {card.detalle && card.detalle !== card.titulo && (
        <p className="text-[11px] leading-4 line-clamp-3" style={{ color: '#8e90a0' }}>
          {card.detalle}
        </p>
      )}

      {/* Footer: asignatura + fecha */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        {card.asignatura ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: '#33343d', color: '#8e90a0' }}>
            {card.asignatura}
          </span>
        ) : <span />}

        {card.fecha && (
          <div className="flex items-center gap-1">
            {card.dias !== null && card.dias !== undefined && (
              <span className="text-[11px] font-bold"
                style={{ color: card.dias <= 0 ? '#ffb4ab' : card.dias <= 2 ? '#d2bbff' : '#6bd8cb' }}>
                {card.dias <= 0 ? 'HOY' : card.dias === 1 ? 'MÑN' : `${card.dias}d`}
              </span>
            )}
            <span className="text-[10px]" style={{ color: '#434655' }}>
              {new Date(card.fecha + 'T12:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function Columna({ col }: { col: Columna }) {
  return (
    <div className="flex-shrink-0 w-72 flex flex-col gap-2">
      {/* Header columna */}
      <div className="flex items-center gap-2 px-1 py-2">
        <span className="material-symbols-outlined" style={{ color: col.color, fontSize: 18 }}>{col.icon}</span>
        <div className="flex-1">
          <p className="text-[13px] font-bold leading-tight" style={{ color: col.color }}>{col.label}</p>
          <p className="text-[10px]" style={{ color: '#434655' }}>{col.sublabel}</p>
        </div>
        <span className="text-[11px] font-bold w-6 h-6 rounded-full flex items-center justify-center"
          style={{ backgroundColor: col.color + '22', color: col.color }}>
          {col.cards.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {col.cards.length === 0 ? (
          <div className="rounded-xl p-4 text-center"
            style={{ backgroundColor: '#1e1f27', border: '1px dashed #2a2b35' }}>
            <p className="text-[12px]" style={{ color: '#434655' }}>Sin items</p>
          </div>
        ) : (
          col.cards.map((card, i) => <CardUI key={i} card={card} />)
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TableroPage() {
  const hoy = new Date()
  const hoyStr = hoy.toISOString().split('T')[0]
  const en2 = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0]
  const en7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  const en30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

  const [digestRes, fechasRes, anotNegRes] = await Promise.all([
    supabase
      .from('digests')
      .select('json_completo')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('items_colegio')
      .select('titulo, detalle, fecha_evento, asignatura, alumno, categoria')
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', hoyStr)
      .lte('fecha_evento', en30)
      .order('fecha_evento'),
    supabase
      .from('anotaciones')
      .select('descripcion, titulo, alumno, fecha')
      .eq('tipo', 'negativa')
      .gte('fecha', new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0])
      .order('fecha', { ascending: false }),
  ])

  const json = (digestRes.data?.json_completo ?? {}) as Record<string, unknown>
  const urgentes   = (json.urgentes   as { titulo: string; detalle: string; dia?: string }[]    ?? [])
  const importantes = (json.importantes as { titulo: string; detalle: string; dias_restantes?: number }[] ?? [])
  const autorizaciones = (json.autorizaciones_pendientes as { titulo: string; fecha_limite?: string }[] ?? [])

  const rawFechas = (fechasRes.data ?? []) as {
    titulo: string; detalle: string | null; fecha_evento: string;
    asignatura: string | null; alumno: string | null
  }[]

  const anotNeg = (anotNegRes.data ?? []) as {
    descripcion: string | null; titulo: string | null; alumno: string | null; fecha: string | null
  }[]

  // Calcular días restantes
  function dias(fecha: string) {
    return Math.ceil((new Date(fecha + 'T12:00:00').getTime() - Date.now()) / 86400000)
  }

  // ─── Construir columnas ────────────────────────────────────────────────────

  // COLUMNA 1: Hoy / Mañana (≤2 días)
  const colHoy: Card[] = [
    ...urgentes.map((u, i) => ({
      id: `urg-${i}`, titulo: u.titulo, detalle: u.detalle,
      tipo: 'urgente' as const, fuente: 'digest' as const,
      dias: null, fecha: null, alumno: null, asignatura: null,
    })),
    ...autorizaciones.map((a, i) => ({
      id: `auth-${i}`, titulo: a.titulo, detalle: a.fecha_limite ? `Hasta: ${a.fecha_limite}` : undefined,
      tipo: 'autorizacion' as const, fuente: 'digest' as const,
      dias: null, fecha: a.fecha_limite ?? null, alumno: null, asignatura: null,
    })),
    ...rawFechas
      .filter(f => f.titulo?.trim() && dias(f.fecha_evento) <= 2)
      .map((f, i) => ({
        id: `f0-${i}`, titulo: f.titulo, detalle: f.detalle,
        tipo: tipoCard(f.titulo), fuente: 'agenda' as const,
        fecha: f.fecha_evento, dias: dias(f.fecha_evento),
        alumno: f.alumno, asignatura: f.asignatura,
      })),
  ]

  // COLUMNA 2: Esta semana (3-7 días)
  const colSemana: Card[] = [
    ...importantes.map((u, i) => ({
      id: `imp-${i}`, titulo: u.titulo, detalle: u.detalle,
      tipo: 'importante' as const, fuente: 'digest' as const,
      dias: u.dias_restantes ?? null, fecha: null, alumno: null, asignatura: null,
    })),
    ...rawFechas
      .filter(f => f.titulo?.trim() && dias(f.fecha_evento) > 2 && dias(f.fecha_evento) <= 7)
      .map((f, i) => ({
        id: `f1-${i}`, titulo: f.titulo, detalle: f.detalle,
        tipo: tipoCard(f.titulo), fuente: 'agenda' as const,
        fecha: f.fecha_evento, dias: dias(f.fecha_evento),
        alumno: f.alumno, asignatura: f.asignatura,
      })),
  ]

  // COLUMNA 3: Próximo (8-30 días)
  const colProximo: Card[] = rawFechas
    .filter(f => f.titulo?.trim() && dias(f.fecha_evento) > 7)
    .map((f, i) => ({
      id: `f2-${i}`, titulo: f.titulo, detalle: f.detalle,
      tipo: tipoCard(f.titulo), fuente: 'agenda' as const,
      fecha: f.fecha_evento, dias: dias(f.fecha_evento),
      alumno: f.alumno, asignatura: f.asignatura,
    }))

  // COLUMNA 4: Anotaciones recientes
  const colAnotaciones: Card[] = anotNeg.map((a, i) => ({
    id: `anot-${i}`,
    titulo: a.titulo || a.descripcion || 'Anotación negativa',
    detalle: a.titulo ? a.descripcion ?? undefined : undefined,
    tipo: 'anotacion' as const,
    fuente: 'conducta' as const,
    fecha: a.fecha, dias: a.fecha ? dias(a.fecha) : null,
    alumno: a.alumno, asignatura: null,
  }))

  const columnas: Columna[] = [
    {
      id: 'hoy', label: 'Hoy / Mañana', sublabel: 'Acción inmediata',
      color: '#ffb4ab', bgColor: '#93000a22', icon: 'priority_high',
      cards: colHoy,
    },
    {
      id: 'semana', label: 'Esta semana', sublabel: 'Próximos 7 días',
      color: '#d2bbff', bgColor: '#7c3aed22', icon: 'date_range',
      cards: colSemana,
    },
    {
      id: 'proximo', label: 'Próximo', sublabel: 'En 2 a 4 semanas',
      color: '#b7c4ff', bgColor: '#1d4ed822', icon: 'calendar_month',
      cards: colProximo,
    },
    {
      id: 'conducta', label: 'Conducta', sublabel: 'Anotaciones recientes',
      color: '#6bd8cb', bgColor: '#0d948822', icon: 'report',
      cards: colAnotaciones,
    },
  ]

  const totalCards = columnas.reduce((a, c) => a + c.cards.length, 0)

  return (
    <div className="mt-4 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold" style={{ color: '#e2e1ed' }}>Tablero</h1>
          <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: '#8e90a0' }}>
            {totalCards} item{totalCards !== 1 ? 's' : ''} activos
          </p>
        </div>
        <div className="flex gap-1">
          {['C', 'R'].map((l, i) => (
            <div key={l} className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
              style={{ backgroundColor: i === 0 ? '#1d4ed8' : '#7c3aed' }}>{l}</div>
          ))}
        </div>
      </div>

      {/* Leyenda tipos */}
      <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
        {Object.entries(TIPO_META).map(([key, m]) => (
          <div key={key} className="flex items-center gap-1 flex-shrink-0 px-2 py-1 rounded-full"
            style={{ backgroundColor: m.color + '15', border: `1px solid ${m.color}33` }}>
            <span className="material-symbols-outlined" style={{ color: m.color, fontSize: 12 }}>{m.icon}</span>
            <span className="text-[10px] font-semibold" style={{ color: m.color }}>{m.label}</span>
          </div>
        ))}
      </div>

      {/* Tablero Kanban — scroll horizontal */}
      <div className="flex gap-4 overflow-x-auto pb-6 -mx-4 px-4"
        style={{ scrollSnapType: 'x mandatory' }}>
        {columnas.map(col => (
          <div key={col.id} style={{ scrollSnapAlign: 'start' }}>
            <Columna col={col} />
          </div>
        ))}
      </div>

    </div>
  )
}

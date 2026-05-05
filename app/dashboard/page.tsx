import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import RefreshButton from './RefreshButton'
import CalendarioFechas from './CalendarioFechas'

const ALUMNOS = [
  { slug: 'clemente', nombre: 'Clemente', color: '#1d4ed8' },
  { slug: 'raimundo', nombre: 'Raimundo', color: '#7c3aed' },
]

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
  detalle: string | null
}

type UrgItem = { titulo: string; detalle: string; dia?: string }
type ImpItem = { titulo: string; detalle: string; dias_restantes?: number }
type FechaJson = { fecha: string; evento: string; asignatura?: string; tipo?: string }
type AutorizItem = { titulo: string; fecha_limite?: string }

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
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-tight"
      style={{ backgroundColor: isRaimundo ? '#7c3aed' : '#1d4ed8' }}>
      {name.split(' ')[0]}
    </span>
  )
}

function TipoBadge({ tipo }: { tipo?: string }) {
  if (!tipo) return null
  const map: Record<string, { label: string; color: string }> = {
    prueba:   { label: 'Prueba',   color: '#ffb4ab' },
    control:  { label: 'Control',  color: '#ffb4ab' },
    entrega:  { label: 'Entrega',  color: '#d2bbff' },
    reunion:  { label: 'Reunión',  color: '#6bd8cb' },
    evento:   { label: 'Evento',   color: '#b7c4ff' },
    salida:   { label: 'Salida',   color: '#b7c4ff' },
  }
  const t = map[tipo.toLowerCase()] ?? { label: tipo, color: '#8e90a0' }
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
      style={{ backgroundColor: t.color + '22', color: t.color }}>
      {t.label}
    </span>
  )
}

export default async function DashboardPage() {
  const hoy = new Date().toISOString().split('T')[0]
  const en7 = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split('T')[0]

  const [digestRes, fechasRes, notasRes, anotNegRes] = await Promise.all([
    supabase
      .from('digests')
      .select('resumen_ejecutivo, created_at, json_completo')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('items_colegio')
      .select('titulo, fecha_evento, asignatura, alumno, detalle')
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', hoy)
      .order('fecha_evento')
      .limit(20),
    supabase
      .from('notas')
      .select('alumno, asignatura, nota, promedio_curso')
      .order('extraido_en', { ascending: false })
      .limit(20),
    supabase
      .from('anotaciones')
      .select('alumno, descripcion, titulo, fecha')
      .eq('tipo', 'negativa')
      .gte('fecha', hoy)
      .order('fecha', { ascending: false }),
  ])

  const anotNegHoy = (anotNegRes.data ?? []) as { alumno: string | null; descripcion: string | null; titulo: string | null; fecha: string | null }[]
  const digest = digestRes.data
  const json = (digest?.json_completo ?? {}) as Record<string, unknown>
  const urgentes      = (json.urgentes               as UrgItem[]      ?? [])
  const importantes   = (json.importantes             as ImpItem[]      ?? [])
  const utiles        = (json.utiles_mañana           as string[]       ?? [])
  const autorizaciones = (json.autorizaciones_pendientes as AutorizItem[] ?? [])
  const colacion      = (json.colacion_especial       as string | undefined)
  const fechasJson    = (json.fechas_proximas         as FechaJson[]    ?? [])

  // Mapa titulo→tipo para enriquecer los items_colegio con el tipo de Gemini
  const tipoMap: Record<string, string> = {}
  for (const f of fechasJson) {
    if (f.tipo) tipoMap[f.evento] = f.tipo
  }

  const allFechas = (fechasRes.data as FechaRow[] ?? [])
    .filter(f => {
      if (!f.titulo?.trim() || !f.fecha_evento) return false
      const d = new Date(f.fecha_evento + 'T12:00:00')
      return !isNaN(d.getTime())
    })
  const semanaFechas = allFechas.filter(f => f.fecha_evento <= en7)
  const allNotas   = (notasRes.data as NotaRow[] ?? [])

  const clementeNotas  = allNotas.filter(n => !n.alumno || n.alumno.toLowerCase().includes('clemente'))
  const raimundoNotas  = allNotas.filter(n => n.alumno?.toLowerCase().includes('raimundo'))
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

  const hayContenido = urgentes.length > 0 || utiles.length > 0 || importantes.length > 0 || allFechas.length > 0 || allNotas.length > 0 || anotNegHoy.length > 0

  return (
    <div className="space-y-5 mt-4">

      {/* HEADER */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-widest shrink-0" style={{ color: '#8e90a0' }}>
          {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <div className="flex items-center gap-1">
          {ALUMNOS.map(a => (
            <Link key={a.slug} href={`/dashboard/${a.slug}`}
              className="px-3 py-1 rounded-full text-[12px] font-bold"
              style={{ backgroundColor: '#1e1f27', color: '#8e90a0', border: '1px solid #434655' }}>
              {a.nombre}
            </Link>
          ))}
        </div>
        <RefreshButton />
      </div>

      {/* 1. ACTUALIZACIÓN DEL DÍA */}
      {(digest || utiles.length > 0) && (
        <section className="rounded-xl overflow-hidden" style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}>
          <div className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: '#6bd8cb', fontSize: 18 }}>wb_sunny</span>
              <h2 className="text-[14px] font-bold uppercase tracking-widest" style={{ color: '#6bd8cb' }}>
                Hoy{digestHora ? ` · ${digestHora}` : ''}
              </h2>
            </div>
            {digest?.resumen_ejecutivo && (
              <p className="text-[13px] leading-5" style={{ color: '#c4c5d7' }}>{digest.resumen_ejecutivo}</p>
            )}
          </div>

          {/* Colación especial */}
          {colacion && (
            <div className="px-4 pb-3 flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: '#d2bbff', fontSize: 16 }}>restaurant</span>
              <span className="text-[12px]" style={{ color: '#d2bbff' }}><b>Colación:</b> {colacion}</span>
            </div>
          )}

          {/* Útiles */}
          {utiles.length > 0 && (
            <div className="px-4 pb-4 pt-1 space-y-1 border-t" style={{ borderColor: '#33343d' }}>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#8e90a0' }}>Llevar mañana</p>
              {utiles.map((u, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ color: '#6bd8cb', fontSize: 16 }}>backpack</span>
                  <span className="text-[13px]" style={{ color: '#e2e1ed' }}>{u}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 2. AUTORIZACIONES PENDIENTES */}
      {autorizaciones.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#ffb4ab' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Firmar / Entregar</h2>
          </div>
          {autorizaciones.map((a, i) => (
            <div key={i} className="rounded-xl p-4 flex items-start gap-3"
              style={{ backgroundColor: '#1e1f27', border: '1px solid #93000a' }}>
              <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#ffb4ab', fontSize: 18 }}>edit_document</span>
              <div>
                <p className="text-[13px] font-bold" style={{ color: '#e2e1ed' }}>{a.titulo}</p>
                {a.fecha_limite && (
                  <p className="text-[11px] mt-0.5" style={{ color: '#ffb4ab' }}>Hasta: {a.fecha_limite}</p>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ANOTACIONES NEGATIVAS HOY */}
      {anotNegHoy.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#ffb4ab' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Anotaciones de Hoy</h2>
          </div>
          {anotNegHoy.map((a, i) => (
            <div key={i} className="rounded-xl p-4 flex items-start gap-3"
              style={{ backgroundColor: '#1e1f27', border: '1px solid #93000a' }}>
              <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#ffb4ab', fontSize: 18 }}>report</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <StudentTag alumno={a.alumno} />
                  {a.titulo && <p className="text-[13px] font-bold truncate" style={{ color: '#e2e1ed' }}>{a.titulo}</p>}
                </div>
                {a.descripcion && <p className="text-[12px] leading-5" style={{ color: '#c4c5d7' }}>{a.descripcion}</p>}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 3. REQUIEREN ACCIÓN */}
      {urgentes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#ffb4ab' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Requieren Acción</h2>
          </div>
          {urgentes.map((u, i) => (
            <details key={i} className="rounded-xl overflow-hidden group"
              style={{ backgroundColor: '#1e1f27', border: '1px solid #93000a' }}>
              <summary className="p-4 flex items-start gap-3 cursor-pointer list-none">
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#ffb4ab', fontSize: 18 }}>warning</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold" style={{ color: '#e2e1ed' }}>{u.titulo}</p>
                  {u.dia && (
                    <p className="text-[11px] mt-0.5 uppercase font-semibold" style={{ color: '#ffb4ab' }}>{u.dia}</p>
                  )}
                </div>
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5 transition-transform group-open:rotate-180"
                  style={{ color: '#8e90a0', fontSize: 18 }}>expand_more</span>
              </summary>
              <div className="px-4 pb-4 pt-1" style={{ borderTop: '1px solid #93000a33' }}>
                <p className="text-[13px] leading-5" style={{ color: '#c4c5d7' }}>{u.detalle}</p>
              </div>
            </details>
          ))}
        </section>
      )}

      {/* 4. IMPORTANTE ESTA SEMANA */}
      {importantes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#d2bbff' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#e2e1ed' }}>Importante esta semana</h2>
          </div>
          {importantes.map((u, i) => (
            <details key={i} className="rounded-xl overflow-hidden group"
              style={{ backgroundColor: '#1e1f27', border: '1px solid #434655' }}>
              <summary className="p-4 flex items-start gap-3 cursor-pointer list-none">
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#d2bbff', fontSize: 18 }}>info</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold" style={{ color: '#e2e1ed' }}>{u.titulo}</p>
                  {u.dias_restantes !== undefined && u.dias_restantes > 0 && (
                    <p className="text-[11px] mt-0.5" style={{ color: '#8e90a0' }}>en {u.dias_restantes} día{u.dias_restantes !== 1 ? 's' : ''}</p>
                  )}
                </div>
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5 transition-transform group-open:rotate-180"
                  style={{ color: '#8e90a0', fontSize: 18 }}>expand_more</span>
              </summary>
              <div className="px-4 pb-4 pt-1" style={{ borderTop: '1px solid #43465540' }}>
                <p className="text-[13px] leading-5" style={{ color: '#c4c5d7' }}>{u.detalle}</p>
              </div>
            </details>
          ))}
        </section>
      )}

      {/* 5. CALENDARIO DE FECHAS */}
      <CalendarioFechas fechas={allFechas} titulo="Próximas Fechas" />

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

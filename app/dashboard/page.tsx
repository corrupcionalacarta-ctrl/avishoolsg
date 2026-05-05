import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import RefreshButton from './RefreshButton'
import CalendarioFechas from './CalendarioFechas'

const ALUMNOS = [
  { slug: 'clemente', nombre: 'Clemente', color: '#1e3a8a' },
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
  if (!nota) return '#94a3b8'
  if (nota >= 6) return '#0d9488'
  if (nota >= 5) return '#7c3aed'
  return '#ef4444'
}

function StudentTag({ alumno }: { alumno: string | null }) {
  const name = alumno ?? 'Clemente'
  const isRaimundo = name.toLowerCase().includes('raimundo')
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-tight"
      style={{ backgroundColor: isRaimundo ? '#7c3aed' : '#1e3a8a' }}>
      {name.split(' ')[0]}
    </span>
  )
}

function TipoBadge({ tipo }: { tipo?: string }) {
  if (!tipo) return null
  const map: Record<string, { label: string; color: string }> = {
    prueba:   { label: 'Prueba',   color: '#ef4444' },
    control:  { label: 'Control',  color: '#ef4444' },
    entrega:  { label: 'Entrega',  color: '#7c3aed' },
    reunion:  { label: 'Reunión',  color: '#0d9488' },
    evento:   { label: 'Evento',   color: '#3b82f6' },
    salida:   { label: 'Salida',   color: '#3b82f6' },
  }
  const t = map[tipo.toLowerCase()] ?? { label: tipo, color: '#94a3b8' }
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
        <p className="text-[12px] font-semibold uppercase tracking-widest shrink-0" style={{ color: '#94a3b8' }}>
          {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <div className="flex items-center gap-1">
          {ALUMNOS.map(a => (
            <Link key={a.slug} href={`/dashboard/${a.slug}`}
              className="px-3 py-1 rounded-full text-[12px] font-bold"
              style={{ backgroundColor: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0' }}>
              {a.nombre}
            </Link>
          ))}
        </div>
        <RefreshButton />
      </div>

      {/* 1. ACTUALIZACIÓN DEL DÍA */}
      {(digest || utiles.length > 0) && (
        <section className="rounded-xl overflow-hidden" style={{ backgroundColor: '#fffbeb', border: '1px solid #fcd34d', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: '#d97706', fontSize: 18 }}>wb_sunny</span>
              <h2 className="text-[14px] font-bold uppercase tracking-widest" style={{ color: '#d97706' }}>
                Hoy{digestHora ? ` · ${digestHora}` : ''}
              </h2>
            </div>
            {digest?.resumen_ejecutivo && (
              <p className="text-[13px] leading-5" style={{ color: '#475569' }}>{digest.resumen_ejecutivo}</p>
            )}
          </div>

          {/* Colación especial */}
          {colacion && (
            <div className="px-4 pb-3 flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: '#7c3aed', fontSize: 16 }}>restaurant</span>
              <span className="text-[12px]" style={{ color: '#7c3aed' }}><b>Colación:</b> {colacion}</span>
            </div>
          )}

          {/* Útiles */}
          {utiles.length > 0 && (
            <div className="px-4 pb-4 pt-1 space-y-1 border-t" style={{ borderColor: '#f8fafc' }}>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#94a3b8' }}>Llevar mañana</p>
              {utiles.map((u, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ color: '#0d9488', fontSize: 16 }}>backpack</span>
                  <span className="text-[13px]" style={{ color: '#1e293b' }}>{u}</span>
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
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#ef4444' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Firmar / Entregar</h2>
          </div>
          {autorizaciones.map((a, i) => (
            <div key={i} className="rounded-xl p-4 flex items-start gap-3"
              style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#ef4444', fontSize: 18 }}>edit_document</span>
              <div>
                <p className="text-[13px] font-bold" style={{ color: '#1e293b' }}>{a.titulo}</p>
                {a.fecha_limite && (
                  <p className="text-[11px] mt-0.5" style={{ color: '#ef4444' }}>Hasta: {a.fecha_limite}</p>
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
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#ef4444' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Anotaciones de Hoy</h2>
          </div>
          {anotNegHoy.map((a, i) => (
            <div key={i} className="rounded-xl p-4 flex items-start gap-3"
              style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#ef4444', fontSize: 18 }}>report</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <StudentTag alumno={a.alumno} />
                  {a.titulo && <p className="text-[13px] font-bold truncate" style={{ color: '#1e293b' }}>{a.titulo}</p>}
                </div>
                {a.descripcion && <p className="text-[12px] leading-5" style={{ color: '#475569' }}>{a.descripcion}</p>}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 3. REQUIEREN ACCIÓN */}
      {urgentes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#ef4444' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Requieren Acción</h2>
          </div>
          {urgentes.map((u, i) => (
            <details key={i} className="rounded-xl overflow-hidden group"
              style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <summary className="p-4 flex items-start gap-3 cursor-pointer list-none">
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#ef4444', fontSize: 18 }}>warning</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold" style={{ color: '#1e293b' }}>{u.titulo}</p>
                  {u.dia && (
                    <p className="text-[11px] mt-0.5 uppercase font-semibold" style={{ color: '#ef4444' }}>{u.dia}</p>
                  )}
                </div>
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5 transition-transform group-open:rotate-180"
                  style={{ color: '#94a3b8', fontSize: 18 }}>expand_more</span>
              </summary>
              <div className="px-4 pb-4 pt-1" style={{ borderTop: '1px solid #fca5a544' }}>
                <p className="text-[13px] leading-5" style={{ color: '#475569' }}>{u.detalle}</p>
              </div>
            </details>
          ))}
        </section>
      )}

      {/* 4. IMPORTANTE ESTA SEMANA */}
      {importantes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#7c3aed' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>Importante esta semana</h2>
          </div>
          {importantes.map((u, i) => (
            <details key={i} className="rounded-xl overflow-hidden group"
              style={{ backgroundColor: '#faf5ff', border: '1px solid #e9d5ff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <summary className="p-4 flex items-start gap-3 cursor-pointer list-none">
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: '#7c3aed', fontSize: 18 }}>info</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold" style={{ color: '#1e293b' }}>{u.titulo}</p>
                  {u.dias_restantes !== undefined && u.dias_restantes > 0 && (
                    <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>en {u.dias_restantes} día{u.dias_restantes !== 1 ? 's' : ''}</p>
                  )}
                </div>
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5 transition-transform group-open:rotate-180"
                  style={{ color: '#94a3b8', fontSize: 18 }}>expand_more</span>
              </summary>
              <div className="px-4 pb-4 pt-1" style={{ borderTop: '1px solid #e2e8f080' }}>
                <p className="text-[13px] leading-5" style={{ color: '#475569' }}>{u.detalle}</p>
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
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#cbd5e1' }}>inbox</span>
          <div>
            <p className="font-semibold" style={{ color: '#94a3b8' }}>Sin datos aún</p>
            <p className="text-[13px] mt-1" style={{ color: '#cbd5e1' }}>Corre el pipeline para poblar el dashboard</p>
          </div>
        </div>
      )}

    </div>
  )
}

import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import RefreshButton from './RefreshButton'
import CalendarioFechas from './CalendarioFechas'
import UrgentesSection from './UrgentesSection'
import { calcScore, scoreColor, calcRiesgo } from '@/lib/analytics'

const ALUMNOS = [
  { slug: 'clemente', nombre: 'Clemente', color: '#1e3a8a' },
  { slug: 'raimundo', nombre: 'Raimundo', color: '#7c3aed' },
]

export const dynamic = 'force-dynamic'

type NotaRow = { alumno: string | null; asignatura: string; nota: number | null; promedio_curso: number | null; fecha: string | null }
type AnotRow = { alumno: string | null; tipo: string | null; fecha: string | null }
type FechaRow = { titulo: string; fecha_evento: string; asignatura: string | null; alumno: string | null; detalle: string | null }
type AnalisisRow = { alumno: string; tendencia_academica: string | null; nivel_alerta: string | null }
type UrgItem = { titulo: string; detalle: string; dia?: string }
type ImpItem = { titulo: string; detalle: string; dias_restantes?: number }
type AutorizItem = { titulo: string; fecha_limite?: string }
type FechaJson = { fecha: string; evento: string; asignatura?: string; tipo?: string }

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

export default async function DashboardPage() {
  const hoy = new Date().toISOString().split('T')[0]
  const en7 = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split('T')[0]
  const hace30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0]

  const [digestRes, fechasRes, notasRes, anotRes, analisisRes] = await Promise.all([
    supabase.from('digests').select('resumen_ejecutivo, created_at, json_completo').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('items_colegio').select('titulo, fecha_evento, asignatura, alumno, detalle').eq('categoria', 'fecha_proxima').gte('fecha_evento', hoy).order('fecha_evento').limit(30),
    supabase.from('notas').select('alumno, asignatura, nota, promedio_curso, fecha').order('extraido_en', { ascending: false }).limit(60),
    supabase.from('anotaciones').select('alumno, tipo, titulo, descripcion, fecha').gte('fecha', hace30).order('fecha', { ascending: false }),
    supabase.from('analisis_alumno').select('alumno, tendencia_academica, nivel_alerta').order('generado_en', { ascending: false }).limit(4),
  ])

  const allNotas   = (notasRes.data  ?? []) as NotaRow[]
  const allAnot    = (anotRes.data   ?? []) as AnotRow[]
  const allFechasRaw = (fechasRes.data ?? []) as FechaRow[]
  const analisisAll  = (analisisRes.data ?? []) as AnalisisRow[]
  const digest = digestRes.data

  const json            = (digest?.json_completo ?? {}) as Record<string, unknown>
  const urgentes        = (json.urgentes                  as UrgItem[]      ?? [])
  const importantes     = (json.importantes               as ImpItem[]      ?? [])
  const utiles          = (json.utiles_mañana             as string[]       ?? [])
  const autorizaciones  = (json.autorizaciones_pendientes as AutorizItem[]  ?? [])
  const colacion        = (json.colacion_especial         as string | undefined)
  const fechasJson      = (json.fechas_proximas           as FechaJson[]    ?? [])

  const allFechas = allFechasRaw.filter(f => f.titulo?.trim() && f.fecha_evento && !isNaN(new Date(f.fecha_evento + 'T12:00:00').getTime()))

  const digestHora = digest?.created_at
    ? new Date(digest.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    : null

  // Score por alumno
  const analisisBySlug: Record<string, AnalisisRow> = {}
  for (const a of analisisAll) {
    const key = a.alumno.split(' ')[0].toLowerCase()
    if (!analisisBySlug[key]) analisisBySlug[key] = a
  }

  function scoreAlumno(slug: string) {
    const notas = allNotas.filter(n => (n.alumno ?? '').toLowerCase().includes(slug))
    const anot  = allAnot.filter(a => (a.alumno ?? '').toLowerCase().includes(slug))
    const analisis = analisisBySlug[slug] ?? null
    return calcScore(notas, anot, analisis)
  }

  const scoreC = scoreAlumno('clemente')
  const scoreR = scoreAlumno('raimundo')

  // Anotaciones negativas hoy
  const anotNegHoy = allAnot.filter(a => a.tipo === 'negativa' && a.fecha === hoy)

  // Riesgo esta semana (pruebas próximas × historial notas)
  const pruebasProximas = allFechas.filter(f => f.fecha_evento <= en7 &&
    (f.detalle?.toLowerCase().includes('prueba') || f.detalle?.toLowerCase().includes('control') ||
     f.titulo?.toLowerCase().includes('prueba') || f.titulo?.toLowerCase().includes('control') ||
     fechasJson.find(fj => fj.evento === f.titulo && (fj.tipo === 'prueba' || fj.tipo === 'control'))))
  const riesgos = calcRiesgo(pruebasProximas, allNotas)

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
            <Link key={a.slug} href={`/alumnos/${a.slug}`}
              className="px-3 py-1 rounded-full text-[12px] font-bold"
              style={{ backgroundColor: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0' }}>
              {a.nombre}
            </Link>
          ))}
        </div>
        <RefreshButton />
      </div>

      {/* SCORE CARDS */}
      {(allNotas.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { slug: 'clemente', nombre: 'Clemente', color: '#1e3a8a', score: scoreC },
            { slug: 'raimundo', nombre: 'Raimundo', color: '#7c3aed', score: scoreR },
          ].map(({ slug, nombre, color, score }) => (
            <Link key={slug} href={`/alumnos/${slug}`}
              className="rounded-2xl p-4 flex flex-col items-center gap-1 transition-transform active:scale-[0.98]"
              style={{ backgroundColor: '#f8fafc', border: `2px solid ${scoreColor(score)}33`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#94a3b8' }}>{nombre}</p>
              <p className="text-[42px] font-black leading-none" style={{ color: scoreColor(score) }}>{score}</p>
              <p className="text-[10px] font-semibold" style={{ color: '#cbd5e1' }}>/ 10 esta semana</p>
              <div className="mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{ backgroundColor: scoreColor(score) + '18', color: scoreColor(score) }}>
                {score >= 7 ? '↑ Bien' : score >= 5 ? '→ Estable' : '↓ Atención'}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* EN RIESGO ESTA SEMANA */}
      {riesgos.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: '#f97316' }} />
            <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>En riesgo esta semana</h2>
          </div>
          {riesgos.map((r, i) => (
            <div key={i} className="rounded-xl p-4 flex items-start gap-3"
              style={{ backgroundColor: r.nivel === 'alto' ? '#fef2f2' : '#fffbeb', border: `1px solid ${r.nivel === 'alto' ? '#fca5a5' : '#fcd34d'}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <span className="material-symbols-outlined flex-shrink-0 mt-0.5"
                style={{ color: r.nivel === 'alto' ? '#ef4444' : '#d97706', fontSize: 18 }}>
                {r.nivel === 'alto' ? 'priority_high' : 'warning'}
              </span>
              <div className="flex-1 min-w-0">
                {r.alumno && <StudentTag alumno={r.alumno} />}
                <p className="text-[13px] font-bold mt-0.5" style={{ color: '#1e293b' }}>{r.titulo}</p>
                <p className="text-[11px] mt-0.5" style={{ color: '#64748b' }}>
                  {r.fecha} · {r.asignatura}
                  {r.promHistorico && ` · Historial: ${r.promHistorico}`}
                </p>
              </div>
              <span className="text-[10px] font-bold px-2 py-1 rounded-full"
                style={{ backgroundColor: r.nivel === 'alto' ? '#fee2e2' : '#fef9c3', color: r.nivel === 'alto' ? '#dc2626' : '#a16207' }}>
                {r.nivel === 'alto' ? 'RIESGO ALTO' : 'RIESGO MEDIO'}
              </span>
            </div>
          ))}
        </section>
      )}

      {/* ACTUALIZACIÓN DEL DÍA */}
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
          {colacion && (
            <div className="px-4 pb-3 flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: '#7c3aed', fontSize: 16 }}>restaurant</span>
              <span className="text-[12px]" style={{ color: '#7c3aed' }}><b>Colación:</b> {colacion}</span>
            </div>
          )}
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

      {/* AUTORIZACIONES */}
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
                {a.fecha_limite && <p className="text-[11px] mt-0.5" style={{ color: '#ef4444' }}>Hasta: {a.fecha_limite}</p>}
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

      {/* REQUIEREN ACCIÓN */}
      <UrgentesSection urgentes={urgentes} tipo="urgente" />

      {/* IMPORTANTE ESTA SEMANA */}
      <UrgentesSection urgentes={importantes} tipo="importante" />

      {/* CALENDARIO */}
      <CalendarioFechas fechas={allFechas} titulo="Próximas Fechas" />

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

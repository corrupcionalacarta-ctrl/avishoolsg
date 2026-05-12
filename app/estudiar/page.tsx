import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import PracticarButton from './PracticarButton'

export const dynamic = 'force-dynamic'

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Archivo = {
  id: string
  alumno: string
  archivo_nombre: string
  asignatura: string | null
  tipo_contenido: string | null
  titulo_inferido: string | null
  unidad_tematica: string | null
  temas: string[]
  conceptos_clave: string[]
  preguntas: { numero: string | number; tipo: string; enunciado: string }[]
  nivel_dificultad: string | null
  resumen: string | null
  fecha_probable: string | null
  tiene_respuestas: boolean
}

type Fecha = {
  titulo: string
  detalle: string | null
  asignatura: string | null
  fecha_evento: string
  alumno: string | null
}

type Material = {
  alumno: string
  curso: string
  tarea_titulo: string | null
  nombre: string
  url: string
  tipo: string | null
}

// ─── Constantes UI ───────────────────────────────────────────────────────────

const TIPO_BADGE: Record<string, { label: string; bg: string; fg: string; icon: string }> = {
  prueba:    { label: 'Prueba',    bg: '#fef2f2', fg: '#dc2626', icon: 'quiz' },
  guia:      { label: 'Guía',     bg: '#eff6ff', fg: '#2563eb', icon: 'menu_book' },
  pauta:     { label: 'Pauta',    bg: '#f0fdf4', fg: '#16a34a', icon: 'fact_check' },
  material:  { label: 'Material', bg: '#faf5ff', fg: '#9333ea', icon: 'auto_stories' },
  ejercicio: { label: 'Ejercicio',bg: '#fff7ed', fg: '#ea580c', icon: 'calculate' },
  temario:   { label: 'Temario',  bg: '#f0f9ff', fg: '#0284c7', icon: 'format_list_bulleted' },
  otro:      { label: 'Archivo',  bg: '#f8fafc', fg: '#64748b', icon: 'description' },
}

const DIFICULTAD_COLOR: Record<string, string> = {
  baja:   '#16a34a',
  media:  '#d97706',
  alta:   '#dc2626',
}

const MATERIA_COLOR: Record<string, string> = {
  'Matemática':       '#1d4ed8',
  'Ciencias':         '#0891b2',
  'Historia':         '#b45309',
  'Lenguaje':         '#7c3aed',
  'Inglés':           '#0f766e',
  'Religión':         '#db2777',
  'Ed. Física':       '#16a34a',
  'Tecnología':       '#6366f1',
  'Orientación':      '#f59e0b',
}

function materiaColor(asig: string | null): string {
  if (!asig) return '#64748b'
  for (const [k, v] of Object.entries(MATERIA_COLOR)) {
    if (asig.toLowerCase().includes(k.toLowerCase())) return v
  }
  return '#64748b'
}

const TIPO_ICON_DRIVE: Record<string, string> = {
  documento:    'description',
  presentacion: 'slideshow',
  hoja:         'table_chart',
  formulario:   'assignment',
  video:        'play_circle',
  pdf:          'picture_as_pdf',
  drive:        'folder',
  archivo:      'attach_file',
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function EstudiarPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; materia?: string }>
}) {
  const { tab: tabParam, materia: materiaParam } = await searchParams
  const tab = tabParam ?? 'analizado'
  const materiaFiltro = (materiaParam ?? '').toLowerCase()

  const hoy = new Date().toISOString().split('T')[0]
  const en21 = new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString().split('T')[0]

  const [archivosRes, fechasRes, materialesRes] = await Promise.all([
    supabase
      .from('classroom_archivos')
      .select('id, alumno, archivo_nombre, asignatura, tipo_contenido, titulo_inferido, unidad_tematica, temas, preguntas, nivel_dificultad, resumen, fecha_probable, tiene_respuestas')
      .order('asignatura')
      .limit(300),

    supabase
      .from('items_colegio')
      .select('titulo, detalle, asignatura, fecha_evento, alumno')
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', hoy)
      .lte('fecha_evento', en21)
      .order('fecha_evento')
      .limit(20),

    supabase
      .from('classroom_materiales')
      .select('alumno, curso, tarea_titulo, nombre, url, tipo')
      .order('curso')
      .limit(200),
  ])

  const archivos = (archivosRes.data ?? []) as Archivo[]
  const fechas   = (fechasRes.data   ?? []) as Fecha[]
  const mats     = (materialesRes.data ?? []) as Material[]

  // Próximas evaluaciones
  const proximasPruebas = fechas.filter(f =>
    /(prueba|control|evaluaci)/i.test(f.titulo ?? '')
  )

  // Materias únicas de archivos analizados
  const materias = [...new Set(archivos.map(a => a.asignatura).filter(Boolean))].sort() as string[]

  // Filtrar archivos por tab/materia
  const archivosFiltrados = materiaFiltro
    ? archivos.filter(a => (a.asignatura ?? '').toLowerCase().includes(materiaFiltro))
    : archivos

  // Separar tipos
  const pruebas   = archivosFiltrados.filter(a => a.tipo_contenido === 'prueba')
  const guias     = archivosFiltrados.filter(a => a.tipo_contenido === 'guia')
  const pautas    = archivosFiltrados.filter(a => a.tipo_contenido === 'pauta')
  const material  = archivosFiltrados.filter(a => !['prueba','guia','pauta'].includes(a.tipo_contenido ?? ''))

  // Agrupar materiales Drive por curso
  const driveByAlumno: Record<string, Record<string, Material[]>> = {}
  for (const m of mats) {
    const nombre = m.alumno?.split(' ')[0] ?? 'Alumno'
    if (!driveByAlumno[nombre]) driveByAlumno[nombre] = {}
    if (!driveByAlumno[nombre][m.curso]) driveByAlumno[nombre][m.curso] = []
    driveByAlumno[nombre][m.curso].push(m)
  }

  return (
    <div className="space-y-4 mt-4">

      {/* Header */}
      <div>
        <h1 className="text-[20px] font-bold" style={{ color: '#1e293b' }}>Estudiar</h1>
        <p className="text-[12px] mt-0.5" style={{ color: '#94a3b8' }}>
          {archivos.length} archivos analizados por IA · {mats.length} archivos Drive
        </p>
      </div>

      {/* Próximas evaluaciones */}
      {proximasPruebas.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
            Próximas evaluaciones
          </p>
          {proximasPruebas.slice(0, 3).map((p, i) => {
            // Buscar archivos analizados relacionados
            const relacionados = archivos.filter(a =>
              (a.asignatura ?? '').toLowerCase().includes((p.asignatura ?? '').toLowerCase().slice(0, 5))
              && ['prueba', 'guia', 'pauta'].includes(a.tipo_contenido ?? '')
            )
            const color = materiaColor(p.asignatura)
            const diasRestantes = Math.ceil((new Date(p.fecha_evento).getTime() - Date.now()) / 86400000)

            return (
              <div key={i} className="rounded-2xl p-4"
                style={{ backgroundColor: color + '08', border: `1px solid ${color}30` }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: color + '15' }}>
                    <span className="material-symbols-outlined" style={{ color, fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                      quiz
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold leading-tight" style={{ color: '#1e293b' }}>
                      {p.titulo}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {p.asignatura && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: color + '20', color }}>
                          {p.asignatura}
                        </span>
                      )}
                      <span className="text-[11px]" style={{ color: '#94a3b8' }}>
                        {p.fecha_evento}
                      </span>
                      <span className="text-[11px] font-semibold"
                        style={{ color: diasRestantes <= 3 ? '#dc2626' : diasRestantes <= 7 ? '#d97706' : '#64748b' }}>
                        en {diasRestantes} día{diasRestantes !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {relacionados.length > 0 && (
                      <p className="text-[11px] mt-1.5" style={{ color: '#64748b' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 12, verticalAlign: 'middle' }}>smart_toy</span>
                        {' '}{relacionados.length} archivo{relacionados.length !== 1 ? 's' : ''} analizado{relacionados.length !== 1 ? 's' : ''} disponible{relacionados.length !== 1 ? 's' : ''} para estudiar
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: '#f1f5f9' }}>
        {[
          { key: 'analizado', label: 'Analizado por IA', icon: 'smart_toy' },
          { key: 'archivos',  label: 'Archivos Drive',   icon: 'folder_open' },
        ].map(t => (
          <Link
            key={t.key}
            href={`/estudiar?tab=${t.key}${materiaFiltro ? `&materia=${materiaFiltro}` : ''}`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] font-medium transition-all"
            style={tab === t.key
              ? { backgroundColor: '#ffffff', color: '#1e293b', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
              : { color: '#64748b' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{t.icon}</span>
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── TAB: Analizado por IA ─────────────────────────────────────────── */}
      {tab === 'analizado' && (
        <div className="space-y-4">

          {archivos.length === 0 ? (
            <div className="rounded-2xl p-8 flex flex-col items-center text-center gap-3"
              style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#cbd5e1' }}>smart_toy</span>
              <div>
                <p className="font-semibold text-[14px]" style={{ color: '#475569' }}>Sin análisis aún</p>
                <p className="text-[12px] mt-1" style={{ color: '#94a3b8' }}>
                  Ejecuta <code className="text-[11px] bg-slate-100 px-1 rounded">python drive_analyzer.py</code> para analizar los archivos Drive
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Filtro por materia */}
              <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                <Link
                  href="/estudiar?tab=analizado"
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium"
                  style={!materiaFiltro
                    ? { backgroundColor: '#1e293b', color: '#ffffff' }
                    : { backgroundColor: '#f1f5f9', color: '#64748b' }}
                >
                  Todas
                </Link>
                {materias.map(m => {
                  const color = materiaColor(m)
                  const activo = materiaFiltro && m.toLowerCase().includes(materiaFiltro)
                  return (
                    <Link
                      key={m}
                      href={`/estudiar?tab=analizado&materia=${encodeURIComponent(m.toLowerCase())}`}
                      className="flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium"
                      style={activo
                        ? { backgroundColor: color, color: '#ffffff' }
                        : { backgroundColor: color + '15', color }}
                    >
                      {m}
                    </Link>
                  )
                })}
              </div>

              {/* Sección Pruebas */}
              {pruebas.length > 0 && (
                <SeccionArchivos titulo="Pruebas y Controles" archivos={pruebas} />
              )}

              {/* Sección Guías */}
              {guias.length > 0 && (
                <SeccionArchivos titulo="Guías de Estudio" archivos={guias} />
              )}

              {/* Sección Pautas */}
              {pautas.length > 0 && (
                <SeccionArchivos titulo="Pautas con Respuestas" archivos={pautas} />
              )}

              {/* Sección Material */}
              {material.length > 0 && (
                <SeccionArchivos titulo="Material del Profesor" archivos={material} />
              )}
            </>
          )}
        </div>
      )}

      {/* ── TAB: Archivos Drive ────────────────────────────────────────────── */}
      {tab === 'archivos' && (
        <div className="space-y-3">
          {mats.length === 0 ? (
            <div className="rounded-2xl p-8 flex flex-col items-center text-center gap-3"
              style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#cbd5e1' }}>folder_open</span>
              <p className="font-semibold text-[14px]" style={{ color: '#475569' }}>Sin archivos Drive</p>
            </div>
          ) : (
            Object.entries(driveByAlumno).map(([alumno, cursos]) => (
              <div key={alumno} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
                  {alumno}
                </p>
                {Object.entries(cursos).map(([curso, items]) => (
                  <div key={curso} className="rounded-2xl overflow-hidden"
                    style={{ border: '1px solid #e2e8f0', backgroundColor: '#ffffff' }}>
                    <div className="px-4 py-2.5 flex items-center gap-2"
                      style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                      <span className="material-symbols-outlined" style={{ color: '#64748b', fontSize: 15 }}>school</span>
                      <p className="text-[12px] font-semibold" style={{ color: '#475569' }}>{curso}</p>
                      <span className="ml-auto text-[11px]" style={{ color: '#cbd5e1' }}>{items.length}</span>
                    </div>
                    {items.map((m, i) => {
                      const icon = TIPO_ICON_DRIVE[m.tipo ?? 'archivo'] ?? 'attach_file'
                      const esProfe = !m.tarea_titulo || m.tarea_titulo === 'Material'
                      return (
                        <a key={i} href={m.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-3 px-4 py-3"
                          style={{ borderBottom: i < items.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                          <span className="material-symbols-outlined flex-shrink-0"
                            style={{ color: '#94a3b8', fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
                            {icon}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium truncate" style={{ color: '#1e293b' }}>{m.nombre}</p>
                            {esProfe
                              ? <p className="text-[10px] font-semibold" style={{ color: '#059669' }}>Material del profe</p>
                              : m.tarea_titulo && <p className="text-[10px] truncate" style={{ color: '#94a3b8' }}>Tarea: {m.tarea_titulo}</p>
                            }
                          </div>
                          <span className="material-symbols-outlined flex-shrink-0" style={{ color: '#e2e8f0', fontSize: 15 }}>open_in_new</span>
                        </a>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Supabase puede devolver campos jsonb como string o como array según el driver
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toArray<T>(val: any): T[] {
  if (!val) return []
  if (Array.isArray(val)) return val as T[]
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T[] } catch { return [] }
  }
  return []
}

// ─── Componentes helper ───────────────────────────────────────────────────────

function SeccionArchivos({ titulo, archivos }: { titulo: string; archivos: Archivo[] }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
        {titulo} ({archivos.length})
      </p>
      <div className="space-y-2">
        {archivos.map((a, i) => <ArchivoCard key={i} archivo={a} />)}
      </div>
    </div>
  )
}

function ArchivoCard({ archivo: a }: { archivo: Archivo }) {
  const tipo  = a.tipo_contenido ?? 'otro'
  const badge = TIPO_BADGE[tipo] ?? TIPO_BADGE.otro
  const color = materiaColor(a.asignatura)
  const temas = toArray<string>(a.temas)
  const preguntas = toArray<{ numero: string | number; tipo: string; enunciado: string }>(a.preguntas)
  const nPreguntas = preguntas.length

  return (
    <div className="rounded-2xl p-4 space-y-3"
      style={{ border: '1px solid #e2e8f0', backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: badge.bg }}>
          <span className="material-symbols-outlined" style={{ color: badge.fg, fontSize: 17, fontVariationSettings: "'FILL' 1" }}>
            {badge.icon}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: badge.bg, color: badge.fg }}>
              {badge.label.toUpperCase()}
            </span>
            {a.asignatura && (
              <span className="text-[11px] font-medium" style={{ color }}>
                {a.asignatura}
              </span>
            )}
            {a.nivel_dificultad && (
              <span className="text-[10px]" style={{ color: DIFICULTAD_COLOR[a.nivel_dificultad] ?? '#64748b' }}>
                {a.nivel_dificultad === 'alta' ? '●●●' : a.nivel_dificultad === 'media' ? '●●○' : '●○○'}
              </span>
            )}
            {a.tiene_respuestas && (
              <span className="text-[10px] font-semibold" style={{ color: '#16a34a' }}>✓ con respuestas</span>
            )}
          </div>
          <p className="text-[13px] font-semibold mt-1 leading-tight" style={{ color: '#1e293b' }}>
            {a.titulo_inferido ?? a.archivo_nombre}
          </p>
          {a.unidad_tematica && (
            <p className="text-[11px] mt-0.5" style={{ color: '#64748b' }}>
              Unidad: {a.unidad_tematica}
            </p>
          )}
        </div>
      </div>

      {/* Resumen */}
      {a.resumen && (
        <p className="text-[12px] leading-5 line-clamp-2" style={{ color: '#475569' }}>
          {a.resumen}
        </p>
      )}

      {/* Temas */}
      {temas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {temas.slice(0, 6).map((t, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: color + '12', color }}>
              {t}
            </span>
          ))}
          {temas.length > 6 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: '#f1f5f9', color: '#94a3b8' }}>
              +{temas.length - 6} más
            </span>
          )}
        </div>
      )}

      {/* Footer: preguntas + botón practicar */}
      <div className="flex items-center gap-1.5 pt-1" style={{ borderTop: '1px solid #f8fafc' }}>
        {nPreguntas > 0 && (
          <>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#94a3b8' }}>help_outline</span>
            <p className="text-[11px]" style={{ color: '#94a3b8' }}>
              {nPreguntas} pregunta{nPreguntas !== 1 ? 's' : ''}
            </p>
          </>
        )}
        {a.fecha_probable && (
          <span className="text-[10px]" style={{ color: '#cbd5e1' }}>
            {a.fecha_probable}
          </span>
        )}
        {['prueba', 'guia', 'ejercicio'].includes(a.tipo_contenido ?? '') && a.id && (
          <div className="ml-auto">
            <PracticarButton
              archivoId={a.id}
              alumno={a.alumno}
              titulo={a.titulo_inferido ?? a.archivo_nombre}
            />
          </div>
        )}
      </div>
    </div>
  )
}

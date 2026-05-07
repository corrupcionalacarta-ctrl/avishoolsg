import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const TIPO_ICON: Record<string, string> = {
  documento:    'description',
  presentacion: 'slideshow',
  hoja:         'table_chart',
  formulario:   'assignment',
  video:        'play_circle',
  pdf:          'picture_as_pdf',
  drive:        'folder',
  sitio:        'language',
  archivo:      'attach_file',
}

const TIPO_COLOR: Record<string, string> = {
  documento:    '#1e40af',
  presentacion: '#b45309',
  hoja:         '#15803d',
  formulario:   '#7c3aed',
  video:        '#dc2626',
  pdf:          '#dc2626',
  drive:        '#0369a1',
  sitio:        '#0369a1',
  archivo:      '#64748b',
}

const ALUMNO_COLOR: Record<string, string> = {
  Clemente: '#1e3a8a',
  Raimundo: '#7c3aed',
}

type Material = {
  alumno: string
  curso: string
  tarea_titulo: string
  nombre: string
  url: string
  tipo: string | null
}

export default async function EstudiarPage() {
  const res = await supabase
    .from('classroom_materiales')
    .select('alumno, curso, tarea_titulo, nombre, url, tipo')
    .order('curso')
    .limit(200)

  const materiales = (res.data ?? []) as Material[]

  // Agrupar: alumno → curso → lista de materiales
  // Ordenar: materiales del profe primero (tarea_titulo vacío o "Material"), luego los de tareas
  const byAlumno: Record<string, Record<string, Material[]>> = {}
  for (const m of materiales) {
    const nombre = m.alumno?.split(' ')[0] ?? 'Alumno'
    if (!byAlumno[nombre]) byAlumno[nombre] = {}
    if (!byAlumno[nombre][m.curso]) byAlumno[nombre][m.curso] = []
    byAlumno[nombre][m.curso].push(m)
  }
  // Ordenar materiales dentro de cada curso: sin tarea (publicados como Material) primero
  for (const alumnoCursos of Object.values(byAlumno)) {
    for (const curso of Object.keys(alumnoCursos)) {
      alumnoCursos[curso].sort((a, b) => {
        const aEsMaterial = !a.tarea_titulo || a.tarea_titulo === 'Material'
        const bEsMaterial = !b.tarea_titulo || b.tarea_titulo === 'Material'
        return (aEsMaterial ? 0 : 1) - (bEsMaterial ? 0 : 1)
      })
    }
  }

  return (
    <div className="space-y-5 mt-4">

      <div>
        <h1 className="text-[20px] font-bold" style={{ color: '#1e293b' }}>Material de estudio</h1>
        <p className="text-[12px] mt-0.5" style={{ color: '#94a3b8' }}>
          Documentos y archivos de Google Classroom
        </p>
      </div>

      {materiales.length === 0 ? (
        <div className="rounded-2xl p-8 flex flex-col items-center text-center gap-4"
          style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#86efac' }}>menu_book</span>
          <div>
            <p className="font-semibold text-[15px]" style={{ color: '#059669' }}>Sin materiales aún</p>
            <p className="text-[13px] mt-1 leading-5" style={{ color: '#64748b' }}>
              Ejecuta el extractor de Classroom para cargar los archivos adjuntos de las tareas.
            </p>
          </div>
        </div>
      ) : (
        Object.entries(byAlumno).map(([alumno, cursos]) => {
          const color = ALUMNO_COLOR[alumno] ?? '#1e3a8a'
          return (
            <div key={alumno} className="space-y-3">

              {/* Header alumno */}
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: color }} />
                <h2 className="text-[16px] font-semibold" style={{ color: '#1e293b' }}>{alumno}</h2>
              </div>

              {Object.entries(cursos).map(([curso, mats]) => (
                <div key={curso} className="rounded-2xl overflow-hidden"
                  style={{ border: '1px solid #e2e8f0', backgroundColor: '#ffffff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>

                  {/* Header curso */}
                  <div className="px-4 py-2.5 flex items-center gap-2"
                    style={{ backgroundColor: color + '10', borderBottom: '1px solid #f1f5f9' }}>
                    <span className="material-symbols-outlined" style={{ color, fontSize: 16, fontVariationSettings: "'FILL' 1" }}>school</span>
                    <p className="text-[13px] font-bold" style={{ color }}>{curso}</p>
                    <span className="ml-auto text-[11px]" style={{ color: '#94a3b8' }}>{mats.length} archivos</span>
                  </div>

                  {/* Lista de materiales */}
                  {mats.map((m, i) => {
                    const tipo = m.tipo ?? 'archivo'
                    const icon = TIPO_ICON[tipo] ?? 'attach_file'
                    const iconColor = TIPO_COLOR[tipo] ?? '#64748b'
                    const esMatProfe = !m.tarea_titulo || m.tarea_titulo === 'Material'

                    return (
                      <a key={i} href={m.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-3 px-4 py-3 active:bg-slate-50"
                        style={{ borderBottom: i < mats.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                        <span className="material-symbols-outlined flex-shrink-0"
                          style={{ color: iconColor, fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                          {icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium truncate" style={{ color: '#1e293b' }}>{m.nombre}</p>
                          {!esMatProfe && m.tarea_titulo && (
                            <p className="text-[10px] truncate" style={{ color: '#94a3b8' }}>
                              Tarea: {m.tarea_titulo}
                            </p>
                          )}
                          {esMatProfe && (
                            <p className="text-[10px] font-semibold" style={{ color: '#059669' }}>Material del profe</p>
                          )}
                        </div>
                        <span className="material-symbols-outlined flex-shrink-0" style={{ color: '#cbd5e1', fontSize: 16 }}>open_in_new</span>
                      </a>
                    )
                  })}
                </div>
              ))}
            </div>
          )
        })
      )}

    </div>
  )
}

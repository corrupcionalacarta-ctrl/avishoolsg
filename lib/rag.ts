import { supabase } from './supabase'

export async function buildContext(alumnoFiltro?: string): Promise<string> {
  const hoy = new Date().toISOString().split('T')[0]
  const en14 = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().split('T')[0]
  const hace30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0]

  const primerNombre = alumnoFiltro
    ? alumnoFiltro.charAt(0).toUpperCase() + alumnoFiltro.slice(1)
    : null

  const [digestRes, fechasRes, notasRes, anotacionesRes, analisisRes, classroomRes, materialesRes, archivosRes] = await Promise.all([
    supabase
      .from('digests')
      .select('resumen_ejecutivo, json_completo, created_at')
      .order('created_at', { ascending: false })
      .limit(5),

    supabase
      .from('items_colegio')
      .select('titulo, detalle, asignatura, fecha_evento, alumno')
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', hoy)
      .lte('fecha_evento', en14)
      .order('fecha_evento'),

    supabase
      .from('notas')
      .select('asignatura, tipo, nota, promedio_curso, descripcion, alumno, extraido_en')
      .order('extraido_en', { ascending: false })
      .limit(60),

    supabase
      .from('anotaciones')
      .select('fecha, tipo, titulo, descripcion, asignatura, alumno')
      .gte('fecha', hace30)
      .order('fecha', { ascending: false })
      .limit(30),

    // Último análisis IA por alumno
    supabase
      .from('analisis_alumno')
      .select('alumno, resumen, tendencia_academica, tendencia_conducta, nivel_alerta, prediccion, alertas, recomendaciones, generado_en')
      .order('generado_en', { ascending: false })
      .limit(4),

    // Tareas Classroom (pendientes primero)
    supabase
      .from('classroom')
      .select('alumno, curso, titulo, tipo, fecha_entrega, estado, calificacion, link')
      .order('fecha_entrega', { ascending: true, nullsFirst: false })
      .limit(40),

    // Materiales de Classroom
    supabase
      .from('classroom_materiales')
      .select('alumno, curso, tarea_titulo, nombre, url, tipo')
      .limit(100),

    // Archivos analizados por IA (Drive Compartido conmigo)
    supabase
      .from('classroom_archivos')
      .select('alumno, asignatura, tipo_contenido, titulo_inferido, unidad_tematica, temas, resumen, tiene_respuestas, fecha_probable, preguntas')
      .order('asignatura')
      .limit(100),
  ])

  const lines: string[] = ['=== CONTEXTO ESCOLAR AVI SCHOOL ===']
  lines.push(`Fecha: ${new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`)
  lines.push('Alumnos: Clemente Aravena (11 años, 6°D) y Raimundo Aravena (9 años, 4°A) — Colegio Georgian (Saint George)\n')

  // Análisis IA de cada alumno
  if (analisisRes.data?.length) {
    lines.push('━━━ ANÁLISIS IA DEL ALUMNO ━━━')
    const byAlumno: Record<string, typeof analisisRes.data[0]> = {}
    for (const a of analisisRes.data) {
      const nombre = a.alumno?.split(' ')[0] ?? 'Alumno'
      if (!byAlumno[nombre]) byAlumno[nombre] = a
    }
    for (const [nombre, a] of Object.entries(byAlumno)) {
      if (primerNombre && !nombre.toLowerCase().includes(primerNombre.toLowerCase())) continue
      const fecha = a.generado_en ? new Date(a.generado_en).toLocaleDateString('es-CL') : ''
      lines.push(`\n${nombre} (análisis del ${fecha}):`)
      lines.push(`  Tendencia académica: ${a.tendencia_academica ?? '?'} | Conducta: ${a.tendencia_conducta ?? '?'} | Alerta: ${a.nivel_alerta ?? '?'}`)
      if (a.resumen) lines.push(`  Resumen: ${a.resumen}`)
      if (a.prediccion) lines.push(`  Predicción: ${a.prediccion}`)
      const alertas = (a.alertas as {titulo: string; prioridad: string}[] | null) ?? []
      if (alertas.length) {
        lines.push(`  Alertas: ${alertas.map(al => `[${al.prioridad?.toUpperCase()}] ${al.titulo}`).join(' | ')}`)
      }
    }
    lines.push('')
  }

  // Último digest
  if (digestRes.data?.length) {
    const ultimo = digestRes.data[0]
    lines.push('━━━ ÚLTIMO RESUMEN EJECUTIVO ━━━')
    lines.push(ultimo.resumen_ejecutivo ?? '')
    const json = ultimo.json_completo as Record<string, unknown>
    const urgentes = (json?.urgentes as {titulo: string; detalle: string}[]) ?? []
    const importantes = (json?.importantes as {titulo: string; detalle: string}[]) ?? []
    const utiles = (json?.utiles_mañana as string[]) ?? []
    if (urgentes.length) {
      lines.push('\n🔴 URGENTE:')
      urgentes.forEach(u => lines.push(`  - ${u.titulo}: ${u.detalle}`))
    }
    if (importantes.length) {
      lines.push('\n🟡 IMPORTANTE:')
      importantes.forEach(i => lines.push(`  - ${i.titulo}: ${i.detalle}`))
    }
    if (utiles.length) lines.push('\n🎒 ÚTILES MAÑANA: ' + utiles.join(', '))
    lines.push('')
  }

  // Próximas fechas
  if (fechasRes.data?.length) {
    lines.push('━━━ PRÓXIMAS FECHAS (14 días) ━━━')
    fechasRes.data
      .filter(f => !primerNombre || f.alumno?.toLowerCase().includes(primerNombre.toLowerCase()))
      .forEach(f => {
        const alumno = f.alumno ? ` (${f.alumno.split(' ')[0]})` : ''
        lines.push(`  - ${f.fecha_evento}: ${f.titulo} ${f.asignatura ? `[${f.asignatura}]` : ''}${alumno}`)
      })
    lines.push('')
  }

  // Notas recientes
  if (notasRes.data?.length) {
    lines.push('━━━ NOTAS RECIENTES ━━━')
    const filtradas = notasRes.data.filter(n =>
      !primerNombre || (n.alumno ?? '').toLowerCase().includes(primerNombre.toLowerCase())
    )
    filtradas.forEach(n => {
      const vs = n.promedio_curso ? ` (prom. curso: ${n.promedio_curso})` : ''
      const nombre = (n.alumno ?? 'Alumno').split(' ')[0]
      lines.push(`  - ${nombre} | ${n.asignatura}: ${n.nota ?? '–'}${vs} — ${n.descripcion ?? n.tipo ?? ''}`)
    })
    lines.push('')
  }

  // Anotaciones recientes
  if (anotacionesRes.data?.length) {
    const filtradas = anotacionesRes.data.filter(a =>
      !primerNombre || (a.alumno ?? '').toLowerCase().includes(primerNombre.toLowerCase())
    )
    if (filtradas.length) {
      lines.push('━━━ ANOTACIONES RECIENTES (30 días) ━━━')
      filtradas.forEach(a => {
        const nombre = (a.alumno ?? 'Alumno').split(' ')[0]
        const tipo = (a.tipo ?? 'observacion').toUpperCase()
        const texto = a.titulo ?? a.descripcion ?? ''
        lines.push(`  - ${nombre} [${tipo}] ${a.fecha ?? ''}: ${texto}`)
      })
      lines.push('')
    }
  }

  // Google Classroom — tareas
  if (classroomRes.data?.length) {
    const filtradas = classroomRes.data.filter(c =>
      !primerNombre || (c.alumno ?? '').toLowerCase().includes(primerNombre.toLowerCase())
    )
    if (filtradas.length) {
      lines.push('━━━ GOOGLE CLASSROOM — TAREAS ━━━')
      filtradas.forEach(c => {
        const nombre = (c.alumno ?? 'Alumno').split(' ')[0]
        const fecha = c.fecha_entrega ? ` | entrega: ${c.fecha_entrega}` : ''
        const cal = c.calificacion ? ` | nota: ${c.calificacion}` : ''
        const link = c.link ? ` → ${c.link}` : ''
        lines.push(`  - ${nombre} [${c.curso}] ${c.titulo} (${c.estado ?? '?'})${fecha}${cal}${link}`)
      })
      lines.push('')
    }
  }

  // Google Classroom — materiales
  if (materialesRes.data?.length) {
    const filtrados = materialesRes.data.filter(m =>
      !primerNombre || (m.alumno ?? '').toLowerCase().includes(primerNombre.toLowerCase())
    )
    if (filtrados.length) {
      // Agrupar por curso
      const byCurso: Record<string, typeof filtrados> = {}
      for (const m of filtrados) {
        if (!byCurso[m.curso]) byCurso[m.curso] = []
        byCurso[m.curso].push(m)
      }
      lines.push('━━━ GOOGLE CLASSROOM — MATERIALES DE ESTUDIO ━━━')
      for (const [curso, mats] of Object.entries(byCurso)) {
        lines.push(`  [${curso}]`)
        mats.forEach(m => {
          const tipo = m.tipo ? `(${m.tipo})` : ''
          lines.push(`    - ${m.nombre} ${tipo} → ${m.url}`)
        })
      }
      lines.push('')
    }
  }

  // Archivos analizados por IA (pruebas, guías, pautas, material del colegio)
  if (archivosRes.data?.length) {
    const filtrados = archivosRes.data.filter(a =>
      !primerNombre || (a.alumno ?? '').toLowerCase().includes(primerNombre.toLowerCase())
    )
    if (filtrados.length) {
      lines.push('━━━ ARCHIVOS ANALIZADOS POR IA (DRIVE COMPARTIDO) ━━━')
      lines.push('(Estos son archivos reales del colegio: pruebas, guías, pautas, material del profesor)')

      // Agrupar por asignatura
      const byAsig: Record<string, typeof filtrados> = {}
      for (const a of filtrados) {
        const asig = a.asignatura ?? 'Sin asignatura'
        if (!byAsig[asig]) byAsig[asig] = []
        byAsig[asig].push(a)
      }

      for (const [asig, archivos] of Object.entries(byAsig)) {
        lines.push(`  [${asig}]`)
        for (const a of archivos) {
          const tipo = (a.tipo_contenido ?? 'archivo').toUpperCase()
          const titulo = a.titulo_inferido ?? '(sin título)'
          const temasRaw = a.temas
          const temasArr: string[] = Array.isArray(temasRaw) ? temasRaw : (typeof temasRaw === 'string' ? JSON.parse(temasRaw || '[]') : [])
          const temas = temasArr.slice(0, 4).join(', ')
          const pregRaw = a.preguntas
          const nPreg = Array.isArray(pregRaw) ? pregRaw.length : (typeof pregRaw === 'string' ? JSON.parse(pregRaw || '[]').length : 0)
          const respTag = a.tiene_respuestas ? ' ✓respuestas' : ''
          lines.push(`    - [${tipo}] ${titulo}`)
          if (a.unidad_tematica) lines.push(`      Unidad: ${a.unidad_tematica}`)
          if (temas) lines.push(`      Temas: ${temas}`)
          if (nPreg > 0) lines.push(`      ${nPreg} preguntas/ejercicios${respTag}`)
          if (a.resumen) lines.push(`      Resumen: ${(a.resumen as string).slice(0, 200)}`)
          if (a.fecha_probable) lines.push(`      Fecha probable: ${a.fecha_probable}`)
        }
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

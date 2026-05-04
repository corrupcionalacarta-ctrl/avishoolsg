import { supabase } from './supabase'

export async function buildContext(): Promise<string> {
  const hoy = new Date().toISOString().split('T')[0]
  const en14 = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().split('T')[0]

  const [digestRes, fechasRes, notasRes] = await Promise.all([
    supabase
      .from('digests')
      .select('resumen_ejecutivo, json_completo, created_at, alumno')
      .order('created_at', { ascending: false })
      .limit(3),

    supabase
      .from('items_colegio')
      .select('titulo, detalle, asignatura, fecha_evento, alumno')
      .eq('categoria', 'fecha_proxima')
      .gte('fecha_evento', hoy)
      .lte('fecha_evento', en14)
      .order('fecha_evento'),

    supabase
      .from('notas')
      .select('asignatura, tipo, nota, promedio_curso, descripcion, alumno')
      .order('extraido_en', { ascending: false })
      .limit(30),
  ])

  const lines: string[] = ['=== CONTEXTO ESCOLAR AVI SCHOOL ===']
  lines.push(`Fecha: ${new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}`)
  lines.push('Alumnos: Clemente Aravena (6°D) y Raimundo Aravena (4°A) — Colegio Georgian\n')

  if (digestRes.data?.length) {
    const ultimo = digestRes.data[0]
    lines.push(`ÚLTIMO RESUMEN: ${ultimo.resumen_ejecutivo}`)
    const json = ultimo.json_completo as Record<string, unknown>
    const urgentes = json?.urgentes as { titulo: string; detalle: string }[] ?? []
    const importantes = json?.importantes as { titulo: string; detalle: string }[] ?? []
    const utiles = json?.utiles_mañana as string[] ?? []
    if (urgentes.length) {
      lines.push('\n🔴 URGENTE:')
      urgentes.forEach(u => lines.push(`  - ${u.titulo}: ${u.detalle}`))
    }
    if (importantes.length) {
      lines.push('\n🟡 IMPORTANTE:')
      importantes.forEach(i => lines.push(`  - ${i.titulo}: ${i.detalle}`))
    }
    if (utiles.length) {
      lines.push('\n🎒 ÚTILES MAÑANA: ' + utiles.join(', '))
    }
  }

  if (fechasRes.data?.length) {
    lines.push('\n📅 PRÓXIMAS FECHAS:')
    fechasRes.data.forEach(f => {
      const alumno = f.alumno ? ` (${f.alumno})` : ''
      lines.push(`  - ${f.fecha_evento}: ${f.titulo} ${f.asignatura ? `[${f.asignatura}]` : ''}${alumno}`)
    })
  }

  if (notasRes.data?.length) {
    lines.push('\n📊 NOTAS RECIENTES:')
    notasRes.data.forEach(n => {
      const vs = n.promedio_curso ? ` (promedio curso: ${n.promedio_curso})` : ''
      lines.push(`  - ${n.alumno ?? 'Clemente'} | ${n.asignatura}: ${n.nota}${vs} — ${n.descripcion ?? n.tipo}`)
    })
  }

  return lines.join('\n')
}

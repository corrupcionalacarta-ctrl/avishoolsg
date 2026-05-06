// Funciones de análisis cruzado de datos AVI School

export type NotaBasic = { nota: number | null; promedio_curso: number | null; asignatura: string; fecha?: string | null }
export type AnotBasic = { tipo: string | null; fecha?: string | null }
export type AnalisisBasic = { tendencia_academica: string | null; nivel_alerta: string | null }

/** Score 1-10 del alumno basado en notas, anotaciones y tendencia IA */
export function calcScore(
  notas: NotaBasic[],
  anotaciones: AnotBasic[],
  analisis: AnalisisBasic | null
): number {
  let score = 6

  const conValor = notas.filter(n => n.nota)
  if (conValor.length > 0) {
    const prom = conValor.reduce((s, n) => s + (n.nota ?? 0), 0) / conValor.length
    if (prom >= 6.0)      score += 2
    else if (prom >= 5.5) score += 1
    else if (prom >= 5.0) score += 0
    else if (prom >= 4.5) score -= 1
    else                  score -= 2
  }

  const neg = anotaciones.filter(a => a.tipo === 'negativa').length
  const pos = anotaciones.filter(a => a.tipo === 'positiva').length
  score -= Math.min(neg * 0.5, 2)
  score += Math.min(pos * 0.3, 1)

  if (analisis?.tendencia_academica === 'mejorando')    score += 1
  if (analisis?.tendencia_academica === 'descendiendo') score -= 1
  if (analisis?.nivel_alerta === 'alto')                score -= 1

  return Math.max(1, Math.min(10, Math.round(score)))
}

export type ScoreTrend = 'up' | 'down' | 'flat'

export function scoreTrend(score: number): ScoreTrend {
  if (score >= 7) return 'up'
  if (score <= 4) return 'down'
  return 'flat'
}

export function scoreColor(score: number): string {
  if (score >= 7) return '#0d9488'
  if (score >= 5) return '#d97706'
  return '#ef4444'
}

/** Semáforo por asignatura: verde/amarillo/rojo */
export type SemaforoAsig = {
  asignatura: string
  promAlumno: number
  promCurso: number | null
  diff: number | null
  color: 'verde' | 'amarillo' | 'rojo' | 'gris'
  notas: number[]
}

export function semaforo(notas: NotaBasic[]): SemaforoAsig[] {
  const byAsig: Record<string, NotaBasic[]> = {}
  for (const n of notas) {
    if (!n.nota) continue
    if (!byAsig[n.asignatura]) byAsig[n.asignatura] = []
    byAsig[n.asignatura].push(n)
  }

  return Object.entries(byAsig).map(([asig, items]) => {
    const vals = items.map(i => i.nota as number)
    const promAlumno = vals.reduce((a, b) => a + b, 0) / vals.length
    const cursoProm = items.find(i => i.promedio_curso)?.promedio_curso ?? null
    const diff = cursoProm != null ? promAlumno - cursoProm : null

    let color: SemaforoAsig['color'] = 'gris'
    if (diff !== null) {
      if (diff >= 0)      color = 'verde'
      else if (diff >= -0.5) color = 'amarillo'
      else                color = 'rojo'
    } else {
      if (promAlumno >= 5.5) color = 'verde'
      else if (promAlumno >= 5.0) color = 'amarillo'
      else color = 'rojo'
    }

    return { asignatura: asig, promAlumno: Math.round(promAlumno * 10) / 10, promCurso: cursoProm, diff, color, notas: vals }
  }).sort((a, b) => {
    const ord = { rojo: 0, amarillo: 1, gris: 2, verde: 3 }
    return ord[a.color] - ord[b.color]
  })
}

/** Riesgo en pruebas próximas cruzado con historial de notas */
export type RiesgoPrueba = {
  titulo: string
  fecha: string
  asignatura: string | null
  alumno: string | null
  promHistorico: number | null
  nivel: 'alto' | 'medio' | 'bajo' | 'sin_datos'
}

export function calcRiesgo(
  fechas: { titulo: string; fecha_evento: string; asignatura: string | null; alumno: string | null }[],
  notas: NotaBasic[]
): RiesgoPrueba[] {
  return fechas.map(f => {
    const asig = f.asignatura?.toLowerCase()
    const notasAsig = asig
      ? notas.filter(n => n.nota && n.asignatura.toLowerCase().includes(asig))
      : []

    if (!notasAsig.length) {
      return { ...f, fecha: f.fecha_evento, promHistorico: null, nivel: 'sin_datos' as const }
    }

    const prom = notasAsig.reduce((s, n) => s + (n.nota ?? 0), 0) / notasAsig.length
    const nivel: RiesgoPrueba['nivel'] = prom < 4.5 ? 'alto' : prom < 5.5 ? 'medio' : 'bajo'
    return { titulo: f.titulo, fecha: f.fecha_evento, asignatura: f.asignatura, alumno: f.alumno, promHistorico: Math.round(prom * 10) / 10, nivel }
  }).filter(r => r.nivel === 'alto' || r.nivel === 'medio')
}

/** Correlación conducta-rendimiento por semana (últimas 8 semanas) */
export type SemanaData = {
  semana: string // ej: "21 abr"
  promNotas: number | null
  negativas: number
  positivas: number
}

export function correlacionSemanal(notas: NotaBasic[], anotaciones: AnotBasic[]): SemanaData[] {
  const semanas: Record<string, { notas: number[]; neg: number; pos: number }> = {}

  const getKey = (fecha: string) => {
    const d = new Date(fecha)
    const lunes = new Date(d)
    lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return lunes.toISOString().split('T')[0]
  }

  for (const n of notas) {
    if (!n.nota || !n.fecha) continue
    const key = getKey(n.fecha)
    if (!semanas[key]) semanas[key] = { notas: [], neg: 0, pos: 0 }
    semanas[key].notas.push(n.nota)
  }

  for (const a of anotaciones) {
    if (!a.fecha) continue
    const key = getKey(a.fecha)
    if (!semanas[key]) semanas[key] = { notas: [], neg: 0, pos: 0 }
    if (a.tipo === 'negativa') semanas[key].neg++
    else if (a.tipo === 'positiva') semanas[key].pos++
  }

  return Object.entries(semanas)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([key, data]) => ({
      semana: new Date(key + 'T12:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }),
      promNotas: data.notas.length ? Math.round(data.notas.reduce((a, b) => a + b, 0) / data.notas.length * 10) / 10 : null,
      negativas: data.neg,
      positivas: data.pos,
    }))
}

import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type DigestRow = {
  id: string
  created_at: string
  run_mode: string
  resumen_ejecutivo: string
  n_urgentes: number
  n_importantes: number
  n_informativos: number
  n_fechas: number
  json_completo: Record<string, unknown>
}

export default async function DashboardPage() {
  const { data: digests } = await supabase
    .from('digests')
    .select('id, created_at, run_mode, resumen_ejecutivo, n_urgentes, n_importantes, n_informativos, n_fechas, json_completo')
    .order('created_at', { ascending: false })
    .limit(20)

  const { data: proximasFechas } = await supabase
    .from('items_colegio')
    .select('titulo, fecha_evento, asignatura, alumno')
    .eq('categoria', 'fecha_proxima')
    .gte('fecha_evento', new Date().toISOString().split('T')[0])
    .order('fecha_evento')
    .limit(10)

  const { data: notas } = await supabase
    .from('notas')
    .select('alumno, asignatura, nota, promedio_curso, descripcion')
    .order('extraido_en', { ascending: false })
    .limit(10)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#003366]">Dashboard Escolar</h1>

      {/* Próximas fechas */}
      {proximasFechas && proximasFechas.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm border p-5">
          <h2 className="font-semibold text-[#1f618d] mb-3">📅 Próximas fechas</h2>
          <div className="space-y-2">
            {proximasFechas.map((f, i) => {
              const dias = Math.ceil((new Date(f.fecha_evento).getTime() - Date.now()) / 86400000)
              const badge = dias === 0 ? '🔴 HOY' : dias === 1 ? '🟡 mañana' : `en ${dias} días`
              return (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="text-xs font-medium text-white bg-[#1f618d] rounded px-2 py-0.5 whitespace-nowrap">{f.fecha_evento}</span>
                  <span>{f.titulo} {f.asignatura && <span className="text-gray-500">[{f.asignatura}]</span>}</span>
                  <span className="ml-auto text-xs text-gray-500">{badge}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Notas recientes */}
      {notas && notas.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm border p-5">
          <h2 className="font-semibold text-[#1f618d] mb-3">📊 Últimas notas</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {notas.map((n, i) => {
              const color = !n.nota ? 'text-gray-400' : n.nota >= 6 ? 'text-green-600' : n.nota >= 5 ? 'text-yellow-600' : 'text-red-600'
              return (
                <div key={i} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2">
                  <span className={`text-xl font-bold ${color}`}>{n.nota ?? '–'}</span>
                  <div>
                    <p className="font-medium">{n.asignatura}</p>
                    <p className="text-xs text-gray-500">{n.alumno ?? 'Clemente'} {n.promedio_curso ? `· prom: ${n.promedio_curso}` : ''}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Historial de digests */}
      <section>
        <h2 className="font-semibold text-[#1f618d] mb-3">🗂 Historial de digests</h2>
        <div className="space-y-3">
          {(digests as DigestRow[] ?? []).map((d) => {
            const json = d.json_completo
            const utiles = json?.utiles_mañana as string[] ?? []
            const urgentes = json?.urgentes as { titulo: string; detalle: string }[] ?? []
            const fecha = new Date(d.created_at)
            return (
              <details key={d.id} className="bg-white rounded-xl shadow-sm border">
                <summary className="p-4 cursor-pointer flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-500">
                        {fecha.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {' '}·{' '}
                        {fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-xs bg-gray-100 rounded px-2 py-0.5">{d.run_mode}</span>
                      {d.n_urgentes > 0 && <span className="text-xs bg-red-100 text-red-700 rounded px-2 py-0.5">{d.n_urgentes} urgente{d.n_urgentes > 1 ? 's' : ''}</span>}
                      {d.n_importantes > 0 && <span className="text-xs bg-yellow-100 text-yellow-700 rounded px-2 py-0.5">{d.n_importantes} importante{d.n_importantes > 1 ? 's' : ''}</span>}
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-2">{d.resumen_ejecutivo}</p>
                  </div>
                </summary>
                <div className="px-4 pb-4 space-y-3 text-sm border-t pt-3">
                  {urgentes.length > 0 && (
                    <div>
                      <p className="font-medium text-red-700 mb-1">🔴 Urgente</p>
                      {urgentes.map((u, i) => <p key={i} className="text-gray-700">• <b>{u.titulo}</b>: {u.detalle}</p>)}
                    </div>
                  )}
                  {utiles.length > 0 && (
                    <div>
                      <p className="font-medium text-blue-700 mb-1">🎒 Útiles para mañana</p>
                      {utiles.map((u, i) => <p key={i} className="text-gray-700">• {u}</p>)}
                    </div>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      </section>
    </div>
  )
}

import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type DigestRow = {
  id: string
  created_at: string
  resumen_ejecutivo: string | null
  n_urgentes: number
  n_importantes: number
  n_informativos: number
  json_completo: Record<string, unknown> | null
}

export default async function CorreosPage() {
  const { data } = await supabase
    .from('digests')
    .select('id, created_at, resumen_ejecutivo, n_urgentes, n_importantes, n_informativos, json_completo')
    .order('created_at', { ascending: false })
    .limit(20)

  const digests = (data ?? []) as DigestRow[]

  return (
    <div className="space-y-4 mt-4">

      <div>
        <h1 className="text-[20px] font-bold" style={{ color: '#1e293b' }}>Correos del colegio</h1>
        <p className="text-[12px] mt-0.5" style={{ color: '#94a3b8' }}>
          Comunicaciones procesadas — sin necesidad de abrir Gmail
        </p>
      </div>

      {digests.length === 0 && (
        <div className="rounded-2xl p-8 flex flex-col items-center text-center gap-3"
          style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#cbd5e1' }}>mail</span>
          <p className="text-[13px]" style={{ color: '#94a3b8' }}>Sin correos procesados aún</p>
        </div>
      )}

      <div className="space-y-3">
        {digests.map((d) => {
          const fecha = new Date(d.created_at)
          const json = d.json_completo ?? {}
          const urgentes = (json.urgentes as { titulo: string; detalle: string }[] | undefined) ?? []
          const importantes = (json.importantes as { titulo: string; detalle: string }[] | undefined) ?? []
          const informativos = (json.informativos as { titulo: string; detalle: string }[] | undefined) ?? []
          const todos = [
            ...urgentes.map(i => ({ ...i, nivel: 'urgente' })),
            ...importantes.map(i => ({ ...i, nivel: 'importante' })),
            ...informativos.map(i => ({ ...i, nivel: 'informativo' })),
          ]
          const tieneUrgentes = urgentes.length > 0

          return (
            <details key={d.id} className="rounded-xl overflow-hidden group"
              style={{
                border: tieneUrgentes ? '1px solid #fca5a5' : '1px solid #e2e8f0',
                boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}>
              <summary className="p-4 cursor-pointer list-none flex items-start gap-3"
                style={{ backgroundColor: tieneUrgentes ? '#fef2f2' : '#ffffff' }}>
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5"
                  style={{ fontSize: 18, color: tieneUrgentes ? '#ef4444' : '#64748b', fontVariationSettings: "'FILL' 1" }}>
                  {tieneUrgentes ? 'mark_email_unread' : 'mail'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-[12px] font-bold" style={{ color: '#1e293b' }}>
                      {fecha.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                    <p className="text-[11px]" style={{ color: '#94a3b8' }}>
                      {fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {d.resumen_ejecutivo && (
                    <p className="text-[12px] leading-5 line-clamp-2" style={{ color: '#475569' }}>{d.resumen_ejecutivo}</p>
                  )}
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    {urgentes.length > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
                        {urgentes.length} urgente{urgentes.length > 1 ? 's' : ''}
                      </span>
                    )}
                    {importantes.length > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: '#fef3c7', color: '#d97706' }}>
                        {importantes.length} importante{importantes.length > 1 ? 's' : ''}
                      </span>
                    )}
                    {informativos.length > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: '#f1f5f9', color: '#64748b' }}>
                        {informativos.length} informativo{informativos.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <span className="material-symbols-outlined flex-shrink-0 transition-transform group-open:rotate-180"
                  style={{ color: '#94a3b8', fontSize: 18 }}>expand_more</span>
              </summary>

              {/* Items del digest */}
              <div className="divide-y" style={{ borderColor: '#f1f5f9', backgroundColor: '#ffffff' }}>
                {todos.map((item, i) => {
                  const colorMap: Record<string, { bg: string; text: string; label: string }> = {
                    urgente: { bg: '#fef2f2', text: '#dc2626', label: 'Urgente' },
                    importante: { bg: '#fffbeb', text: '#d97706', label: 'Importante' },
                    informativo: { bg: '#f8fafc', text: '#64748b', label: 'Info' },
                  }
                  const c = colorMap[item.nivel]
                  return (
                    <div key={i} className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: c.bg, color: c.text }}>{c.label}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold leading-tight" style={{ color: '#1e293b' }}>{item.titulo}</p>
                          <p className="text-[12px] leading-5 mt-1" style={{ color: '#475569' }}>{item.detalle}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>

    </div>
  )
}

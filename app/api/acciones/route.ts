import { supabase } from '@/lib/supabase'

export async function POST(req: Request) {
  const { item_titulo, item_tipo, alumno, porcentaje, nota_padre, registrado_por } = await req.json()
  if (!item_titulo) return Response.json({ error: 'Falta item_titulo' }, { status: 400 })

  const { error } = await supabase.from('acciones_log').insert({
    item_titulo,
    item_tipo: item_tipo ?? 'urgente',
    alumno: alumno ?? null,
    porcentaje: porcentaje ?? 100,
    nota_padre: nota_padre ?? null,
    registrado_por: registrado_por ?? 'padre',
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

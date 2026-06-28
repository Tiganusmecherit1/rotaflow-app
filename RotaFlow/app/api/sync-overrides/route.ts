import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { ture, overrides, notificare } = await req.json()

    if (ture && ture.length > 0) {
      // Deduplicam dupa (angajat_id, data) — pastram ultima valoare
      const dedupMap = new Map<string, any>()
      for (const t of ture) {
        dedupMap.set(`${t.angajat_id}_${t.data}`, t)
      }
      const tureDedup = Array.from(dedupMap.values())

      // Stergem tot intervalul si reinseream curat
      const minData = tureDedup.reduce((m,t) => t.data < m ? t.data : m, tureDedup[0].data)
      const maxData = tureDedup.reduce((m,t) => t.data > m ? t.data : m, tureDedup[0].data)
      await sb.from('ture_mirror').delete().gte('data', minData).lte('data', maxData)

      // Inserare in batches de 500
      const batchSize = 500
      for (let i = 0; i < tureDedup.length; i += batchSize) {
        const batch = tureDedup.slice(i, i + batchSize)
        const { error } = await sb.from('ture_mirror').insert(batch)
        if (error) throw error
      }
    }

    if (overrides && overrides.length > 0) {
      const { error } = await sb.from('overrides').upsert(overrides, { onConflict: 'id' })
      if (error) throw error
    }

    if (notificare) {
      const acum = new Date()
      const dataOra = `${String(acum.getDate()).padStart(2,'0')}/${String(acum.getMonth()+1).padStart(2,'0')}/${acum.getFullYear()} ${String(acum.getHours()).padStart(2,'0')}:${String(acum.getMinutes()).padStart(2,'0')}`
      const { data: angajati } = await sb.from('angajati').select('id').eq('este_sef', false)
      if (angajati && angajati.length > 0) {
        await sb.from('notificari').insert(angajati.map((a: any) => ({
          titlu: 'Bază de date sincronizată',
          descriere: dataOra,
          tip: 'co_adaugat',
          citita: false,
          destinatar_id: a.id,
        })))
      }
    }

    return NextResponse.json({ ok: true, count: ture?.length ?? 0 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

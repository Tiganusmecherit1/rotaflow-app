import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { ture, overrides, notificare } = await req.json()

    // Upsert ture_mirror — nu mai da eroare la duplicate
    if (ture && ture.length > 0) {
      const { error } = await sb.from('ture_mirror')
        .upsert(ture, { onConflict: 'angajat_id,data' })
      if (error) throw error
    }

    // Salveaza override-urile manuale permanent
    if (overrides && overrides.length > 0) {
      const { error } = await sb.from('overrides')
        .upsert(overrides, { onConflict: 'id' })
      if (error) throw error
    }

    // Trimite notificare
    if (notificare) {
      const acum = new Date()
      const zi = String(acum.getDate()).padStart(2,'0')
      const luna = String(acum.getMonth()+1).padStart(2,'0')
      const an = acum.getFullYear()
      const ora = String(acum.getHours()).padStart(2,'0')
      const min = String(acum.getMinutes()).padStart(2,'0')
      const dataOra = `${zi}/${luna}/${an} ${ora}:${min}`

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

    return NextResponse.json({ ok: true, count: ture?.length ?? overrides?.length ?? 0 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

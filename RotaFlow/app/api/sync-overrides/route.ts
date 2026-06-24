import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { ture, notificare } = await req.json()

    // Salveaza turele calculate in ture_mirror
    if (ture && ture.length > 0) {
      const dates = [...new Set(ture.map((t: any) => t.data))] as string[]
      await sb.from('ture_mirror').delete().in('data', dates)
      const { error } = await sb.from('ture_mirror').insert(ture)
      if (error) throw error
    }

    // Trimite notificare cu data si ora exacta
    if (notificare) {
      const acum = new Date()
      const zi = String(acum.getDate()).padStart(2,'0')
      const luna = String(acum.getMonth()+1).padStart(2,'0')
      const an = acum.getFullYear()
      const ora = String(acum.getHours()).padStart(2,'0')
      const min = String(acum.getMinutes()).padStart(2,'0')
      const dataOra = `${zi}/${luna}/${an} ${ora}:${min}`

      const { error: notifErr } = await sb.from('notificari').insert({
        titlu: 'Bază de date sincronizată',
        descriere: dataOra,
        tip: 'program',
        citita: false,
      })
      if (notifErr) console.error('Notificare error:', notifErr)
    }

    return NextResponse.json({ ok: true, count: ture?.length ?? 0 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

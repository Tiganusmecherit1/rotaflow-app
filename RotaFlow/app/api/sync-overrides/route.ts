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
      // Sterge turele vechi
      const dates = [...new Set(ture.map((t: any) => t.data))] as string[]
      await sb.from('ture_mirror').delete().in('data', dates)
      // Insereaza turele noi
      const { error } = await sb.from('ture_mirror').insert(ture)
      if (error) throw error
    }

    // Trimite notificare
    if (notificare) {
      await sb.from('notificari').insert({
        titlu: notificare.titlu,
        mesaj: notificare.mesaj,
        tip: notificare.tip || 'program',
        citita_de: [],
      })
    }

    return NextResponse.json({ ok: true, count: ture?.length ?? 0 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { overrides, notificare } = await req.json()

    // Upsert overrides daca exista
    if (overrides && overrides.length > 0) {
      const { error } = await sb.from('overrides').upsert(overrides, { onConflict: 'id' })
      if (error) throw error
    }

    // Trimite o singura notificare catre toti angajatii
    if (notificare) {
      const { error } = await sb.from('notificari').insert({
        titlu: notificare.titlu,
        mesaj: notificare.mesaj,
        tip: notificare.tip || 'program',
        citita_de: [],
      })
      if (error) throw error
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

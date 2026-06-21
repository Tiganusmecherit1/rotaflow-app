import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { autor_id, mesaj } = body;

    if (!mesaj) {
      return NextResponse.json({ error: 'Lipseste mesajul' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('istoric_log')
      .insert({ autor_id: autor_id || null, mesaj })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ log: data });
  } catch (error) {
    console.error('Eroare la adaugarea in istoric:', error);
    return NextResponse.json({ error: 'Nu am putut adauga in istoric' }, { status: 500 });
  }
}

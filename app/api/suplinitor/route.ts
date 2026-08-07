import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { activ } = body;

    const { data, error } = await supabaseAdmin
      .from('setari_echipa')
      .update({ suplinitor_activ: activ, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ setari: data });
  } catch (error) {
    console.error('Eroare la actualizarea suplinitorului:', error);
    return NextResponse.json({ error: 'Nu am putut actualiza suplinitorul' }, { status: 500 });
  }
}

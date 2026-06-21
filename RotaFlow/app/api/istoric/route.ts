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

export async function DELETE() {
  try {
    // Stergem toate inregistrarile — neq pe un id imposibil ca sa acopere "delete all"
    const { error } = await supabaseAdmin.from('istoric_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Eroare la stergerea istoricului:', error);
    return NextResponse.json({ error: 'Nu am putut sterge istoricul' }, { status: 500 });
  }
}


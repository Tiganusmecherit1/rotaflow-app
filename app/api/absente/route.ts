import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { angajat_id, tip, data_start, zile } = body;

    if (!angajat_id || !tip || !data_start || !zile) {
      return NextResponse.json({ error: 'Date incomplete pentru absenta' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('absente')
      .insert({ angajat_id, tip, data_start, zile })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ absenta: data });
  } catch (error) {
    console.error('Eroare la adaugarea absentei:', error);
    return NextResponse.json({ error: 'Nu am putut adauga absenta' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Lipseste id-ul absentei' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('absente').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Eroare la stergerea absentei:', error);
    return NextResponse.json({ error: 'Nu am putut sterge absenta' }, { status: 500 });
  }
}

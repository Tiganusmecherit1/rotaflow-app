import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, nume, zile_co } = body;

    if (!id) {
      return NextResponse.json({ error: 'Lipseste id-ul angajatului' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (nume !== undefined) updateData.nume = nume;
    if (zile_co !== undefined) updateData.zile_co = zile_co;

    const { data, error } = await supabaseAdmin
      .from('angajati')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ angajat: data });
  } catch (error) {
    console.error('Eroare la actualizarea angajatului:', error);
    return NextResponse.json({ error: 'Nu am putut actualiza angajatul' }, { status: 500 });
  }
}

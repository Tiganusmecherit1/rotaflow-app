import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, nume, zile_co, zile_co_reportate, zile_co_reportate_expira } = body;

    if (!id) {
      return NextResponse.json({ error: 'Lipseste id-ul angajatului' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (nume !== undefined) updateData.nume = nume;
    if (zile_co !== undefined) {
      if (typeof zile_co !== 'number' || !Number.isFinite(zile_co) || zile_co < 0 || zile_co > 60) {
        return NextResponse.json({ error: 'zile_co invalid — trebuie sa fie un numar intre 0 si 60' }, { status: 400 });
      }
      updateData.zile_co = zile_co;
    }
    if (zile_co_reportate !== undefined) {
      if (typeof zile_co_reportate !== 'number' || !Number.isFinite(zile_co_reportate) || zile_co_reportate < 0 || zile_co_reportate > 90) {
        return NextResponse.json({ error: 'zile_co_reportate invalid — trebuie sa fie un numar intre 0 si 90' }, { status: 400 });
      }
      updateData.zile_co_reportate = zile_co_reportate;
    }
    if (zile_co_reportate_expira !== undefined) {
      updateData.zile_co_reportate_expira = zile_co_reportate_expira; // null e valid — inseamna "fara data de expirare setata"
    }

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

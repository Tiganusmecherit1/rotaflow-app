import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { angajat_id, data_start, data_sfarsit, nume_slot, zile_lucratoare } = body;

    if (!angajat_id || !data_start || !data_sfarsit) {
      return NextResponse.json({ error: 'Date incomplete pentru concediu' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('concedii')
      .insert({ angajat_id, data_start, data_sfarsit, nume_slot, zile_lucratoare })
      .select()
      .single();

    if (error) throw error;

    // Scadem zilele de CO ramase ale angajatului
    if (zile_lucratoare) {
      const { data: angajat } = await supabaseAdmin.from('angajati').select('zile_co').eq('id', angajat_id).single();
      if (angajat) {
        await supabaseAdmin
          .from('angajati')
          .update({ zile_co: Math.max(0, angajat.zile_co - zile_lucratoare) })
          .eq('id', angajat_id);
      }
    }

    return NextResponse.json({ concediu: data });
  } catch (error) {
    console.error('Eroare la adaugarea concediului:', error);
    return NextResponse.json({ error: 'Nu am putut adauga concediul' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Lipseste id-ul concediului' }, { status: 400 });
    }

    // Luam concediul inainte sa-l stergem, ca sa restauram zilele de CO
    const { data: concediu } = await supabaseAdmin.from('concedii').select('*').eq('id', id).single();

    const { error } = await supabaseAdmin.from('concedii').delete().eq('id', id);
    if (error) throw error;

    if (concediu) {
      const { data: angajat } = await supabaseAdmin.from('angajati').select('zile_co').eq('id', concediu.angajat_id).single();
      if (angajat) {
        await supabaseAdmin
          .from('angajati')
          .update({ zile_co: angajat.zile_co + concediu.zile_lucratoare })
          .eq('id', concediu.angajat_id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Eroare la stergerea concediului:', error);
    return NextResponse.json({ error: 'Nu am putut sterge concediul' }, { status: 500 });
  }
}

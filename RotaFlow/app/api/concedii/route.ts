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

    // Scadem zilele de CO ramase ale angajatului — din cele reportate intai (daca exista
    // si nu au expirat), apoi din cele normale. Trebuie sa fie IDENTIC cu logica din client
    // (scadeZileCO), altfel bazele de date si interfata diverg.
    if (zile_lucratoare) {
      const { data: angajat } = await supabaseAdmin.from('angajati').select('zile_co, zile_co_reportate, zile_co_reportate_expira').eq('id', angajat_id).single();
      if (angajat) {
        const azi = new Date().toISOString().split('T')[0];
        const reportateValide = (angajat.zile_co_reportate ?? 0) > 0 && (!angajat.zile_co_reportate_expira || angajat.zile_co_reportate_expira >= azi);
        let zile_co_nou = angajat.zile_co;
        let zile_co_reportate_nou = angajat.zile_co_reportate ?? 0;
        if (reportateValide) {
          const dinReportate = Math.min(angajat.zile_co_reportate ?? 0, zile_lucratoare);
          zile_co_reportate_nou = Math.max(0, (angajat.zile_co_reportate ?? 0) - dinReportate);
          zile_co_nou = Math.max(0, angajat.zile_co - (zile_lucratoare - dinReportate));
        } else {
          zile_co_nou = Math.max(0, angajat.zile_co - zile_lucratoare);
        }
        await supabaseAdmin
          .from('angajati')
          .update({ zile_co: zile_co_nou, zile_co_reportate: zile_co_reportate_nou })
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

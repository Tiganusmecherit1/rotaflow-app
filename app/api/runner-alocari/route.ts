import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.from('runner_alocari').select('*');
    if (error) throw error;
    return NextResponse.json({ alocari: data });
  } catch (error) {
    console.error('Eroare la citirea alocarilor de runner:', error);
    return NextResponse.json({ error: 'Nu am putut citi alocarile' }, { status: 500 });
  }
}

// Creeaza o alocare noua — cautam noi concediu_id (dupa angajat+date), ca stergerea
// concediului sa elibereze automat runnerul (ON DELETE CASCADE), chiar daca ceva scapa
// din codul aplicatiei. Clientul nu trebuie sa stie id-ul real al concediului.
export async function POST(request: Request) {
  try {
    const { runner_pozitie, angajat_acoperit_pozitie, angajat_acoperit_uuid, data_start_ciclu, perioada_start, perioada_sfarsit } = await request.json();
    if (!runner_pozitie || !angajat_acoperit_pozitie || !data_start_ciclu || !perioada_start || !perioada_sfarsit) {
      return NextResponse.json({ error: 'Date incomplete' }, { status: 400 });
    }
    // Un runner poate acoperi o singura persoana simultan — stergem orice alocare veche a lui inainte
    await supabaseAdmin.from('runner_alocari').delete().eq('runner_pozitie', runner_pozitie);

    let concediuId: string | null = null;
    if (angajat_acoperit_uuid) {
      // Concediul poate fi inca in curs de inserare (cerere separata, aproape simultana) —
      // reincercam de cateva ori, cu pauze mici, inainte sa renuntam.
      for (let incercare = 0; incercare < 4 && !concediuId; incercare++) {
        if (incercare > 0) await new Promise(r => setTimeout(r, 400));
        const { data: concediu } = await supabaseAdmin
          .from('concedii').select('id')
          .eq('angajat_id', angajat_acoperit_uuid)
          .eq('data_start', perioada_start)
          .order('id', { ascending: false }).limit(1).maybeSingle();
        concediuId = concediu?.id ?? null;
      }
    }

    const { data, error } = await supabaseAdmin.from('runner_alocari').insert({
      runner_pozitie, angajat_acoperit_pozitie, data_start_ciclu, perioada_start, perioada_sfarsit,
      concediu_id: concediuId,
    }).select().single();
    if (error) throw error;
    return NextResponse.json({ alocare: data });
  } catch (error) {
    console.error('Eroare la salvarea alocarii de runner:', error);
    return NextResponse.json({ error: 'Nu am putut salva alocarea' }, { status: 500 });
  }
}

// Elibereaza un runner manual (dupa pozitia lui, nu mai are nevoie de concediu asociat)
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const runnerPozitie = searchParams.get('runner_pozitie');
    if (!runnerPozitie) return NextResponse.json({ error: 'Lipseste runner_pozitie' }, { status: 400 });
    const { error } = await supabaseAdmin.from('runner_alocari').delete().eq('runner_pozitie', Number(runnerPozitie));
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Eroare la eliberarea runnerului:', error);
    return NextResponse.json({ error: 'Nu am putut elibera runnerul' }, { status: 500 });
  }
}

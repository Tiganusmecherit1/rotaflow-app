import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const [angajati, concedii, absente, swapuri, istoric, setari] = await Promise.all([
      supabaseAdmin.from('angajati').select('*').order('pozitie_rotatie'),
      supabaseAdmin.from('concedii').select('*'),
      supabaseAdmin.from('absente').select('*'),
      supabaseAdmin.from('swap_requests').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('istoric_log').select('*').order('created_at', { ascending: false }).limit(100),
      supabaseAdmin.from('setari_echipa').select('*').single(),
    ]);

    if (angajati.error) throw angajati.error;
    if (concedii.error) throw concedii.error;
    if (absente.error) throw absente.error;
    if (swapuri.error) throw swapuri.error;
    if (istoric.error) throw istoric.error;
    if (setari.error) throw setari.error;

    return NextResponse.json({
      angajati: angajati.data,
      concedii: concedii.data,
      absente: absente.data,
      swapuri: swapuri.data,
      istoric: istoric.data,
      setari: setari.data,
    });
  } catch (error) {
    console.error('Eroare la incarcarea datelor:', error);
    return NextResponse.json({ error: 'Nu am putut incarca datele' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { table, id, data } = await request.json();
    
    // Validare minima
    const tabelePermise = ['angajati'];
    if (!tabelePermise.includes(table)) {
      return NextResponse.json({ error: 'Tabel nepermis' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from(table).update(data).eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Eroare PATCH:', error);
    return NextResponse.json({ error: 'Eroare la actualizare' }, { status: 500 });
  }
}

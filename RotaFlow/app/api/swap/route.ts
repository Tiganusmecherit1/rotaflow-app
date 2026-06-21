import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { solicitant_id, solicitant_data, partener_id, partener_data, nota, status } = body;

    if (!solicitant_id || !solicitant_data || !partener_id || !partener_data) {
      return NextResponse.json({ error: 'Date incomplete pentru swap' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('swap_requests')
      .insert({
        solicitant_id,
        solicitant_data,
        partener_id,
        partener_data,
        nota: nota || null,
        status: status || 'aprobat', // desktop-ul (sef) poate crea swap-uri deja aprobate direct
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ swap: data });
  } catch (error) {
    console.error('Eroare la crearea swap-ului:', error);
    return NextResponse.json({ error: 'Nu am putut crea swap-ul' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: 'Lipsesc date pentru actualizare' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { status };
    if (status === 'aprobat' || status === 'refuzat_sef') {
      updateData.sef_raspuns_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('swap_requests')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ swap: data });
  } catch (error) {
    console.error('Eroare la actualizarea swap-ului:', error);
    return NextResponse.json({ error: 'Nu am putut actualiza swap-ul' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Lipseste id-ul swap-ului' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('swap_requests').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Eroare la stergerea swap-ului:', error);
    return NextResponse.json({ error: 'Nu am putut sterge swap-ul' }, { status: 500 });
  }
}

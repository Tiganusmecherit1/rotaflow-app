import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const de = searchParams.get('de'); // data minima (YYYY-MM-DD), optional
    let query = supabaseAdmin.from('note_tura').select('*').order('creat_la', { ascending: false }).limit(100);
    if (de) query = query.gte('data', de);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ note: data });
  } catch (error) {
    console.error('Eroare la citirea notelor de predare:', error);
    return NextResponse.json({ error: 'Nu am putut citi notele' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { angajat_id, data, text } = await request.json();
    if (!angajat_id || !data || !text?.trim()) {
      return NextResponse.json({ error: 'Date incomplete (angajat_id, data, text)' }, { status: 400 });
    }
    // Un singur rand per (angajat, zi) — daca scrie din nou, actualizeaza nota existenta
    const { data: existent } = await supabaseAdmin.from('note_tura').select('id').eq('angajat_id', angajat_id).eq('data', data).maybeSingle();
    if (existent) {
      const { data: rezultat, error } = await supabaseAdmin.from('note_tura').update({ text: text.trim(), creat_la: new Date().toISOString() }).eq('id', existent.id).select().single();
      if (error) throw error;
      return NextResponse.json({ nota: rezultat });
    }
    const { data: rezultat, error } = await supabaseAdmin.from('note_tura').insert({ angajat_id, data, text: text.trim() }).select().single();
    if (error) throw error;
    return NextResponse.json({ nota: rezultat });
  } catch (error) {
    console.error('Eroare la salvarea notei de predare:', error);
    return NextResponse.json({ error: 'Nu am putut salva nota' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Lipseste id-ul notei' }, { status: 400 });
    const { error } = await supabaseAdmin.from('note_tura').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Eroare la stergerea notei de predare:', error);
    return NextResponse.json({ error: 'Nu am putut sterge nota' }, { status: 500 });
  }
}

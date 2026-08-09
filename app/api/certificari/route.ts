import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.from('certificari').select('*').order('data_expirare', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ certificari: data });
  } catch (error) {
    console.error('Eroare la citirea certificarilor:', error);
    return NextResponse.json({ error: 'Nu am putut citi certificarile' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { angajat_id, nume_certificat, data_obtinere, data_expirare, note } = await request.json();
    if (!angajat_id || !nume_certificat?.trim()) {
      return NextResponse.json({ error: 'Date incomplete (angajat_id, nume_certificat)' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from('certificari').insert({
      angajat_id, nume_certificat: nume_certificat.trim(),
      data_obtinere: data_obtinere || null, data_expirare: data_expirare || null, note: note || null,
    }).select().single();
    if (error) throw error;
    return NextResponse.json({ certificat: data });
  } catch (error) {
    console.error('Eroare la salvarea certificatului:', error);
    return NextResponse.json({ error: 'Nu am putut salva certificatul' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Lipseste id-ul' }, { status: 400 });
    const { error } = await supabaseAdmin.from('certificari').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Eroare la stergerea certificatului:', error);
    return NextResponse.json({ error: 'Nu am putut sterge certificatul' }, { status: 500 });
  }
}

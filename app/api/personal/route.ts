import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function genereazaLogin(numeComplet: string): string {
  const parti = numeComplet.trim().split(/\s+/);
  const prenume = parti[0];
  const nume = parti.slice(1).join('') || parti[0];
  return `${prenume[0].toLowerCase()}.${nume.toLowerCase()}`;
}

async function creeazaContLogin(nume: string) {
  const login = genereazaLogin(nume);
  const email = `${login}@rotaflow.com`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email, password: login, email_confirm: true,
  });
  if (error) return { error: error.message };
  return { authUserId: data.user.id, email, parola: login };
}

// POST: adauga angajat nou (fara sa inlocuiasca pe nimeni)
// body: { nume, locatie_id, tip, data_start_ciclu?, zile_co?, creeaza_cont }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { actiune } = body;

    if (actiune === 'adauga') {
      const { nume, locatie_id, tip, data_start_ciclu, zile_co, creeaza_cont } = body;
      if (!nume?.trim() || !locatie_id) {
        return NextResponse.json({ error: 'Date incomplete (nume, locatie_id)' }, { status: 400 });
      }

      // Urmatoarea pozitie_rotatie libera, per locatie
      const { data: existenti } = await supabaseAdmin
        .from('angajati').select('pozitie_rotatie').eq('locatie_id', locatie_id);
      const maxPoz = Math.max(0, ...(existenti || []).map((a: any) => a.pozitie_rotatie || 0));
      const pozitieNoua = maxPoz + 1;

      let authUserId: string | null = null;
      let credentiale = null;
      if (creeaza_cont) {
        const rezCont = await creeazaContLogin(nume);
        if ('error' in rezCont) {
          return NextResponse.json({ error: `Angajat NU a fost creat — eroare la crearea contului: ${rezCont.error}` }, { status: 500 });
        }
        authUserId = rezCont.authUserId;
        credentiale = { email: rezCont.email, parola: rezCont.parola };
      }

      const { data: nouAngajat, error } = await supabaseAdmin.from('angajati').insert({
        nume: nume.trim(), locatie_id, tip: tip || 'fix',
        pozitie_rotatie: pozitieNoua, zile_co: zile_co ?? 21,
        data_start_ciclu: data_start_ciclu || null,
        auth_user_id: authUserId, este_sef: false, activ: true,
      }).select().single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ angajat: nouAngajat, credentiale });
    }

    if (actiune === 'inlocuieste') {
      const { id_vechi, nume_nou, creeaza_cont } = body;
      if (!id_vechi || !nume_nou?.trim()) {
        return NextResponse.json({ error: 'Date incomplete (id_vechi, nume_nou)' }, { status: 400 });
      }

      const { data: vechi, error: errVechi } = await supabaseAdmin
        .from('angajati').select('*').eq('id', id_vechi).single();
      if (errVechi || !vechi) return NextResponse.json({ error: 'Nu găsesc angajatul de înlocuit' }, { status: 404 });

      let authUserId: string | null = null;
      let credentiale = null;
      if (creeaza_cont) {
        const rezCont = await creeazaContLogin(nume_nou);
        if ('error' in rezCont) {
          return NextResponse.json({ error: `Înlocuire OPRITĂ — eroare la crearea contului: ${rezCont.error}` }, { status: 500 });
        }
        authUserId = rezCont.authUserId;
        credentiale = { email: rezCont.email, parola: rezCont.parola };
      }

      // Noul angajat preia EXACT pozitia din rotatie a celui vechi
      const { data: nouAngajat, error: errNou } = await supabaseAdmin.from('angajati').insert({
        nume: nume_nou.trim(), locatie_id: vechi.locatie_id, tip: vechi.tip,
        pozitie_rotatie: vechi.pozitie_rotatie, zile_co: 21,
        data_start_ciclu: vechi.data_start_ciclu,
        auth_user_id: authUserId, este_sef: false, activ: true,
      }).select().single();
      if (errNou) return NextResponse.json({ error: errNou.message }, { status: 500 });

      // Dezactivam vechiul angajat — istoricul (concedii, absente, note) ramane in baza
      const { error: errDezact } = await supabaseAdmin
        .from('angajati').update({ activ: false }).eq('id', id_vechi);
      if (errDezact) return NextResponse.json({ error: `Angajat nou creat, dar dezactivarea celui vechi a eșuat: ${errDezact.message}` }, { status: 500 });

      return NextResponse.json({ angajat: nouAngajat, credentiale, vechiDezactivat: vechi.nume });
    }

    if (actiune === 'dezactiveaza') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'Lipsește id-ul' }, { status: 400 });
      const { error } = await supabaseAdmin.from('angajati').update({ activ: false }).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Acțiune necunoscută' }, { status: 400 });
  } catch (error: any) {
    console.error('Eroare la gestionarea personalului:', error);
    return NextResponse.json({ error: error?.message || 'Eroare server' }, { status: 500 });
  }
}

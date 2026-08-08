// import-program.js
// ─────────────────────────────────────────────────────────────
// Aplica programul din PDF (August-Decembrie 2026) direct in Supabase:
//   - Blocurile CO consecutive -> concedii reale (scad automat din zileCO)
//   - S1/S2 -> override-uri manuale de tura (S1=Zi/D, S2=Noapte/S)
//
// FOLOSIRE (langa .env.local, in folderul RotaFlow):
//   node import-program.js            -> doar PREVIZUALIZEAZA, nu scrie nimic
//   node import-program.js --apply    -> chiar aplica in Supabase
// ─────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { CALENDAR } = require('./program_date.js');

function citesteEnvLocal() {
  const continut = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf-8');
  const env = {};
  continut.split(/\r?\n/).forEach(linie => {
    const match = linie.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  });
  return env;
}

// Nume din PDF -> nume real in baza de date (cautare partiala, ilike)
const NUME_MAP = {
  PETRACHE: 'Petrache',
  DOBRESCU: 'Dobrescu',
  ANDREI: 'Andrei Dumitru',
  LUCIAN: 'Lucian',
  STEFAN: 'Stefan',
};

function countZileLucratoare(startStr, endStr) {
  let count = 0;
  let d = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  while (d <= end) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) count++;
    d = new Date(d.getTime() + 86400000);
  }
  return count;
}

function fmtRO(dStr) {
  const d = new Date(dStr + 'T00:00:00');
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const env = citesteEnvLocal();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: angajati, error } = await supabase
    .from('angajati')
    .select('id, nume, pozitie_rotatie, zile_co, locatie_id')
    .eq('locatie_id', 1)
    .eq('activ', true);
  if (error) { console.error('Eroare citire angajati:', error.message); process.exit(1); }

  console.log(apply ? '\n=== APLIC în Supabase ===\n' : '\n=== PREVIZUALIZARE — nimic nu se scrie încă ===\n');

  for (const [numePdf, coduri] of Object.entries(CALENDAR)) {
    const fragmentCautat = NUME_MAP[numePdf];
    const angajat = angajati.find(a => a.nume.toLowerCase().includes(fragmentCautat.toLowerCase()));
    if (!angajat) { console.error(`✗ Nu găsesc angajat pentru "${numePdf}" (caut "${fragmentCautat}")`); continue; }

    console.log(`\n--- ${numePdf} -> ${angajat.nume} (zile CO curente: ${angajat.zile_co}) ---`);

    const datele = Object.keys(coduri).sort();

    // 1. Grupam CO in blocuri consecutive
    const blocuriCO = [];
    let blocCurent = null;
    for (const dStr of datele) {
      if (coduri[dStr] !== 'CO') { blocCurent = null; continue; }
      const dataAzi = new Date(dStr + 'T00:00:00');
      if (blocCurent) {
        const dataAsteptata = new Date(new Date(blocCurent.end + 'T00:00:00').getTime() + 86400000);
        if (dataAzi.getTime() === dataAsteptata.getTime()) {
          blocCurent.end = dStr;
          continue;
        }
      }
      blocCurent = { start: dStr, end: dStr };
      blocuriCO.push(blocCurent);
    }

    let totalZileCOScazute = 0;
    for (const bloc of blocuriCO) {
      const zl = countZileLucratoare(bloc.start, bloc.end);
      totalZileCOScazute += zl;
      const numeSlot = `${fmtRO(bloc.start)}–${fmtRO(bloc.end)}`;
      console.log(`  CO: ${bloc.start} -> ${bloc.end}  (${zl} zile lucrătoare)`);
      if (apply) {
        const { error: errIns } = await supabase.from('concedii').insert({
          angajat_id: angajat.id, data_start: bloc.start, data_sfarsit: bloc.end,
          nume_slot: numeSlot, zile_lucratoare: zl,
        });
        if (errIns) console.error(`    ✗ Eroare inserare concediu: ${errIns.message}`);
      }
    }
    if (totalZileCOScazute > 0) {
      const diferenta = angajat.zile_co - totalZileCOScazute;
      const nouZileCO = Math.max(0, diferenta);
      if (diferenta < 0) {
        console.log(`  ⚠️  DEFICIT: are ${angajat.zile_co}, are nevoie de ${totalZileCOScazute} — lipsesc ${-diferenta} zile! (setat la 0, nu negativ)`);
      } else {
        console.log(`  -> zile_co: ${angajat.zile_co} - ${totalZileCOScazute} = ${nouZileCO}`);
      }
      if (apply) {
        const { error: errUpd } = await supabase.from('angajati').update({ zile_co: nouZileCO }).eq('id', angajat.id);
        if (errUpd) console.error(`    ✗ Eroare actualizare zile_co: ${errUpd.message}`);
      }
    }

    // 2. S1/S2 ca override-uri manuale
    const overrides = datele
      .filter(d => coduri[d] === 'S1' || coduri[d] === 'S2')
      .map(d => ({
        id: `drag_${angajat.pozitie_rotatie}_${d}`,
        angajat_id: angajat.pozitie_rotatie,
        data: d,
        tura: coduri[d] === 'S1' ? 'D' : 'S',
        expira_la: '2030-01-01',
        locatie_id: 1,
      }));
    console.log(`  Ture S1/S2: ${overrides.length} zile (${overrides.filter(o=>o.tura==='D').length} Zi, ${overrides.filter(o=>o.tura==='S').length} Noapte)`);

    if (apply && overrides.length > 0) {
      // Insert in loturi de 100, ca sa nu depasim limite
      for (let i = 0; i < overrides.length; i += 100) {
        const lot = overrides.slice(i, i + 100);
        const { error: errOv } = await supabase.from('overrides').upsert(lot, { onConflict: 'id' });
        if (errOv) console.error(`    ✗ Eroare inserare ture (lot ${i}): ${errOv.message}`);
      }
      console.log(`  -> ${overrides.length} override-uri scrise`);
    }
  }

  if (!apply) {
    console.log('\n\nDacă totul arată bine mai sus, rulează din nou cu:\n\n    node import-program.js --apply\n');
  } else {
    console.log('\n\nGata — deschide aplicația desktop și verifică calendarul (Sincronizează DB dacă e nevoie).');
  }
}

main();

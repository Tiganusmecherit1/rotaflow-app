// list-credentials.js
// ─────────────────────────────────────────────────────────────
// Doar CITESTE si AFISEAZA — nu creeaza, nu modifica nimic in baza de date.
// Arata toti angajatii activi, cu email + parola calculate dupa aceeasi
// formula ca in create-users.js (p.nume@rotaflow.com), plus daca au deja
// cont legat sau nu.
//
// FOLOSIRE: pune-l langa .env.local (folderul RotaFlow), apoi:
//   node list-credentials.js
// ─────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function citesteEnvLocal() {
  const continut = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf-8');
  const env = {};
  continut.split(/\r?\n/).forEach(linie => {
    const match = linie.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  });
  return env;
}

// Aceleasi corectii ca in create-users.js — daca ai adaugat vreuna acolo,
// copiaz-o si aici, ca sa ramana consistent.
const SUPRASCRIERI = {
  // 'Cojocaru Alex': 'a.cojocaru',
  // 'Argenti Mircea': 'm.argenti',
};

function genereazaLogin(numeComplet) {
  if (SUPRASCRIERI[numeComplet]) return SUPRASCRIERI[numeComplet];
  const parti = numeComplet.trim().split(/\s+/);
  const prenume = parti[0];
  const nume = parti.slice(1).join('') || parti[0];
  return `${prenume[0].toLowerCase()}.${nume.toLowerCase()}`;
}

async function main() {
  const env = citesteEnvLocal();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: angajati, error } = await supabase
    .from('angajati')
    .select('nume, locatie_id, tip, auth_user_id, este_sef')
    .eq('activ', true)
    .order('locatie_id')
    .order('nume');

  if (error) { console.error('Eroare la citire:', error.message); process.exit(1); }
  if (!angajati || angajati.length === 0) { console.log('Niciun angajat activ gasit.'); return; }

  console.log('\n' + '─'.repeat(78));
  console.log('NUME'.padEnd(25) + 'EMAIL'.padEnd(28) + 'PAROLA'.padEnd(16) + 'CONT?');
  console.log('─'.repeat(78));

  let locatiaCurenta = null;
  for (const a of angajati) {
    const locLabel = a.locatie_id === 2 ? 'CTA' : 'PLO';
    if (locLabel !== locatiaCurenta) {
      locatiaCurenta = locLabel;
      console.log(`\n${a.este_sef ? '👔' : locLabel === 'CTA' ? '⚓' : '🏭'} ${a.este_sef ? 'ȘEFI' : locLabel}`);
    }
    const login = genereazaLogin(a.nume);
    const email = `${login}@rotaflow.com`;
    const areCont = a.auth_user_id ? '✓ are cont' : '✗ NU are cont';
    const tipLabel = a.tip === 'runner' ? ' (runner)' : '';
    console.log(`  ${(a.nume + tipLabel).padEnd(25)}${email.padEnd(28)}${login.padEnd(16)}${areCont}`);
  }

  console.log('\n' + '─'.repeat(78));
  const faraCont = angajati.filter(a => !a.auth_user_id).length;
  console.log(`Total: ${angajati.length} angajați activi — ${faraCont} fără cont încă.\n`);
}

main();

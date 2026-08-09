// reset-password.js
// ─────────────────────────────────────────────────────────────
// Reseteaza parola unui angajat la o valoare noua (nu poti "afla" parola
// veche — nimeni nu poate, e criptata ireversibil — dar poti seta una noua).
//
// FOLOSIRE (langa .env.local, in folderul RotaFlow):
//
//   node reset-password.js "Gabriel Petrache"
//       -> reseteaza la parola standard (formula p.nume, aceeasi ca la creare)
//
//   node reset-password.js "Gabriel Petrache" parolaMeaNoua123
//       -> reseteaza la o parola aleasa de tine, oricare
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

// Aceeasi formula ca in create-users.js / list-credentials.js
const SUPRASCRIERI = {
  // 'Cojocaru Alex': 'a.cojocaru',
};
function genereazaLogin(numeComplet) {
  if (SUPRASCRIERI[numeComplet]) return SUPRASCRIERI[numeComplet];
  const parti = numeComplet.trim().split(/\s+/);
  const prenume = parti[0];
  const nume = parti.slice(1).join('') || parti[0];
  return `${prenume[0].toLowerCase()}.${nume.toLowerCase()}`;
}

async function main() {
  const numeCautat = process.argv[2];
  const parolaCustom = process.argv[3];

  if (!numeCautat) {
    console.error('Foloseste: node reset-password.js "Nume Prenume" [parola-noua-optionala]');
    process.exit(1);
  }

  const env = citesteEnvLocal();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: angajati, error } = await supabase
    .from('angajati')
    .select('id, nume, auth_user_id')
    .ilike('nume', `%${numeCautat}%`)
    .eq('activ', true);

  if (error) { console.error('Eroare cautare:', error.message); process.exit(1); }
  if (!angajati || angajati.length === 0) {
    console.error(`Niciun angajat activ gasit dupa "${numeCautat}".`);
    process.exit(1);
  }
  if (angajati.length > 1) {
    console.error(`Am gasit ${angajati.length} angajati care se potrivesc — fii mai specific:`);
    angajati.forEach(a => console.error(`  - ${a.nume}`));
    process.exit(1);
  }

  const angajat = angajati[0];
  if (!angajat.auth_user_id) {
    console.error(`${angajat.nume} nu are inca un cont creat. Foloseste create-users.js --apply intai.`);
    process.exit(1);
  }

  const parolaNoua = parolaCustom || genereazaLogin(angajat.nume);

  const { error: errReset } = await supabase.auth.admin.updateUserById(angajat.auth_user_id, {
    password: parolaNoua,
  });

  if (errReset) {
    console.error(`✗ Eroare la resetare: ${errReset.message}`);
    process.exit(1);
  }

  console.log(`\n✓ Parola pentru ${angajat.nume} a fost resetata.`);
  console.log(`  Parola nouă: ${parolaNoua}\n`);
  console.log(`Spune-i omului parola noua — se poate loga imediat cu ea.\n`);
}

main();

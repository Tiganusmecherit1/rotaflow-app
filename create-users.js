// create-users.js
// ─────────────────────────────────────────────────────────────
// Creeaza automat conturi de autentificare (email + parola) pentru toti
// angajatii care inca nu au auth_user_id in baza de date.
//
// Format: p.nume@rotaflow.com, parola = p.nume  (p = prima litera a
// prenumelui, nume = numele de familie, tot cu litere mici)
//
// FOLOSIRE:
//   1. Pune fisierul asta in acelasi folder cu .env.local (folderul RotaFlow)
//   2. node create-users.js            -> doar PREVIZUALIZEAZA, nu creeaza nimic
//   3. Verifica tabelul afisat. Daca vreun nume e in ordine gresita
//      (ex. "Cojocaru Alex" ar da gresit "c.alex" in loc de "a.cojocaru"),
//      adauga o corectie manuala mai jos, in obiectul SUPRASCRIERI.
//   4. node create-users.js --apply    -> chiar creeaza conturile
// ─────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ─── Citim .env.local manual (fara dependinte noi) ───
function citesteEnvLocal() {
  const continut = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf-8');
  const env = {};
  continut.split(/\r?\n/).forEach(linie => {
    const match = linie.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  });
  return env;
}

// ─── Corectii manuale pentru nume in ordine "Nume Prenume" in loc de "Prenume Nume" ───
// Completeaza aici DUPA ce vezi tabelul de previzualizare, cu numele EXACT cum apare
// in baza de date (coloana din stanga a tabelului), si loginul corect dorit.
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
  const apply = process.argv.includes('--apply');
  const env = citesteEnvLocal();

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Lipsesc NEXT_PUBLIC_SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY din .env.local');
    process.exit(1);
  }

  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: angajati, error } = await supabase
    .from('angajati')
    .select('id, nume, auth_user_id')
    .eq('activ', true)
    .is('auth_user_id', null);

  if (error) { console.error('Eroare la citirea angajatilor:', error.message); process.exit(1); }
  if (!angajati || angajati.length === 0) {
    console.log('Toti angajatii activi au deja cont. Nimic de facut.');
    return;
  }

  console.log(`\n${angajati.length} angajati fara cont.`);
  console.log(apply ? 'CREEZ conturile acum:\n' : 'PREVIZUALIZARE — nimic nu se creeaza inca:\n');

  for (const a of angajati) {
    const login = genereazaLogin(a.nume);
    const email = `${login}@rotaflow.com`;
    const parola = login;
    console.log(`  ${a.nume.padEnd(25)} ->  ${email.padEnd(28)} (parola: ${parola})`);

    if (apply) {
      const { data: userCreat, error: errCreare } = await supabase.auth.admin.createUser({
        email, password: parola, email_confirm: true,
      });
      if (errCreare) {
        console.error(`    ✗ Eroare la crearea contului: ${errCreare.message}`);
        continue;
      }
      const { error: errUpdate } = await supabase
        .from('angajati')
        .update({ auth_user_id: userCreat.user.id })
        .eq('id', a.id);
      console.log(errUpdate
        ? `    ✗ Cont creat, dar NU am putut lega auth_user_id: ${errUpdate.message}`
        : `    ✓ Cont creat si legat de angajat.`);
    }
  }

  if (!apply) {
    console.log(`\nDaca tabelul de mai sus arata bine (verifica mai ales numele scrise "Nume Prenume"),`);
    console.log(`ruleaza din nou cu:\n\n    node create-users.js --apply\n`);
  } else {
    console.log(`\nGata — spune-le oamenilor emailul si parola de mai sus, ca sa se logheze prima data.`);
  }
}

main();

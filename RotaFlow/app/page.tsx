// RotaFlow v6.0 — Multi-locatie: selector PLO/CTA, algoritm 12h CTA, verificare 1Z+1N, N→Z blocat
'use client';
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Edit3, ChevronLeft, ChevronRight, FileDown, Calendar, X, AlertTriangle, HeartPulse, ArrowLeftRight, Trophy, ExternalLink, Clock, Printer, FlaskConical, Plus, Check, Scale, FileText, Cloud, LogOut } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const SARBATORI_RAW = ['2026-01-01','2026-01-02','2026-01-24','2026-04-19','2026-04-20','2026-05-01','2026-06-01','2026-06-08','2026-08-15','2026-11-30','2026-12-01','2026-12-25','2026-12-26'];
const SARBATORI = SARBATORI_RAW.map(d => new Date(d + 'T00:00:00'));
const isSarbatoare = (d: Date) => SARBATORI.some(s => s.toDateString() === d.toDateString());
const parseD = (s: string) => new Date(s + 'T00:00:00');

// Sloturi de concediu — conform art. 145 Codul Muncii, concediul se calculeaza in zile LUCRATOARE.
// Fiecare slot acopera Luni-Vineri (5 zile lucratoare). Sambata si Duminica din acelasi interval
// sunt marcate CO in calendar (absent fizic) dar NU se scad din zilele de CO ramase.
// (fostul SLOTS — lista fixa de saptamani predefinite — a fost eliminat;
// concediile se aleg acum liber, data + durata, fara dependenta de an)

const AVATAR_COLORS = ['#0078d4','#bf5af2','#4cd964','#ffd60a','#ff6b6b'];
const DAY_SHORT = ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'];
const DAY_FULL = ['Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă','Duminică'];
const LS_KEY = 'rotaflow_v1';

interface Concediu { n: string; s: string; e: string; uuid?: string }
interface Absenta { startDate: string; zile: number; tip: 'CM' | 'AN'; uuid?: string }
interface Swap { id: string; aId: number; aData: string; bId: number; bData: string; nota: string }
interface TuraOverride { id: string; angajatId: number; data: string; tura: string; expiraLa: string } // expiraLa = data plecarii suplinitorului. tura poate fi si text liber (ex. deplasare)
interface Angajat { id: number; uuid?: string; nume: string; zileCO: number; zileCOReportate?: number; zileCOReportateExpira?: string | null; concedii: Concediu[]; absente: Absenta[]; locatieId?: number; tip?: string; dataStartCiclu?: string | null }
interface LogEntry { ts: string; msg: string }
interface SimConcediu { id: string; angajatId: number; start: string; zile: number }

// ─── Tipuri brute din Supabase ───
interface SbAngajat { id: string; nume: string; pozitie_rotatie: number; zile_co: number; zile_co_reportate?: number; zile_co_reportate_expira?: string | null; este_sef: boolean; activ: boolean; locatie_id?: number; tip?: string; poate_rula?: boolean; data_start_ciclu?: string | null }
interface SbConcediu { id: string; angajat_id: string; data_start: string; data_sfarsit: string; nume_slot: string | null; zile_lucratoare: number }
interface SbAbsenta { id: string; angajat_id: string; tip: 'CM' | 'AN'; data_start: string; zile: number }
interface SbSwap { id: string; solicitant_id: string; solicitant_data: string; partener_id: string; partener_data: string; nota: string | null; status: string; created_at: string }
interface SbLog { id: string; mesaj: string; created_at: string }

const ECHIPA_DEFAULT: Angajat[] = [
  { id: 0, nume: 'Andrei',     zileCO: 24, concedii: [], absente: [] },
  { id: 1, nume: 'Cotcodacel', zileCO: 24, concedii: [], absente: [] },
  { id: 2, nume: 'Marcel',     zileCO: 24, concedii: [], absente: [] },
  { id: 3, nume: 'Dorel',      zileCO: 24, concedii: [], absente: [] },
  { id: 4, nume: 'Ciprian',    zileCO: 24, concedii: [], absente: [] },
];

// ─── Adaptor Supabase -> formatul intern Angajat[] ───
function adapteazaDateDinSupabase(
  sbAngajati: SbAngajat[],
  sbConcedii: SbConcediu[],
  sbAbsente: SbAbsenta[]
): Angajat[] {
  return sbAngajati
    .filter(a => !a.este_sef)
    .sort((a, b) => a.pozitie_rotatie - b.pozitie_rotatie)
    .map(a => ({
      id: a.pozitie_rotatie,
      uuid: a.id,
      nume: a.nume,
      zileCO: a.zile_co,
      zileCOReportate: a.zile_co_reportate ?? 0,
      zileCOReportateExpira: a.zile_co_reportate_expira ?? null,
      locatieId: a.locatie_id ?? 1,
      tip: a.tip ?? 'fix',
      dataStartCiclu: a.data_start_ciclu ?? null,
      concedii: sbConcedii
        .filter(c => c.angajat_id === a.id)
        .map(c => ({
          n: `${fmtDate(parseDataSb(c.data_start))}–${fmtDate(parseDataSb(c.data_sfarsit))}`,
          s: c.data_start,
          e: c.data_sfarsit,
          uuid: c.id,
        })),
      absente: sbAbsente
        .filter(ab => ab.angajat_id === a.id)
        .map(ab => ({ startDate: ab.data_start, zile: ab.zile, tip: ab.tip, uuid: ab.id })),
    }));
}
function parseDataSb(s: string) { return new Date(s + 'T00:00:00'); }

// ─── API helpers — inlocuiesc localStorage ───
async function fetchToateDatele() {
  const res = await fetch('/api/data');
  if (!res.ok) throw new Error('Eroare la incarcarea datelor');
  return res.json() as Promise<{
    angajati: SbAngajat[]; concedii: SbConcediu[]; absente: SbAbsenta[];
    swapuri: SbSwap[]; istoric: SbLog[]; setari: { suplinitor_activ: boolean };
  }>;
}
async function apiAdaugaConcediu(angajat_id: string, data_start: string, data_sfarsit: string, nume_slot: string | null, zile_lucratoare: number) {
  const res = await fetch('/api/concedii', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ angajat_id, data_start, data_sfarsit, nume_slot, zile_lucratoare }),
  });
  if (!res.ok) throw new Error('Eroare la adaugarea concediului');
  return res.json();
}
async function apiStergeConcediu(id: string) {
  const res = await fetch(`/api/concedii?id=${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Eroare la stergerea concediului');
  return res.json();
}
async function apiAdaugaAbsenta(angajat_id: string, tip: 'CM'|'AN', data_start: string, zile: number) {
  const res = await fetch('/api/absente', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ angajat_id, tip, data_start, zile }),
  });
  if (!res.ok) throw new Error('Eroare la adaugarea absentei');
  return res.json();
}
async function apiSetSuplinitor(activ: boolean) {
  const res = await fetch('/api/suplinitor', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activ }),
  });
  if (!res.ok) throw new Error('Eroare la actualizarea suplinitorului');
  return res.json();
}
async function apiCreeazaSwap(solicitant_id: string, solicitant_data: string, partener_id: string, partener_data: string, nota: string) {
  const res = await fetch('/api/swap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ solicitant_id, solicitant_data, partener_id, partener_data, nota, status: 'aprobat' }),
  });
  if (!res.ok) throw new Error('Eroare la crearea swap-ului');
  return res.json();
}
async function apiAdaugaIstoric(mesaj: string) {
  const res = await fetch('/api/istoric', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mesaj }),
  });
  if (!res.ok) console.error('Eroare la adaugarea in istoric');
  return res.json().catch(() => null);
}
async function apiActualizeazaAngajat(id: string, payload: { nume?: string; zile_co?: number; zile_co_reportate?: number; zile_co_reportate_expira?: string | null }) {
  const res = await fetch('/api/angajati', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...payload }),
  });
  if (!res.ok) throw new Error('Eroare la actualizarea angajatului');
  return res.json();
}

// Scade zile de CO — foloseste INTAI zilele reportate (daca exista si nu au expirat),
// apoi cele normale. Reportarea are sens doar daca se consuma prima, altfel expira degeaba.
function scadeZileCO(m: Angajat, zileDeScazut: number, aziStr: string): { zileCO: number; zileCOReportate: number } {
  const reportateValide = (m.zileCOReportate ?? 0) > 0 && (!m.zileCOReportateExpira || m.zileCOReportateExpira >= aziStr);
  if (!reportateValide) {
    return { zileCO: Math.max(0, m.zileCO - zileDeScazut), zileCOReportate: m.zileCOReportate ?? 0 };
  }
  const dinReportate = Math.min(m.zileCOReportate ?? 0, zileDeScazut);
  const ramasDeScazut = zileDeScazut - dinReportate;
  return {
    zileCOReportate: Math.max(0, (m.zileCOReportate ?? 0) - dinReportate),
    zileCO: Math.max(0, m.zileCO - ramasDeScazut),
  };
}


function getMonday(d: Date): Date {
  const r = new Date(d); const day = r.getDay();
  r.setDate(r.getDate() + (day === 0 ? -6 : 1 - day)); r.setHours(0,0,0,0); return r;
}
function fmtDate(d: Date) { return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' }); }
// Doar afisare — la PLO, D/S se arata acum ca Z/N (Zi/Noapte), ca la CTA.
// Datele interne raman 'D'/'S' neschimbate (ore, reguli, tot codul de rotatie).
// La CTA valorile reale sunt deja 'Z'/'N'/altele, deci mapping-ul nu le afecteaza.
function dispLabel(s: string): string { return s === 'D' ? 'Z' : s === 'S' ? 'N' : s; }
// Eticheta completa (cuvant, nu litera) pentru celulele mari — D/Z=Zi, S/N=Noapte, restul explicit
function dispLabelFull(s: string): string {
  const map: Record<string,string> = { D:'Zi', Z:'Zi', S:'Noapte', N:'Noapte', CO:'Concediu', CM:'Medical', AN:'Absent', L:'' };
  return map[s] ?? s;
}
// Elimina diacriticele romanesti — necesar pentru export PDF (jsPDF/Helvetica nu le suporta)
function faraDiacritice(s: string): string {
  return s
    .replace(/ă/g,'a').replace(/Ă/g,'A')
    .replace(/â/g,'a').replace(/Â/g,'A')
    .replace(/î/g,'i').replace(/Î/g,'I')
    .replace(/ș/g,'s').replace(/Ș/g,'S')
    .replace(/ț/g,'t').replace(/Ț/g,'T')
    .replace(/ş/g,'s').replace(/Ş/g,'S') // variante cu sedila (encoding vechi)
    .replace(/ţ/g,'t').replace(/Ţ/g,'T');
}
function fmtMonth(d: Date) { return d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' }); }
// CRITIC: foloseste componentele LOCALE ale datei, NU toISOString() (care converteste la UTC
// si poate "taia" o zi pentru fusuri orare est-europene precum Romania, UTC+2/+3).
// Acest bug afecta potrivirea swap-urilor cu zilele din calendar — vezi audit complet.
function fmtDateInput(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function fmtTs(d: Date) {
  return d.toLocaleDateString('ro-RO',{day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' +
    d.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'});
}

function inCO(d: Date, m: Angajat): boolean {
  // Verificare directa - data e in interiorul unui concediu existent
  if (m.concedii.some(c => { const s=parseD(c.s),e=parseD(c.e); e.setHours(23,59,59); return d>=s&&d<=e; })) return true;

  // Extindere weekend — conform art. 145 Codul Muncii, concediul se calculeaza in zile lucratoare.
  // Daca data e Sambata sau Duminica si exista un concediu care se termina in Vinerea precedenta
  // (sau mai tarziu in aceeasi saptamana), angajatul e absent fizic si in acea zi, fara cost CO.
  const wd = d.getDay(); // 0=Du, 6=Sa
  if (wd === 0 || wd === 6) {
    // Gasim Vinerea anterioara acestei Sambate/Duminici
    const daysToFriday = wd === 6 ? 1 : 2; // Sa -> 1 zi inapoi, Du -> 2 zile inapoi
    const vineriPrecedenta = new Date(d.getTime() - daysToFriday * 86400000);
    vineriPrecedenta.setHours(0,0,0,0);
    // Daca exista un concediu care acoperea Vinerea precedenta, atunci si Sambata/Duminica sunt CO fizic
    if (m.concedii.some(c => {
      const s=parseD(c.s), e=parseD(c.e); e.setHours(23,59,59);
      return vineriPrecedenta>=s && vineriPrecedenta<=e;
    })) return true;
  }

  // Verificare "punte" - daca data e exact 1-2 zile intre sfarsitul unui concediu si
  // inceputul altuia (sloturi adiacente, ex: 06-10 Apr + 13-17 Apr -> 11-12 Apr tratat ca CO,
  // fara cost suplimentar). IMPORTANT: limitat strict la maxim 2 zile — altfel, intre doua
  // concedii separate, distantate (ex. recuperare de zile din ani anteriori, in sloturi
  // raspandite peste an), TOT intervalul dintre ele era tratat gresit ca "tot in concediu".
  return m.concedii.some(c1 => m.concedii.some(c2 => {
    if (c1 === c2) return false;
    const e1 = parseD(c1.e);
    const s2 = parseD(c2.s);
    const gapStart = new Date(e1.getTime() + 86400000);
    const gapEnd = new Date(s2.getTime() - 86400000);
    if (gapStart.getTime() > gapEnd.getTime()) return false;
    const lungimeGol = Math.round((gapEnd.getTime() - gapStart.getTime()) / 86400000) + 1;
    if (lungimeGol > 2) return false; // punte doar pentru goluri de maxim 2 zile (weekend intre sloturi)
    let check = new Date(gapStart); 
    while (check <= gapEnd) {
      if (check.toDateString() === d.toDateString()) return true;
      check = new Date(check.getTime() + 86400000);
    }
    return false;
  }));
}
function inAbsenta(d: Date, m: Angajat, tip: 'CM'|'AN'|'any'): boolean {
  return m.absente.some(a => {
    if (tip !== 'any' && a.tip !== tip) return false;
    const s=parseD(a.startDate), e=new Date(s.getTime()+(a.zile-1)*86400000); e.setHours(23,59,59);
    return d>=s&&d<=e;
  });
}
function countZileLucratoare(s: string, e: string): number {
  let d=parseD(s); const ed=parseD(e); let c=0;
  while(d<=ed){const wd=d.getDay();if(wd>0&&wd<6&&!isSarbatoare(d))c++;d=new Date(d.getTime()+86400000);} return c;
}
// Calculeaza zilele de CO efectiv "noi" dintr-un interval — exclude zilele care se suprapun
// cu CM/AN existent sau cu alt concediu deja inregistrat al aceluiasi angajat (evita taxarea dubla)
function countZileLucratoareReale(s: string, e: string, m: Angajat): number {
  let d = parseD(s); const ed = parseD(e); let c = 0;
  while (d <= ed) {
    const wd = d.getDay();
    if (wd > 0 && wd < 6 && !isSarbatoare(d)) {
      const dejaCM = inAbsenta(d, m, 'CM');
      const dejaAN = inAbsenta(d, m, 'AN');
      const dejaCO = inCO(d, m);
      if (!dejaCM && !dejaAN && !dejaCO) c++;
    }
    d = new Date(d.getTime() + 86400000);
  }
  return c;
}

const SUPLINITOR_OBJ: Angajat = { id: 999, nume: 'Suplinitor', zileCO: 0, concedii: [], absente: [] };

// Helper: calculeaza turele pentru o zi intreaga cu rezolvare S→D
function calcTureZi(d: Date, activi: Angajat[], oreAcumulate: Record<number,number>, aFacutSIeri: Set<number>): Record<number, string> {
  const n = activi.length;
  const ref = new Date(2026,0,1);
  const dayIdx = Math.floor((d.getTime()-ref.getTime())/86400000);
  const activiSortati = [...activi].sort((a,b) => (oreAcumulate[a.id]||0) - (oreAcumulate[b.id]||0));

  const ture: Record<number, string> = {};
  activiSortati.forEach((m, poz) => {
    const sec = ((dayIdx + poz) % n + n) % n;
    if (sec === 0 || sec === 1) {
      // Blocat daca a facut S ieri
      ture[m.id] = aFacutSIeri.has(m.id) ? 'L' : 'D';
    } else if (sec === 2) {
      ture[m.id] = 'S';
    } else {
      ture[m.id] = 'L';
    }
  });

  // Daca am blocat un D → redistribuim: urmatorul liber fara restrictie S→D devine D
  const nD = Object.values(ture).filter(t => t === 'D').length;
  if (nD < 2) {
    const candidati = activiSortati.filter(m => ture[m.id] === 'L' && !aFacutSIeri.has(m.id));
    for (const c of candidati) {
      ture[c.id] = 'D';
      if (Object.values(ture).filter(t => t === 'D').length >= 2) break;
    }
  }

  return ture;
}

function getTuraBaza(d: Date, m: Angajat, toataEchipa: Angajat[], suplinitorActiv: boolean, oreAcumulate?: Record<number,number>): { type: string; label: string } {
  const rezultat = getTuraBazaRaw(d, m, toataEchipa, suplinitorActiv, oreAcumulate);
  // Verificare UNIVERSALA, indiferent din ce ramura a venit rezultatul (echitate,
  // degradat sau ciclu fix): niciodata D imediat dupa S. Fara asta, fiecare ramura
  // isi verifica doar propriul istoric si tranzitiile intre ramuri (ex. cineva
  // revine din CO si numarul de activi urca de la 3 la 4) pot scapa regula.
  if (rezultat.type === 'D') {
    const ieri = new Date(d.getTime() - 86400000);
    const ieriRezultat = getTuraBazaRaw(ieri, m, toataEchipa, suplinitorActiv, oreAcumulate);
    if (ieriRezultat.type === 'S') return { type: 'L', label: 'L' };
  }
  return rezultat;
}

function getTuraBazaRaw(d: Date, m: Angajat, toataEchipa: Angajat[], suplinitorActiv: boolean, oreAcumulate?: Record<number,number>): { type: string; label: string } {
  const isSup = m.id === 999;
  if (!isSup && inAbsenta(d, m, 'CM')) return { type: 'CM', label: 'CM' };
  if (!isSup && inAbsenta(d, m, 'AN')) return { type: 'AN', label: 'AN' };
  if (!isSup && inCO(d, m)) return { type: 'CO', label: 'CO' };
  if (isSup) return { type: 'L', label: 'L' };

  const activi = toataEchipa.filter(a => !inCO(d,a) && !inAbsenta(d,a,'any') && (a.locatieId ?? 1) === (m.locatieId ?? 1));
  const poz = activi.findIndex(a => a.id === m.id);
  if (poz === -1) return { type: 'L', label: 'L' };

  // Cu 4+ disponibili si ore acumulate → rotatie cu echitate si fara S→D
  if (activi.length >= 4 && oreAcumulate && Object.keys(oreAcumulate).length > 0) {
    // Calculam cine a facut S ieri
    const dIeri = new Date(d.getTime() - 86400000);
    const activiIeri = toataEchipa.filter(a => !inCO(dIeri,a) && !inAbsenta(dIeri,a,'any') && (a.locatieId ?? 1) === (m.locatieId ?? 1));
    const aFacutSIeri = new Set<number>();
    if (activiIeri.length >= 4) {
      const tureIeri = calcTureZi(dIeri, activiIeri, oreAcumulate, new Set<number>());
      Object.entries(tureIeri).forEach(([id, t]) => { if (t === 'S') aFacutSIeri.add(Number(id)); });
    }

    const tureAzi = calcTureZi(d, activi, oreAcumulate, aFacutSIeri);
    const t = tureAzi[m.id] ?? 'L';
    return { type: t, label: t };
  }

  // Fallback: n<4 (sub prag minim) SAU fara ore acumulate.
  // IMPORTANT: cu n<4, cerinta zilnica de 2D+1S (3 sloturi) nu poate fi
  // sustinuta la nesfarsit fara nicio zi libera — matematic imposibil sa
  // acoperi complet in fiecare zi ȘI sa respecti plafoanele legale, cu doar
  // 3 oameni disponibili pentru 3 sloturi zilnice. Algoritmul de mai jos
  // GARANTEAZA plafoanele legale (max 6 zile consecutive, fara tranzitie
  // S→D) chiar daca asta inseamna acoperire vizibil redusa unele zile —
  // e semnalul corect ca trebuie adus un Runner prin Planul de Criza,
  // nu o schema care "pare" completa dar incalca legea in liniste.
  if (activi.length < 4) {
    return getTuraDegradatSigur(d, m, toataEchipa);
  }

  // Fallback: ciclu fix original (4+ disponibili, fara ore acumulate)
  const ref = new Date(2026,0,1);
  const dayIdx = Math.floor((d.getTime()-ref.getTime())/86400000);
  const n = activi.length;
  const sec = ((dayIdx+poz)%n+n)%n;
  if (sec===0||sec===1) return { type: 'D', label: 'D' };
  if (sec===2) return { type: 'S', label: 'S' };
  return { type: 'L', label: 'L' };
}

// Tura "bruta" (fara corectii de plafon legal) pentru o singura zi — folosita
// doar ca baza de pornire in getTuraDegradatSigur, niciodata direct in UI.
function turaBrutaZi(d: Date, m: Angajat, toataEchipa: Angajat[]): string {
  const activiZi = toataEchipa.filter(a => !inCO(d,a) && !inAbsenta(d,a,'any') && (a.locatieId??1)===(m.locatieId??1));
  const pozZi = activiZi.findIndex(a => a.id === m.id);
  if (pozZi === -1) return 'L'; // era absent/CO in acea zi
  const nZi = activiZi.length;
  if (nZi === 0) return 'L';
  const ref = new Date(2026,0,1);
  const dayIdx = Math.floor((d.getTime()-ref.getTime())/86400000);
  const sec = ((dayIdx+pozZi)%nZi+nZi)%nZi;
  if (nZi >= 4) return sec<=2 ? (sec<=1?'D':'S') : 'L';
  if (sec===0||sec===1) return 'D';
  if (sec===2) return 'S';
  return 'L';
}

// Calculeaza tura pentru o zi, cu n<4 activi — model de bloc saptamanal:
// 2 oameni fac D toata saptamana (Lu-Sa), 1 om face S toata saptamana,
// Duminica toti sunt liberi (vine suplinitorul), Luni se reia (rotativ,
// ca sa nu ramana mereu aceeasi persoana pe S). Da acoperire COMPLETA
// (2D+1S) in fiecare zi lucratoare — spre deosebire de modelul anterior
// (odihna distribuita zilnic), care lasa zile sub-acoperite.
// Cache pentru inceputul crizei — legat de REFERINTA array-ului de echipa (se
// invalideaza automat cand echipa chiar se schimba, via setEchipa). Fara asta,
// scanarea de 120 de zile inapoi se repeta de pana la 8 ori pe celula (verificarile
// universale din getTura cheama aceasta functie de mai multe ori), multiplicat pe
// fiecare celula vizibila — de-aici lag-ul mare la orice click.
const crizaStartCache = new WeakMap<Angajat[], Map<string, string>>();

function getTuraDegradatSigur(d: Date, m: Angajat, toataEchipa: Angajat[]): { type: string; label: string } {
  // Duminica: toti liberi, vine suplinitorul
  if (d.getDay() === 0) return { type: 'L', label: 'L' };

  const activiZi = (dd: Date) => toataEchipa.filter(a => !inCO(dd,a) && !inAbsenta(dd,a,'any') && (a.locatieId??1)===(m.locatieId??1));

  // Cache pe saptamana (Luni) — in aceeasi saptamana, mai multe zile/apeluri
  // ar recalcula altfel exact aceeasi scanare de 120 de zile.
  let cacheEchipa = crizaStartCache.get(toataEchipa);
  if (!cacheEchipa) { cacheEchipa = new Map(); crizaStartCache.set(toataEchipa, cacheEchipa); }
  const cacheKey = `${m.locatieId ?? 1}_${fmtDateInput(getMonday(d))}`;

  let crizaStart: Date;
  const cachedVal = cacheEchipa.get(cacheKey);
  if (cachedVal) {
    crizaStart = parseD(cachedVal);
  } else {
    // Gasim inceputul crizei: prima zi (mergand inapoi) dupa care activii au fost mereu <4
    let cs = new Date(d);
    for (let i = 1; i <= 120; i++) {
      const dPrev = new Date(d.getTime() - i*86400000);
      if (activiZi(dPrev).length >= 4) { cs = new Date(dPrev.getTime() + 86400000); break; }
      cs = dPrev;
    }
    crizaStart = cs;
    cacheEchipa.set(cacheKey, fmtDateInput(crizaStart));
  }

  const luniAzi = getMonday(d);
  const luniStart = getMonday(crizaStart);
  const saptamaniTrecute = Math.round((luniAzi.getTime() - luniStart.getTime()) / (7*86400000));

  // Echipa STABILA pentru aceasta saptamana: disponibili in toate zilele
  // lucratoare (Lu-Sa), nu doar azi — altfel cineva care intra/iese in
  // mijlocul saptamanii ar strica alocarea D/D/S pentru toti ceilalti.
  const zileSapt: Date[] = [];
  for (let i=0;i<7;i++) zileSapt.push(new Date(luniAzi.getTime()+i*86400000));
  const zileSaptLucratoare = zileSapt.filter(z => z.getDay() !== 0);
  const activiSapt = toataEchipa.filter(a =>
    (a.locatieId??1)===(m.locatieId??1) && zileSaptLucratoare.every(z => !inCO(z,a) && !inAbsenta(z,a,'any'))
  );
  if (activiSapt.length === 0) return { type: 'L', label: 'L' };

  const poz = activiSapt.findIndex(a => a.id === m.id);
  if (poz === -1) return { type: 'L', label: 'L' }; // nu a fost stabil disponibil toata saptamana

  // Cine face S saptamana asta — rotativ, pentru echitate pe termen lung.
  // La prima saptamana a crizei: daca cineva a facut S chiar cu o zi inainte
  // (prin rotatia normala), ramane pe S, ca sa nu-l trecem direct in D (S→D interzis).
  let omSIdx: number;
  if (saptamaniTrecute === 0) {
    const ieriCriza = new Date(crizaStart.getTime() - 86400000);
    const facutSIeri = activiSapt.findIndex(a => turaBrutaZi(ieriCriza, a, toataEchipa) === 'S');
    omSIdx = facutSIeri !== -1 ? facutSIeri : 0;
  } else {
    omSIdx = ((saptamaniTrecute % activiSapt.length) + activiSapt.length) % activiSapt.length;
  }

  const tip = poz === omSIdx ? 'S' : 'D';
  return { type: tip, label: tip };
}

function getTura(d: Date, m: Angajat, toataEchipa: Angajat[], suplinitorActiv: boolean, swapuri: Swap[], turaOverride: TuraOverride[] = [], oreAcumulate?: Record<number,number>): { type: string; label: string; swapped?: boolean } {
  const rezultat = getTuraRaw(d, m, toataEchipa, suplinitorActiv, swapuri, turaOverride, oreAcumulate);
  // Verificari UNIVERSALE la nivelul CEL MAI EXTERIOR (cel care stie de override-uri
  // de criza/manuale): (1) niciodata D imediat dupa S, (2) niciodata peste 6 zile
  // consecutive — indiferent din ce "ramura" a algoritmului vine decizia (rotatie
  // normala, echitate, sau blocul saptamanal de criza). Altfel granitele dintre
  // ramuri (ex. cand scade de la 4 la 3 activi) pot scapa regulile.
  if (rezultat.type === 'D' || rezultat.type === 'S') {
    const ieri = new Date(d.getTime() - 86400000);
    const ieriRezultat = getTuraRaw(ieri, m, toataEchipa, suplinitorActiv, swapuri, turaOverride, oreAcumulate);
    if (rezultat.type === 'D' && ieriRezultat.type === 'S') return { type: 'L', label: 'L', swapped: false };

    // Plafon 6 zile — verificare marginita (max 6 pasi inapoi, fara recursivitate,
    // ca sa nu reintroducem problema de performanta de dinainte).
    let consecutive = 0;
    for (let i = 1; i <= 6; i++) {
      const dPrev = new Date(d.getTime() - i * 86400000);
      const tPrev = getTuraRaw(dPrev, m, toataEchipa, suplinitorActiv, swapuri, turaOverride, oreAcumulate).type;
      if (tPrev === 'D' || tPrev === 'S') consecutive++; else break;
    }
    if (consecutive >= 6) return { type: 'L', label: 'L', swapped: false };
  }
  return rezultat;
}

// Cache pe rezultatul getTuraRaw — legat de referinta turaOverride (array-ul
// care se schimba de fapt la fiecare click). In interiorul aceluiasi render,
// aceeasi zi/angajat e cerut de multe ori (verificarile universale S→D si de
// 6 zile, plus calculele de statistici pe luna intreaga) — fara cache, fiecare
// cerere recalculeaza totul de la zero.
const turaRawCache = new WeakMap<TuraOverride[], Map<string, { type: string; label: string; swapped?: boolean }>>();

function getTuraRaw(d: Date, m: Angajat, toataEchipa: Angajat[], suplinitorActiv: boolean, swapuri: Swap[], turaOverride: TuraOverride[] = [], oreAcumulate?: Record<number,number>): { type: string; label: string; swapped?: boolean } {
  let cache = turaRawCache.get(turaOverride);
  if (!cache) { cache = new Map(); turaRawCache.set(turaOverride, cache); }
  const cacheKey = `${m.id}_${fmtDateInput(d)}_${suplinitorActiv?1:0}_${swapuri.length}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const rezultat = getTuraRawInner(d, m, toataEchipa, suplinitorActiv, swapuri, turaOverride, oreAcumulate);
  cache.set(cacheKey, rezultat);
  return rezultat;
}

function getTuraRawInner(d: Date, m: Angajat, toataEchipa: Angajat[], suplinitorActiv: boolean, swapuri: Swap[], turaOverride: TuraOverride[] = [], oreAcumulate?: Record<number,number>): { type: string; label: string; swapped?: boolean } {
  const dStr = fmtDateInput(d);

  // CO/CM/AN au prioritate absoluta
  if (m.id !== 999) {
    if (inAbsenta(d, m, 'CM')) return { type: 'CM', label: 'CM' };
    if (inAbsenta(d, m, 'AN')) return { type: 'AN', label: 'AN' };
    if (inCO(d, m)) return { type: 'CO', label: 'CO' };
  }

  // Override manual (drag_) are prioritate maxima dupa CO/CM/AN
  const overrideManual = turaOverride.find(o =>
    o.id.startsWith('drag_') && o.angajatId === m.id && o.data === dStr && parseD(o.expiraLa) > d
  );
  if (overrideManual) {
    // Deplasare (text custom, ex. "Craiova") — conteaza tot ca Birou la ore/logica,
    // doar afisarea foloseste textul scris de sef.
    if (overrideManual.id.startsWith('drag_deplasare_')) {
      return { type: 'B', label: overrideManual.tura, swapped: false };
    }
    return { type: overrideManual.tura, label: overrideManual.tura, swapped: false };
  }

  // Override de criza — acum doar Duminici (criza_SUP_ pentru vizitator, criza_{id}_ pentru localii puși pe liber)
  const override = turaOverride.find(o =>
    !o.id.startsWith('drag_') && o.angajatId === m.id && o.data === dStr && parseD(o.expiraLa) > d
  );
  if (override) return { type: override.tura, label: override.tura, swapped: false };

  const swA = swapuri.find(sw => sw.aId===m.id && sw.aData===dStr);
  const swB = swapuri.find(sw => sw.bId===m.id && sw.bData===dStr);
  const turaPentruSwap = (dataStr: string, persoana: Angajat) => {
    const d = parseD(dataStr);
    if (isCTA(persoana) && persoana.dataStartCiclu && persoana.tip !== 'runner') {
      const tura = getTuraCTA(d, persoana.dataStartCiclu);
      return { type: tura, label: tura };
    }
    return getTuraBaza(d, persoana, toataEchipa, suplinitorActiv, oreAcumulate);
  };
  if (swA) {
    const b = toataEchipa.find(x => x.id===swA.bId);
    if (b) { const t=turaPentruSwap(swA.bData,b); if (t.type==='D'||t.type==='S'||t.type==='Z'||t.type==='N') return {...t,label:t.label+'↔',swapped:true}; }
  }
  if (swB) {
    const a = toataEchipa.find(x => x.id===swB.aId);
    if (a) { const t=turaPentruSwap(swB.aData,a); if (t.type==='D'||t.type==='S'||t.type==='Z'||t.type==='N') return {...t,label:t.label+'↔',swapped:true}; }
  }

  // CTA — algoritm 12h bazat pe data_start_ciclu (doar angajati fix, nu runneri nealocati)
  if (isCTA(m) && m.dataStartCiclu && m.tip !== 'runner') {
    const tura = getTuraCTA(d, m.dataStartCiclu);
    return { type: tura, label: tura, swapped: false };
  }

  return getTuraBaza(d, m, toataEchipa, suplinitorActiv, oreAcumulate);
}

// Verifica daca un angajat depaseste 48h/saptamana (Art. 114)
function calcOreSaptamana(m: Angajat, weekStart: Date, echipa: Angajat[], suplinitor: boolean, swapuri: Swap[], turaOverride: TuraOverride[] = [], oreAcumulate?: Record<number,number>, runneriActivi?: Set<number>, runnerCicluOverride?: Record<number, {dataStartCiclu: string; perioadaStart: string; perioadaSfarsit: string}>): number {
  let ore = 0;
  const orePerTura = isCTA(m) ? 12 : 8;
  // Filtram o singura data per apel (nu in interiorul buclei de 7 zile) — altfel
  // fiecare zi recreeaza un array nou, si cache-ul de detectare a crizei nu mai
  // gaseste niciodata acelasi array, degeaba.
  const echipaFiltrata = echipa.filter(a => (a.locatieId??1)===(m.locatieId??1) && a.tip!=='runner');

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * 86400000);
    const dStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const isWE = d.getDay() === 0 || d.getDay() === 6;

    // Runner cu ciclu override (asignat la CO) — Z/N = 12h
    const ovCiclu = runnerCicluOverride?.[m.id];
    if (ovCiclu && dStr >= ovCiclu.perioadaStart && dStr <= ovCiclu.perioadaSfarsit) {
      const tura = getTuraCTA(d, ovCiclu.dataStartCiclu);
      if (tura === 'Z' || tura === 'N') ore += 12;
      continue;
    }

    // Runner simplu (tip='runner') — citim din turaOverride manual (drag_) SAU
    // dintr-o zi de acoperire PLO in plan de criza (criza_) — ambele conteaza la ore
    if (isCTA(m) && m.tip==='runner') {
      const ov = turaOverride?.find(o=>(o.id.startsWith('drag_')||o.id.startsWith('criza_'))&&o.angajatId===m.id&&o.data===dStr);
      if (ov) {
        if (ov.id.startsWith('drag_deplasare_')) ore += 8; // Deplasare (text custom) = tot 8h, ca Birou
        else if (ov.tura === 'R') ore += 8;           // Runner activ = 8h
        else if (ov.tura === 'Z' || ov.tura === 'N') ore += 12; // Tura CTA 12h
        else if (ov.tura === 'D' || ov.tura === 'S') ore += 8;  // Acoperire PLO in criza = 8h
        // L = 0h
      } else {
        // Default birou: L-V = 8h, Sa/Du = 0h
        if (!isWE) ore += 8;
      }
      continue;
    }

    // Angajati fix — getTura normal
    if (isCTA(m) && !m.dataStartCiclu) continue;
    const t = getTura(d, m, echipaFiltrata, suplinitor, swapuri, turaOverride, oreAcumulate);
    if (t.type === 'D' || t.type === 'S' || t.type === 'Z' || t.type === 'N') {
      ore += orePerTura;
    }
  }
  return ore;
}

// ─── Simulare: concedii custom (durata libera, suprapuneri posibile) ───
function inSimConcediu(d: Date, angajatId: number, simConcedii: SimConcediu[]): boolean {
  return simConcedii.some(sc => {
    if (sc.angajatId !== angajatId) return false;
    const s = parseD(sc.start);
    const e = new Date(s.getTime() + (sc.zile - 1) * 86400000); e.setHours(23, 59, 59);
    return d >= s && d <= e;
  });
}

// Tura pentru simulare — combina concediile simulate cu CO/CM/AN reale
function getTuraSim(d: Date, m: Angajat, toataEchipa: Angajat[], simConcedii: SimConcediu[], suplinitorActiv: boolean): { type: string; label: string } {
  const isSup = m.id === 999;
  // Suplinitorul NU intra in rotatia simulata — apare doar prin override explicit
  if (isSup) return { type: 'L', label: 'L' };
  const eAbsentSim = (a: Angajat) => inSimConcediu(d, a.id, simConcedii) || inCO(d, a) || inAbsenta(d, a, 'any');
  if (eAbsentSim(m)) return { type: 'CO', label: 'CO' };
  // Rotatia simulata foloseste doar angajatii permanenti activi (fara suplinitor)
  const activi = toataEchipa.filter(a => !eAbsentSim(a));
  const poz = activi.findIndex(a => a.id === m.id);
  if (poz === -1) return { type: 'L', label: 'L' };
  const ref = new Date(2026, 0, 1);
  const dayIdx = Math.floor((d.getTime() - ref.getTime()) / 86400000);
  const n = activi.length;
  const sec = ((dayIdx + poz) % n + n) % n;
  if (sec === 0 || sec === 1) return { type: 'D', label: 'D' };
  if (sec === 2) return { type: 'S', label: 'S' };
  return { type: 'L', label: 'L' };
}

// Analiza de conformitate pentru un interval — verifica nr minim activi si ore maxime saptamanale
interface ConformitateIssue { tip: 'PUTINI_OAMENI' | 'ORE_MAXIME'; data: string; detalii: string }

// ─── Plan de Criza ───
// Optiunea 4: Un local face S o saptamana intreaga (rotativ).
// Seful din Constanta vine 1 zi/sapt (Sa preferabil): 2D+2S, toti localii liberi.
// Tranzitia S->D se face in ziua sefului (zi libera = zero S->D niciodata).
interface PlanCrizaZi {
  data: string;
  ture: Record<number | 'SUP', 'D' | 'S' | 'L' | '2D+2S'>;
  ziuaSef: boolean;
  omS: number; // id-ul localului care face S in aceasta saptamana
}
interface PlanCriza {
  dataStart: string;
  dataPlecareSup: string; // refolosit ca "data sfarsit criza" (ultima zi planificata)
  zileTotal: number;
  zileCuSup: number; // numarul de vizite ale sefului
  plan: PlanCrizaZi[];
}

function genereazaPlanCriza(echipaInput: Angajat[], dataStartStr: string, concediiSim: SimConcediu[] = [], simIssues: ConformitateIssue[] = [], dataEndStr?: string): PlanCriza | null {
  // Planul de criza e un concept strict PLO — CTA are runnerii lui, nu suplinitor.
  const echipa = echipaInput.filter(m => !isCTA(m));
  const dataStart = parseD(dataStartStr);

  const eAbsent = (m: Angajat, d: Date) => {
    if (inCO(d, m) || inAbsenta(d, m, 'any')) return true;
    return concediiSim.some(sc => {
      if (sc.angajatId !== m.id) return false;
      const s = parseD(sc.start);
      const e = new Date(s.getTime() + (sc.zile - 1) * 86400000);
      return d >= s && d <= e;
    });
  };

  const activiStart = echipa.filter(m => !eAbsent(m, dataStart));
  if (activiStart.length < 2) return null;

  // Determinam ultima zi de criza:
  // 1. Daca utilizatorul a specificat manual o data de sfarsit → o folosim
  // 2. Altfel → calculam automat (ultima zi cu < 4 activi)
  let dataEnd: Date = new Date(dataStart.getTime() + 28 * 86400000);
  if (dataEndStr) {
    dataEnd = parseD(dataEndStr);
  } else {
    for (let i = 1; i < 60; i++) {
      const d = new Date(dataStart.getTime() + i * 86400000);
      const activiD = echipa.filter(m => !eAbsent(m, d));
      if (activiD.length >= 4) {
        dataEnd = new Date(d.getTime() - 86400000);
        break;
      }
    }
  }

  // MASURAM DOAR — nu mai generam nicio alocare S/D artificiala pentru zilele
  // lucratoare. Duminicile din perioada primesc vizitatorul (Suplinitor/Runner);
  // Luni-Sambata raman pe rotatia normala existenta (care deja respecta legea
  // pentru sub 4 activi — vezi getTuraDegradatSigur), fara sa mai "inventam"
  // un tipar S/D separat, artificial, pe deasupra.
  const plan: PlanCrizaZi[] = [];
  let d = new Date(dataStart);
  while (d <= dataEnd) {
    const ziuaSupFlag = d.getDay() === 0;
    const ture: Record<number | 'SUP', 'D' | 'S' | 'L' | '2D+2S'> = {} as Record<number | 'SUP', 'D' | 'S' | 'L' | '2D+2S'>;
    if (ziuaSupFlag) {
      echipa.forEach(m => { ture[m.id] = 'L'; });
      ture['SUP'] = '2D+2S';
    }
    // Pe zilele lucratoare (non-Duminica) nu punem nimic in ture — randarea
    // foloseste rotatia normala (getTuraBaza) direct, fara override de criza.
    plan.push({ data: fmtDateInput(d), ture: ture as Record<number | 'SUP', 'D' | 'S' | 'L' | '2D+2S'>, ziuaSef: ziuaSupFlag, omS: -1 });
    d = new Date(d.getTime() + 86400000);
  }

  return {
    dataStart: dataStartStr,
    dataPlecareSup: fmtDateInput(dataEnd),
    zileTotal: plan.length,
    zileCuSup: plan.filter(p => p.ziuaSef).length,
    plan,
  };
}
function analizeazaConformitate(echipa: Angajat[], simConcedii: SimConcediu[], suplinitorActiv: boolean, startCheck: Date, zileCheck: number, pragMinimActivi = 4, pragOreMax = 48): ConformitateIssue[] {
  const issues: ConformitateIssue[] = [];
  const zileSet = new Set<string>();

  for (let i = 0; i < zileCheck; i++) {
    const d = new Date(startCheck.getTime() + i * 86400000);
    // Excludem angajatii in concediu simulat SAU in CO/CM/AN real
    const activi = echipa.filter(a => !inSimConcediu(d, a.id, simConcedii) && !inCO(d, a) && !inAbsenta(d, a, 'any'));
    // Suplinitorul/runner-ul vine acum doar Duminica — nu mai adaugam bonus la activi.
    const totalActivi = activi.length;
    if (totalActivi < pragMinimActivi) {
      const key = fmtDateInput(d);
      if (!zileSet.has('PUTINI_'+key)) {
        zileSet.add('PUTINI_'+key);
        issues.push({ tip: 'PUTINI_OAMENI', data: key, detalii: `${fmtDate(d)}: doar ${totalActivi} angajați activi (minim recomandat: ${pragMinimActivi})` });
      }
    }
  }

  // Verifica ore saptamanale pentru fiecare angajat, aliniat la saptamani calendaristice reale (Luni-Duminica)
  // — nu pe ferestre alunecatoare de 7 zile pornind din ziua aleasa de utilizator, ca sa corespunda
  // exact modului in care legea (Art. 114) defineste saptamana de lucru
  echipa.forEach(m => {
    const primaLuni = getMonday(startCheck);
    const ultimaZi = new Date(startCheck.getTime() + (zileCheck - 1) * 86400000);
    for (let wkStart = new Date(primaLuni); wkStart <= ultimaZi; wkStart = new Date(wkStart.getTime() + 7*86400000)) {
      let ore = 0;
      for (let j = 0; j < 7; j++) {
        const d = new Date(wkStart.getTime() + j * 86400000);
        const t = getTuraSim(d, m, echipa, simConcedii, suplinitorActiv);
        if (t.type === 'D' || t.type === 'S') ore += 8;
      }
      if (ore > pragOreMax) {
        const key = `${m.id}_${fmtDateInput(wkStart)}`;
        if (!zileSet.has('ORE_'+key)) {
          zileSet.add('ORE_'+key);
          issues.push({ tip: 'ORE_MAXIME', data: fmtDateInput(wkStart), detalii: `${m.nume}: ${ore}h în săptămâna din ${fmtDate(wkStart)} (limită legală: ${pragOreMax}h)` });
        }
      }
    }
  });

  return issues;
}


const SHIFT_STYLE: Record<string, string> = {
  D:  'bg-orange-400/[0.09] text-orange-300 border-l-4 border-orange-400',
  S:  'bg-violet-400/[0.09] text-violet-300 border-l-4 border-violet-500',
  L:  'bg-white/[0.03] text-zinc-600 border-l-4 border-transparent',
  CO: 'bg-red-400/[0.09] text-red-300 border-l-4 border-red-500',
  CM: 'bg-pink-400/[0.09] text-pink-300 border-l-4 border-pink-500',
  AN: 'bg-zinc-500/[0.12] text-zinc-300 border-l-4 border-zinc-500',
  Z:  'bg-orange-400/[0.09] text-orange-300 border-l-4 border-orange-400',
  N:  'bg-violet-400/[0.09] text-violet-300 border-l-4 border-violet-500',
  B:  'bg-white/[0.04] text-zinc-400 border-l-4 border-zinc-600',   // Birou L-V
  R:  'bg-teal-400/[0.09] text-teal-300 border-l-4 border-teal-500', // Runner activ
  PLO: 'bg-blue-400/[0.09] text-blue-300 border-l-4 border-blue-500 animate-pulse', // Runner plecat la PLO (criza)
  DISP: 'bg-amber-400/[0.09] text-amber-300 border-l-4 border-amber-500', // Runner disponibil ca suplinitor
};

// ─── Algoritm CTA — ciclu Z/N/L/L (4 zile) ───
const CICLU_CTA = ['Z','N','L','L'];

function getTuraCTA(d: Date, dataStartCiclu: string): string {
  const start = new Date(dataStartCiclu + 'T00:00:00');
  const pos = Math.floor((d.getTime() - start.getTime()) / 86400000);
  return CICLU_CTA[((pos % 4) + 4) % 4];
}

function isCTA(m: Angajat): boolean {
  return (m.locatieId ?? 1) === 2;
}

// Legenda CTA pentru afisare
const CTA_LEGENDA = [
  { cod: 'Z', label: 'Zi (07:00–19:00)',    cls: 'bg-amber-700/80 text-amber-50 border border-amber-400/60' },
  { cod: 'N', label: 'Noapte (19:00–07:00)', cls: 'bg-indigo-800/80 text-indigo-100 border border-indigo-400/60' },
  { cod: 'L', label: 'Liber',                cls: 'bg-white/[0.03] text-zinc-500 border border-transparent' },
  { cod: 'PLO', label: 'Plecat la PLO (criză)', cls: 'bg-blue-950/60 text-blue-300 border border-blue-500/40' },
  { cod: 'DISP', label: 'Disponibil ca suplinitor', cls: 'bg-amber-950/40 text-amber-300 border border-amber-500/30' },
];

// Stiluri pentru print
const PRINT_STYLES = `
@media print {
  body { background: white !important; color: black !important; font-family: Arial, sans-serif; }
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  .print-table { width: 100%; border-collapse: collapse; }
  .print-table th, .print-table td { border: 1px solid #ccc; padding: 6px 10px; text-align: center; font-size: 11px; }
  .print-table th { background: #0078d4; color: white; font-weight: bold; }
  .print-D { background: #dbeafe !important; color: #1e40af !important; font-weight: bold !important; }
  .print-S { background: #f3e8ff !important; color: #7e22ce !important; font-weight: bold !important; }
  .print-L { background: transparent !important; color: transparent !important; border: 1px solid #e5e7eb !important; }
  .print-CO { background: #fef2f2 !important; color: #dc2626 !important; font-weight: bold !important; }
  .print-CM { background: #fff7ed !important; color: #ea580c !important; font-weight: bold !important; }
  .print-AN { background: #fef2f2 !important; color: #b91c1c !important; font-weight: bold !important; }
  .print-header { margin-bottom: 16px; }
  .print-header h1 { font-size: 20px; font-weight: bold; color: #0078d4; }
  .print-header p { font-size: 12px; color: #666; }
  /* Sumar vizibil la print */
  .print-sumar { display: block !important; margin-top: 20px; }
  .print-sumar table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .print-sumar th { background: #0078d4 !important; color: white !important; padding: 6px 10px; border: 1px solid #ccc; font-weight: bold; }
  .print-sumar td { padding: 5px 10px; border: 1px solid #ccc; color: #111 !important; background: white !important; }
  .print-sumar tr:nth-child(even) td { background: #f8fafc !important; }
  @page { margin: 1.5cm; size: A4 landscape; }
}
`;

// ─── Mini calendar pop-up pentru alegerea unei date — arata ziua saptamanii vizual ───
// Randat prin portal + pozitie fixa, ca sa nu fie taiat de overflow-ul ferestrelor care-l contin.
function MiniDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(() => value ? parseD(value) : new Date());
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const updatePos = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Daca nu mai incape jos, il deschidem in sus
    const POP_H = 300;
    const deschideSus = r.bottom + POP_H > window.innerHeight && r.top > POP_H;
    setPos({
      top: deschideSus ? r.top - POP_H - 4 : r.bottom + 4,
      left: Math.min(r.left, window.innerWidth - 260),
    });
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const LUNI = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
  const ZILE_SCURT = ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'];
  const selDate = value ? parseD(value) : null;

  const startGrid = getMonday(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1));
  const zileGrid: Date[] = [];
  for (let i = 0; i < 42; i++) zileGrid.push(new Date(startGrid.getTime() + i * 86400000));

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)}
        className="w-full text-left bg-black/40 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-sky-500/50 hover:border-sky-500/30 transition-all flex items-center gap-1.5">
        <Calendar size={11} className="text-zinc-500 flex-shrink-0"/>
        {selDate ? `${fmtDate(selDate)} · ${ZILE_SCURT[(selDate.getDay()+6)%7]}` : <span className="text-zinc-500">Alege data</span>}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={popRef} style={{position:'fixed', top:pos.top, left:pos.left, zIndex:9999}}
          className="bg-[#1c1c1e] border border-white/10 rounded-xl p-3 shadow-2xl w-64" onClick={e=>e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth()-1, 1))}
              className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-md text-zinc-400"><ChevronLeft size={13}/></button>
            <span className="text-[12px] font-semibold text-zinc-200">{LUNI[viewMonth.getMonth()]} {viewMonth.getFullYear()}</span>
            <button type="button" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth()+1, 1))}
              className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-md text-zinc-400"><ChevronRight size={13}/></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {ZILE_SCURT.map((z,i) => (
              <div key={i} className={`text-center text-[9px] font-bold py-1 ${i>=5?'text-rose-400/70':'text-zinc-600'}`}>{z}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {zileGrid.map((d,i) => {
              const inMonth = d.getMonth() === viewMonth.getMonth();
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              const isSelected = selDate && fmtDateInput(d) === fmtDateInput(selDate);
              const isToday = fmtDateInput(d) === fmtDateInput(new Date());
              return (
                <button type="button" key={i}
                  onClick={() => { onChange(fmtDateInput(d)); setOpen(false); }}
                  title={`${ZILE_SCURT[(d.getDay()+6)%7]} · ${fmtDate(d)}`}
                  className={`text-center text-[10px] py-1.5 rounded-md transition-all
                    ${!inMonth ? 'text-zinc-700' : isWeekend ? 'text-rose-400/80' : 'text-zinc-300'}
                    ${isSelected ? 'bg-sky-600 text-white font-bold' : isToday ? 'border border-sky-500/50' : 'hover:bg-white/10'}`}>
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default function RotaFlow() {
  const router = useRouter();
  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/login');
    router.refresh();
  }, [router]);

  // ─── State — initial gol, populat din Supabase la montare ───
  const [echipa, setEchipaRaw] = useState<Angajat[]>([]);
  const [swapuri, setSwapuriRaw] = useState<Swap[]>([]);
  const [turaOverride, setTuraOverride] = useState<TuraOverride[]>([]);
  const [log, setLogRaw] = useState<LogEntry[]>([]);
  const [suplinitorActiv, setSuplinitorActivRaw] = useState<boolean>(false);
  const [seIncarca, setSeIncarca] = useState(true);
  const [eroareIncarcare, setEroareIncarcare] = useState<string | null>(null);

  const [coFormStart, setCoFormStart] = useState<Record<number, string>>({});
  const [coFormSaptamani, setCoFormSaptamani] = useState<Record<number, 1 | 2>>({});
  const [coFormEroare, setCoFormEroare] = useState<Record<number, string>>({});

  const [weekOffset, setWeekOffset] = useState(0);
  const [activeTab, setActiveTab] = useState<'rota'|'luna'|'stats'|'swap'|'log'>('rota');
  const [locatieActiva, setLocatieActiva] = useState<'PLO'|'CTA'>('PLO');
  const [runneriActivi, setRunneriActivi] = useState<Set<number>>(new Set());
  const [runnerDestinatie, setRunnerDestinatie] = useState<Record<number,string>>({});
  const [runnerPerioadaStart, setRunnerPerioadaStart] = useState<Record<number,string>>({});
  const [runnerPerioadaEnd, setRunnerPerioadaEnd] = useState<Record<number,string>>({});
  const [showCO, setShowCO] = useState(false);
  const [showMatrice, setShowMatrice] = useState(false);
  const [cautareMatrice, setCautareMatrice] = useState('');
  const [cautareCO, setCautareCO] = useState('');
  const [showUrgente, setShowUrgente] = useState(false);
  const [showConfigEchipa, setShowConfigEchipa] = useState(false);
  // Popup absenta rapida CTA
  const [absentaPopup, setAbsentaPopup] = useState<{
    angajat: Angajat;
    tip: 'CO'|'CM'|'AN'|null;
    dataStart: string;
    dataSfarsit: string;
    saptamani: 1|2;
    runnerId: number|null;
  } | null>(null);
  // Popup deplasare runner — text liber, per zi, doar pentru saptamana afisata
  const [deplasarePopup, setDeplasarePopup] = useState<{ angajat: Angajat; texte: Record<string,string> } | null>(null);
  // Note de predare tura — un rand per (angajat, zi)
  const [noteTura, setNoteTura] = useState<{id:string;angajat_id:string;data:string;text:string;creat_la:string}[]>([]);
  const [certificari, setCertificari] = useState<{id:string;angajat_id:string;nume_certificat:string;data_obtinere:string|null;data_expirare:string|null;note:string|null}[]>([]);
  const [showCertificari, setShowCertificari] = useState(false);
  const [showPersonal, setShowPersonal] = useState(false);
  const [personalMod, setPersonalMod] = useState<'lista'|'adauga'|'inlocuieste'>('lista');
  const [personalTarget, setPersonalTarget] = useState<Angajat|null>(null);
  const [personalForm, setPersonalForm] = useState({ nume: '', locatieId: 1, tip: 'fix', dataStartCiclu: '', creeazaCont: true });
  const [personalLoading, setPersonalLoading] = useState(false);
  const [personalRezultat, setPersonalRezultat] = useState<{email:string;parola:string;mesaj:string}|null>(null);
  const [certNouForm, setCertNouForm] = useState<Record<string,{nume:string;dataExpirare:string}>>({});
  const [cautareCert, setCautareCert] = useState('');
  const [showAnalizaTermenLung, setShowAnalizaTermenLung] = useState(false);
  const [analizaLunile, setAnalizaLunile] = useState(6);
  const [notaPopup, setNotaPopup] = useState<{ angajat: Angajat; dStr: string; text: string } | null>(null);
  // Selectie multipla — celuleSelectate = "angajatId_dataStr", pentru actiuni in masa
  const [modSelectieMultipla, setModSelectieMultipla] = useState(false);
  const [celuleSelectate, setCeluleSelectate] = useState<Set<string>>(new Set());
  // Runner asignat per concediu CTA: cheie = "angajatId_dataStart"
  const [runnerAsignat, setRunnerAsignat] = useState<Record<string, number|null>>({});
  // Stocheaza: runnerId → { dataStart, perioadaStart, perioadaSfarsit }
  const [runnerCicluOverride, setRunnerCicluOverride] = useState<Record<number, {dataStartCiclu: string; perioadaStart: string; perioadaSfarsit: string}>>({});
  const [dragSrc, setDragSrc] = useState<{angajatId: number; data: string; tura: string} | null>(null);
  const [dragOver, setDragOver] = useState<{angajatId: number; data: string} | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [showVerificare, setShowVerificare] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncOk, setSyncOk] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saveStep, setSaveStep] = useState<0|1>(0); // 0=normal, 1=confirmare
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [rezultateVerificare, setRezultateVerificare] = useState<{tip:'ok'|'warn'|'err'; mesaj: string}[]>([]);

  const verificaSaptamana = () => {
    const rezultate: {tip:'ok'|'warn'|'err'; mesaj: string}[] = [];
    const zile7 = Array.from({length:7},(_,i)=>new Date(weekStart.getTime()+i*86400000));

    displayEchipa.forEach(m => {
      if (m.id === 999) return; // suplinitorul nu are reguli proprii

      if (isCTA(m)) {
        // ── Reguli CTA: max 48h/sapt (4 ture × 12h), fara N→Z direct ──
        let turaPrev = '';
        for (let i = -1; i < 7; i++) {
          const d = new Date(weekStart.getTime()+i*86400000);
          const t = getTura(d,m,echipa,suplinitorFinal,swapuri,turaOverride,oreAcumulate);
          // N→Z direct interzis (ca S→D la PLO) — trebuie repaus minim 12h
          if (i >= 0 && turaPrev === 'N' && t.type === 'Z') {
            rezultate.push({tip:'err', mesaj:`${m.nume}: N→Z interzis pe ${fmtDate(d)} (repaus insuficient)`});
          }
          turaPrev = t.type;
        }
        const oreSapt = calcOreSaptamana(m, weekStart, echipa, suplinitorFinal, swapuri, turaOverride, oreAcumulate, runneriActivi, runnerCicluOverride);
        if (oreSapt > 48) {
          rezultate.push({tip:'err', mesaj:`${m.nume}: ${oreSapt}h în săptămâna curentă (limită legală 48h)`});
        }
        return; // skip regulile PLO
      }

      // ── Regula 1: S→D (doar PLO) ──
      let turaPrev = '';
      for (let i = -1; i < 7; i++) {
        const d = new Date(weekStart.getTime()+i*86400000);
        const t = getTura(d,m,echipa,suplinitorFinal,swapuri,turaOverride,oreAcumulate);
        if (i >= 0 && turaPrev === 'S' && t.type === 'D') {
          rezultate.push({tip:'err', mesaj:`${m.nume}: S→D interzis pe ${fmtDate(d)}`});
        }
        turaPrev = t.type;
      }

      // ── Regula 2: 48h în săptămâna curentă ──
      const oreSapt = calcOreSaptamana(m, weekStart, echipa, suplinitorFinal, swapuri, turaOverride, oreAcumulate, runneriActivi, runnerCicluOverride);
      if (oreSapt > 48) {
        rezultate.push({tip:'err', mesaj:`${m.nume}: ${oreSapt}h în săptămâna curentă (limită legală 48h)`});
      } else if (oreSapt > 40) {
        rezultate.push({tip:'warn', mesaj:`${m.nume}: ${oreSapt}h săptămâna asta (peste 40h normal)`});
      }

      // ── Regula 3: 48h în orice fereastră de 7 zile consecutive ──
      // Verificăm 3 zile înainte + săptămâna curentă
      for (let start = -3; start <= 0; start++) {
        const dStart = new Date(weekStart.getTime()+start*86400000);
        let ore7 = 0;
        for (let j = 0; j < 7; j++) {
          const d = new Date(dStart.getTime()+j*86400000);
          const t = getTura(d,m,echipa,suplinitorFinal,swapuri,turaOverride,oreAcumulate);
          if (t.type==='D'||t.type==='S') ore7+=8;
        }
        if (ore7 > 48) {
          rezultate.push({tip:'err', mesaj:`${m.nume}: ${ore7}h în fereastra 7 zile din ${fmtDate(dStart)}`});
          break; // o singura eroare per angajat
        }
      }

      // ── Regula 4: zile consecutive fără pauză ──
      let consec = 0;
      let consecMax = 0;
      let consecStart: Date | null = null;
      for (let i = -6; i < 7; i++) {
        const d = new Date(weekStart.getTime()+i*86400000);
        const t = getTura(d,m,echipa,suplinitorFinal,swapuri,turaOverride,oreAcumulate);
        if (t.type==='D'||t.type==='S') {
          if (consec===0) consecStart=d;
          consec++;
          if (consec>consecMax) consecMax=consec;
        } else {
          consec=0;
        }
      }
      if (consecMax > 6) {
        rezultate.push({tip:'err', mesaj:`${m.nume}: ${consecMax} zile consecutive fără pauză (max 6)`});
      } else if (consecMax === 6) {
        rezultate.push({tip:'warn', mesaj:`${m.nume}: 6 zile consecutive (la limită)`});
      }

      // ── Regula 5: ore lunare ──
      const luna = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
      const lunaEnd = new Date(weekStart.getFullYear(), weekStart.getMonth()+1, 0);
      let oreLuna = 0;
      for (let d = new Date(luna); d <= lunaEnd; d=new Date(d.getTime()+86400000)) {
        const t = getTura(d,m,echipa,suplinitorFinal,swapuri,turaOverride,oreAcumulate);
        if (t.type==='D'||t.type==='S') oreLuna+=8;
      }
      const zileLucratoare = (() => {
        let zl=0;
        for (let d=new Date(luna); d<=lunaEnd; d=new Date(d.getTime()+86400000)) {
          const wd=d.getDay(); if(wd!==0&&wd!==6) zl++;
        }
        return zl;
      })();
      const oreNormalaLuna = zileLucratoare * 8;
      if (oreLuna > oreNormalaLuna + 24) {
        rezultate.push({tip:'warn', mesaj:`${m.nume}: ${oreLuna}h luna asta (normal ${oreNormalaLuna}h, +${oreLuna-oreNormalaLuna}h)`});
      }
    });

    // ── Regula 6: acoperire zilnica — 2D+1S (PLO) sau 1Z+1N (CTA) ──
    zile7.forEach(d => {
      const echipaNormala = displayEchipa.filter(m => m.id !== 999);
      // Folosim getTuraW care stie de runnerCicluOverride si runneri
      const ture = echipaNormala.map(m => getTuraW(d, m).type);
      const dStr = fmtDateInput(d);
      const ziLabel = ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'][d.getDay()===0?6:d.getDay()-1];

      if (locatieActiva === 'CTA') {
        // Regula CTA: 1Z + 1N obligatoriu
        const nZ = ture.filter(t => t==='Z').length;
        const nN = ture.filter(t => t==='N').length;
        if (nZ < 1 || nN < 1) {
          rezultate.push({
            tip:'err',
            mesaj:`${fmtDate(d)} (${ziLabel}): ${nZ}Z+${nN}N — necesar minim 1Z+1N`
          });
        }
      } else {
        // Regula PLO: 2D + 1S obligatoriu
        const nD = ture.filter(t => t==='D').length;
        const nS = ture.filter(t => t==='S').length;
        const areSuplinitorAzi = turaOverride.some(o =>
          o.id.startsWith('criza_SUP_') && o.data === dStr && parseD(o.expiraLa) > d
        );
        if (!areSuplinitorAzi && (nD < 2 || nS < 1)) {
          rezultate.push({
            tip:'err',
            mesaj:`${fmtDate(d)} (${ziLabel}): ${nD}D+${nS}S — necesar minim 2D+1S`
          });
        }
      }
    });

    if (rezultate.length === 0) {
      rezultate.push({tip:'ok', mesaj:'✓ Toate regulile sunt respectate pentru săptămâna afișată!'});
    }

    setRezultateVerificare(rezultate);
    setShowVerificare(true);
  };
  const [showPlanCriza, setShowPlanCriza] = useState(false);
  const [planCriza, setPlanCriza] = useState<PlanCriza | null>(null);
  const [planCrizaStart, setPlanCrizaStart] = useState(fmtDateInput(new Date()));
  const [modCrizaPerioada, setModCrizaPerioada] = useState<'auto' | 'manual'>('auto');
  const [planCrizaEnd, setPlanCrizaEnd] = useState('');
  const [planCrizaIssues, setPlanCrizaIssues] = useState<ConformitateIssue[]>([]);
  const [planCrizaSimConcedii, setPlanCrizaSimConcedii] = useState<SimConcediu[]>([]);
  const [vizitatorId, setVizitatorId] = useState<number>(999); // 999 = Suplinitor generic; altfel, id-ul unui runner CTA real
  const [crizaAplicataInterval, setCrizaAplicataInterval] = useState<{start: string; end: string} | null>(null);
  const [editIdx, setEditIdx] = useState<number|null>(null);
  const [tempNume, setTempNume] = useState('');
  const [urgTip, setUrgTip] = useState<'CM'|'AN'>('CM');
  const [urgTargetIdx, setUrgTargetIdx] = useState(0);
  const [urgStart, setUrgStart] = useState(fmtDateInput(new Date()));
  const [urgZile, setUrgZile] = useState(7);
  const [swAId, setSwAId] = useState(0);
  const [swAData, setSwAData] = useState(fmtDateInput(new Date()));
  const [swBId, setSwBId] = useState(1);
  const [swBData, setSwBData] = useState(fmtDateInput(new Date()));
  const [swNota, setSwNota] = useState('');
  const [lunaOffset, setLunaOffset] = useState(0);
  const [showPdfPicker, setShowPdfPicker] = useState(false);
  const [showConformitatePicker, setShowConformitatePicker] = useState(false);
  const [showMeniuPrincipal, setShowMeniuPrincipal] = useState(false);
  const [conformitateStart, setConformitateStart] = useState(() => fmtDateInput(new Date(Date.now() - 90*86400000)));
  const [conformitateEnd, setConformitateEnd] = useState(() => fmtDateInput(new Date()));
  const [pdfLunaDate, setPdfLunaDate] = useState(() => {
    const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  });

  const [echitatePerioada, setEchitatePerioada] = useState<'luna'|'trimestru'|'an'|'custom'>('an');
  const [echitateCustomStart, setEchitateCustomStart] = useState(fmtDateInput(new Date(new Date().getFullYear(),0,1)));
  const [echitateCustomEnd, setEchitateCustomEnd] = useState(fmtDateInput(new Date()));

  // ─── Simulare Concedii ───
  const [showSimulare, setShowSimulare] = useState(false);
  const [simConcedii, setSimConcedii] = useState<SimConcediu[]>([]);
  const [simSuplinitor, setSimSuplinitor] = useState(false);
  const [simTargetIdx, setSimTargetIdx] = useState(0);
  const [simStart, setSimStart] = useState(fmtDateInput(new Date()));
  const [simZile, setSimZile] = useState(6);
  const [simWeekOffset, setSimWeekOffset] = useState(0);
  const [simIssues, setSimIssues] = useState<ConformitateIssue[]>([]);
  const [simPendingAction, setSimPendingAction] = useState<'add'|null>(null);
  const [simPendingPayload, setSimPendingPayload] = useState<SimConcediu|null>(null);

  // ─── Incarcare initiala din Supabase ───
  const incarcaTotul = useCallback(async () => {
    try {
      setEroareIncarcare(null);
      const { angajati: sbAngajati, concedii: sbConcedii, absente: sbAbsente, swapuri: sbSwapuri, istoric: sbIstoric, setari } = await fetchToateDatele();

      const echipaAdaptata = adapteazaDateDinSupabase(sbAngajati, sbConcedii, sbAbsente);
      setEchipaRaw(echipaAdaptata);

      const uuidToId = new Map(sbAngajati.filter(a => !a.este_sef).map(a => [a.id, a.pozitie_rotatie]));
      const swapuriAdaptate: Swap[] = sbSwapuri
        .filter(s => s.status === 'aprobat')
        .map(s => ({
          id: s.id,
          aId: uuidToId.get(s.solicitant_id) ?? 0,
          aData: s.solicitant_data,
          bId: uuidToId.get(s.partener_id) ?? 0,
          bData: s.partener_data,
          nota: s.nota ?? '',
        }));
      setSwapuriRaw(swapuriAdaptate);

      // Note de predare tura — ultimele 30 de zile
      const acum30zile = fmtDateInput(new Date(Date.now() - 30*86400000));
      fetch(`/api/note-tura?de=${acum30zile}`).then(r=>r.ok?r.json():null).then(json => { if (json?.note) setNoteTura(json.note); }).catch(()=>{});

      // Certificari / calificari
      fetch('/api/certificari').then(r=>r.ok?r.json():null).then(json => { if (json?.certificari) setCertificari(json.certificari); }).catch(()=>{});

      // Alocari de runner (cine acopera pe cine) — persistente, ca sa supravietuiasca unui refresh
      fetch('/api/runner-alocari').then(r=>r.ok?r.json():null).then(json => {
        if (!json?.alocari) return;
        const noulOverride: Record<number, {dataStartCiclu:string;perioadaStart:string;perioadaSfarsit:string}> = {};
        const noulAsignat: Record<string, number> = {};
        for (const a of json.alocari) {
          noulOverride[a.runner_pozitie] = { dataStartCiclu: a.data_start_ciclu, perioadaStart: a.perioada_start, perioadaSfarsit: a.perioada_sfarsit };
          noulAsignat[`${a.angajat_acoperit_pozitie}_${a.perioada_start}`] = a.runner_pozitie;
        }
        setRunnerCicluOverride(noulOverride);
        setRunnerAsignat(noulAsignat);
      }).catch(()=>{});

      const logAdaptat: LogEntry[] = sbIstoric.map(l => ({
        ts: new Date(l.created_at).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) + ' ' + new Date(l.created_at).toLocaleTimeString('ro-RO', { hour:'2-digit', minute:'2-digit' }),
        msg: l.mesaj,
      }));
      setLogRaw(logAdaptat);

      setSuplinitorActivRaw(setari?.suplinitor_activ ?? false);

      // (fostul set de sloturi alocate global a fost eliminat — validarea de suprapunere
      // se face acum dinamic, per locatie, la adaugarea fiecarui concediu)
    } catch (err) {
      console.error('Eroare la incarcarea datelor din Supabase:', err);
      setEroareIncarcare('Nu am putut incarca datele. Verifica conexiunea si reincarca pagina.');
    } finally {
      setSeIncarca(false);
    }
  }, []);

  useEffect(() => { incarcaTotul(); }, [incarcaTotul]);

  // ─── Wrappers — scriu direct in Supabase, apoi reincarca starea ───
  const addLog = useCallback((msg: string) => {
    const entry: LogEntry = { ts: fmtTs(new Date()), msg };
    setLogRaw(prev => [entry, ...prev].slice(0, 100));
    apiAdaugaIstoric(msg).catch(() => {});
  }, []);

  // setEchipa ramane pentru compatibilitate cu codul existent (actualizeaza UI optimist),
  // dar persistarea reala se face punctual in fiecare handler (vezi mai jos)
  const setEchipa = useCallback((fn: (prev: Angajat[]) => Angajat[]) => {
    setEchipaRaw(prev => fn(prev));
  }, []);

  const setSwapuri = useCallback((fn: (prev: Swap[]) => Swap[]) => {
    setSwapuriRaw(prev => fn(prev));
  }, []);

  const setSuplinitorActiv = useCallback((val: boolean | ((p: boolean) => boolean)) => {
    setSuplinitorActivRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      apiSetSuplinitor(next).catch(() => {});
      return next;
    });
  }, []);

  // ─── Calcule ───
  const weekStart = useMemo(() => {
    const base = getMonday(new Date()); const r = new Date(base);
    r.setDate(r.getDate()+weekOffset*7); return r;
  }, [weekOffset]);

  const days = useMemo(() => Array.from({length:7},(_,i)=>new Date(weekStart.getTime()+i*86400000)), [weekStart]);

  const lunaStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + lunaOffset, 1);
  }, [lunaOffset]);

  const simWeekStart = useMemo(() => {
    const base = getMonday(new Date()); const r = new Date(base);
    r.setDate(r.getDate()+simWeekOffset*7); return r;
  }, [simWeekOffset]);
  const simDays = useMemo(() => Array.from({length:7},(_,i)=>new Date(simWeekStart.getTime()+i*86400000)), [simWeekStart]);

  // Auto-activare suplinitor — fie din CM lung (>7 zile), fie cand orice zi din saptamana
  // curenta sau urmatoarele 2 saptamani ar ramane cu sub 3 activi (CO simultan, AN, etc.)
  // Verificarea de "activi" se face STRICT fara suplinitor, ca sa nu existe dependenta circulara.
  const suplinitorAutoActiv = useMemo(() => {
    // Auto-activare DOAR daca exista CM lung (>7 zile) SAU
    // daca in zilele ACOPERITE DE UN CO REAL raman sub 3 activi.
    // NU verificam zile fara concedii active — altfel suplinitorul apare permanent.
    const dinCM = echipa.some(m => m.absente.some(a => a.tip==='CM'&&a.zile>7));
    if (dinCM) return true;

    // Colectam toate zilele acoperite de vreun CO real din echipa
    const zileCO = new Set<string>();
    echipa.forEach(m => m.concedii.forEach(c => {
      let d = parseD(c.s);
      const e = parseD(c.e);
      while (d <= e) { zileCO.add(fmtDateInput(d)); d = new Date(d.getTime()+86400000); }
    }));

    // Verificam doar acele zile
    for (const dataStr of zileCO) {
      const d = parseD(dataStr);
      const activiFaraSuplinitor = echipa.filter(a => !inCO(d,a) && !inAbsenta(d,a,'any'));
      if (activiFaraSuplinitor.length < 3) return true;
    }
    return false;
  }, [echipa]);
  const suplinitorFinal = suplinitorActiv || suplinitorAutoActiv;
  const modeAvarie = useMemo(() => echipa.some(m => days.some(d => inAbsenta(d,m,'CM'))), [echipa,days]);

  const oreAcumulate = useMemo((): Record<number, number> => {
    const perioadaStart = new Date(2026, 5, 1); // 1 Iunie
    let perioadaEnd = new Date(weekStart.getTime() - 86400000);
    if (perioadaEnd < perioadaStart) return {};
    // Limita de siguranta — fara asta, o navigare departe in calendar sau o data
    // aleasa foarte indepartata poate face bucla de mai jos sa faca sute de mii
    // de iteratii sincron si sa inghete interfata. 730 zile (~2 ani) e generos
    // pentru orice utilizare reala si suficient pentru planificare pe termen lung.
    const MAX_ZILE = 730;
    const perioadaEndMax = new Date(perioadaStart.getTime() + MAX_ZILE * 86400000);
    if (perioadaEnd > perioadaEndMax) perioadaEnd = perioadaEndMax;
    const ore: Record<number, number> = {};
    echipa.forEach(m => { ore[m.id] = 0; });

    for (let d = new Date(perioadaStart); d <= perioadaEnd; d = new Date(d.getTime()+86400000)) {
      // CTA fix — calculeaza ore direct din ciclu
      echipa.filter(m => isCTA(m) && m.tip!=='runner' && m.dataStartCiclu).forEach(m => {
        const tura = getTuraCTA(d, m.dataStartCiclu!);
        if (tura === 'Z' || tura === 'N') ore[m.id] = (ore[m.id]||0) + 12;
      });

      // PLO — logica existenta de echitate
      const activiPLO = echipa.filter(m => (m.locatieId??1)===1 && !inCO(d, m) && !inAbsenta(d, m, 'any'));
      const n = activiPLO.length;
      if (n === 0) continue;
      const activiSortati = n >= 4
        ? [...activiPLO].sort((a,b) => (ore[a.id]||0) - (ore[b.id]||0))
        : activiPLO;
      const dayIdx = Math.floor((d.getTime() - new Date(2026,0,1).getTime()) / 86400000);
      activiSortati.forEach((m, idx) => {
        const sec = ((dayIdx + idx) % n + n) % n;
        if (sec <= 2) ore[m.id] = (ore[m.id]||0) + 8;
      });
    }

    // Compensare graduala post-criza pe 30 de zile
    // Detectam sfarsitul ultimei perioade de criza (cand echipa revine la 4+ activi)
    const ZILE_COMP = 30;
    let sfarsitCriza: Date | null = null;
    for (let d = new Date(perioadaStart); d <= perioadaEnd; d = new Date(d.getTime()+86400000)) {
      const activiAzi = echipa.filter(m => !inCO(d, m) && !inAbsenta(d, m, 'any'));
      const activiIeri = echipa.filter(m => !inCO(new Date(d.getTime()-86400000), m) && !inAbsenta(new Date(d.getTime()-86400000), m, 'any'));
      // Tranzitie: ieri < 4 activi, azi >= 4 activi → sfarsit criza
      if (activiIeri.length < 4 && activiAzi.length >= 4) {
        sfarsitCriza = new Date(d);
      }
    }

    if (sfarsitCriza) {
      const ziuaAzi = perioadaEnd;
      const zileTrecute = Math.floor((ziuaAzi.getTime() - sfarsitCriza.getTime()) / 86400000);

      if (zileTrecute < ZILE_COMP) {
        // Suntem in fereastra de compensare
        const factor = 1 - zileTrecute / ZILE_COMP; // 1.0 → 0.0
        const media = Object.values(ore).reduce((s,v) => s+v, 0) / echipa.length;
        const oreAjustate: Record<number, number> = {};
        echipa.forEach(m => {
          const datorie = Math.max(0, media - ore[m.id]);
          // Adaugam artificial ore celor cu datorie, proportional cu factorul
          oreAjustate[m.id] = ore[m.id] + datorie * factor;
        });
        return oreAjustate;
      }
    }

    return ore;
  }, [echipa, weekStart]);

  // getTuraW foloseste echipa filtrata per locatie pentru calcul rotatie corect
  const sincronizeazaDB = useCallback(async () => {
    setSyncLoading(true); setSyncOk(false); setSyncError(null);
    try {
      const azi = new Date(); azi.setHours(0,0,0,0);
      // Calculam zilele pana la 31 Martie anul viitor (garantat acopera tot anul curent)
      const sfarsitPerioadei = new Date(azi.getFullYear() + 1, 2, 31);
      const zileTotale = Math.ceil((sfarsitPerioadei.getTime() - azi.getTime()) / 86400000) + 7;
      const tureCalculate: Array<{angajat_id: number; data: string; tura: string; locatie_id: number}> = [];
      for (let i = -7; i < zileTotale; i++) {
        const d = new Date(azi.getTime() + i * 86400000);
        const dStr = fmtDateInput(d);
        echipa.forEach(m => {
          const t = getTuraW(d, m);
          // Normalizam tipul pentru ture_mirror
          const turaNormalizata = t.type === 'R' ? 'Z' : t.type === 'B' ? 'L' : t.type;
          tureCalculate.push({ angajat_id: m.id, data: dStr, tura: turaNormalizata, locatie_id: m.locatieId ?? 1 });
        });
      }
      addLog(`Trimit ${tureCalculate.length} ture în baza de date...`);
      const res = await fetch('/api/sync-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ture: tureCalculate,
          notificare: { titlu: 'sync', mesaj: 'sync', tip: 'program' },
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const mesajEroare = `Eroare la sincronizare: ${json.error || res.status}`;
        addLog(`✗ ${mesajEroare}`);
        setSyncError(mesajEroare);
        setSyncLoading(false); return;
      }
      addLog(`✓ Sincronizat — ${tureCalculate.length} ture pentru ${echipa.length} angajați, până la ${fmtDate(sfarsitPerioadei)}.`);
      setSyncOk(true);
      setTimeout(() => setSyncOk(false), 3000);
    } catch(e: any) {
      const mesajEroare = `Sincronizarea a eșuat: ${e?.message || 'verifică conexiunea la internet'}`;
      addLog(`✗ ${mesajEroare}`);
      setSyncError(mesajEroare);
    }
    setSyncLoading(false);
  }, [echipa, suplinitorFinal, swapuri, turaOverride, oreAcumulate, weekStart, addLog]);

  const salveazaModificari = useCallback(async () => {
    setSaveLoading(true); setSaveOk(false); setSaveStep(0);
    try {
      const azi = new Date().toISOString().split('T')[0];
      // Luam doar override-urile manuale (drag_) care nu au expirat
      const overrideManuale = turaOverride
        .filter(o => o.id.startsWith('drag_') && o.expiraLa >= azi)
        .map(o => {
          const angajatOv = echipa.find(m => m.id === o.angajatId);
          return {
            id: o.id,
            angajat_id: o.angajatId,
            data: o.data,
            tura: o.tura,
            // Expira peste 1 an — nu se mai pierd dupa 7 zile
            expira_la: new Date(new Date(o.data).getTime() + 365*86400000).toISOString().split('T')[0],
            tip: 'manual',
            locatie_id: angajatOv?.locatieId ?? 1,
          };
        });

      const res = await fetch('/api/sync-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: overrideManuale }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Eroare server');

      // Actualizam si expiraLa local ca sa nu expire dupa 7 zile
      setTuraOverride(prev => prev.map(o =>
        o.id.startsWith('drag_')
          ? { ...o, expiraLa: new Date(new Date(o.data).getTime() + 365*86400000).toISOString().split('T')[0] }
          : o
      ));

      addLog(`✓ Modificari salvate — ${overrideManuale.length} ture salvate permanent`);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 4000);
    } catch(e: any) {
      addLog(`✗ Eroare salvare: ${e?.message || 'necunoscuta'}`);
    }
    setSaveLoading(false);
  }, [turaOverride, echipa, addLog]);
  const alerteOre = useMemo(() => {
    const echipaLocatie = echipa.filter(m => locatieActiva==='PLO' ? (m.locatieId??1)===1 : (m.locatieId??1)===2);
    return echipaLocatie.filter(m => calcOreSaptamana(m, weekStart, echipa, suplinitorFinal, swapuri, turaOverride, oreAcumulate, runneriActivi, runnerCicluOverride) > 48).map(m => m.nume);
  }, [echipa, weekStart, suplinitorFinal, swapuri, locatieActiva, runneriActivi, runnerCicluOverride]);

  // Detecteaza daca exista override-uri de criza active (planul de criza e aplicat)
  const crizaActiva = useMemo(() => {
    const azi = new Date(); azi.setHours(0,0,0,0);
    return turaOverride.some(o => o.id.startsWith('criza_') && parseD(o.expiraLa) > azi);
  }, [turaOverride]);

  // Alerta personal insuficient — per locatie
  const alertePersonalInsuficient = useMemo(() => {
    const rezultate: { zi: Date; totalActivi: number; criticChiarCuSuplinitor: boolean }[] = [];
    if (locatieActiva === 'CTA') {
      const echipaCTAfix = echipa.filter(m => (m.locatieId??1)===2 && m.tip!=='runner' && m.dataStartCiclu);
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart.getTime() + i * 86400000);
        const activiCTA = echipaCTAfix.filter(a => !inCO(d,a) && !inAbsenta(d,a,'any'));
        const nZ = activiCTA.filter(a => getTuraCTA(d, a.dataStartCiclu!) === 'Z').length;
        const nN = activiCTA.filter(a => getTuraCTA(d, a.dataStartCiclu!) === 'N').length;
        if (nZ < 1 || nN < 1) {
          rezultate.push({ zi: d, totalActivi: activiCTA.length, criticChiarCuSuplinitor: false });
        }
      }
    } else {
      // Scanam 90 de zile inainte (nu doar saptamana curent afisata), ca sa detectam
      // proactiv orice criza viitoare, indiferent pe ce saptamana te uiti in calendar.
      const echipaPLOonly = echipa.filter(m => (m.locatieId??1)===1);
      const azi = new Date(); azi.setHours(0,0,0,0);
      for (let i = 0; i < 90; i++) {
        const d = new Date(azi.getTime() + i * 86400000);
        const activiReali = echipaPLOonly.filter(a => !inCO(d,a) && !inAbsenta(d,a,'any'));
        // Suplinitorul/runner-ul vine acum DOAR Duminica — nu mai acopera zilele
        // lucratoare, deci nu mai adaugam +1 la numarul de activi reali.
        const totalActivi = activiReali.length;
        if (totalActivi < 4) {
          rezultate.push({ zi: d, totalActivi, criticChiarCuSuplinitor: false });
        }
      }
    }
    return rezultate;
  }, [echipa, weekStart, locatieActiva]);

  // Detectare dedicata PLO pentru Planul de Criza — MEREU calculata, indiferent
  // pe ce tab esti (PLO sau CTA), fiindca planul de criza e strict despre PLO si
  // nu trebuie sa depinda de care locatie e afisata curent pe ecran.
  const alertePersonalInsuficientPLO = useMemo(() => {
    const rezultate: { zi: Date; totalActivi: number; criticChiarCuSuplinitor: boolean }[] = [];
    const echipaPLOonly = echipa.filter(m => (m.locatieId??1)===1);
    const azi = new Date(); azi.setHours(0,0,0,0);
    for (let i = 0; i < 90; i++) {
      const d = new Date(azi.getTime() + i * 86400000);
      const activiReali = echipaPLOonly.filter(a => !inCO(d,a) && !inAbsenta(d,a,'any'));
      const totalActivi = activiReali.length;
      if (totalActivi < 4) {
        rezultate.push({ zi: d, totalActivi, criticChiarCuSuplinitor: false });
      }
    }
    return rezultate;
  }, [echipa, suplinitorFinal]);

  // Aceeasi idee, mereu-calculata pentru CTA — independenta de tab, scaneaza
  // 90 de zile inainte, ca sa alimentam dashboard-ul unificat de criza.
  const alertePersonalInsuficientCTA = useMemo(() => {
    const rezultate: { zi: Date; totalActivi: number; criticChiarCuSuplinitor: boolean }[] = [];
    const echipaCTAfix = echipa.filter(m => (m.locatieId??1)===2 && m.tip!=='runner' && m.dataStartCiclu);
    const azi = new Date(); azi.setHours(0,0,0,0);
    for (let i = 0; i < 90; i++) {
      const d = new Date(azi.getTime() + i * 86400000);
      const activiCTA = echipaCTAfix.filter(a => !inCO(d,a) && !inAbsenta(d,a,'any'));
      const nZ = activiCTA.filter(a => getTuraCTA(d, a.dataStartCiclu!) === 'Z').length;
      const nN = activiCTA.filter(a => getTuraCTA(d, a.dataStartCiclu!) === 'N').length;
      if (nZ < 1 || nN < 1) {
        rezultate.push({ zi: d, totalActivi: activiCTA.length, criticChiarCuSuplinitor: false });
      }
    }
    return rezultate;
  }, [echipa]);

  // Grupam zilele consecutive de criza in intervale (data start -> data end),
  // ca sa afisam "3-17 octombrie" in loc de 15 zile listate individual.
  function grupeazaInIntervale(alerte: { zi: Date; totalActivi: number; criticChiarCuSuplinitor: boolean }[]) {
    if (alerte.length === 0) return [];
    const sortate = [...alerte].sort((a,b)=>a.zi.getTime()-b.zi.getTime());
    const intervale: { start: Date; end: Date; minActivi: number; critic: boolean }[] = [];
    let curent = { start: sortate[0].zi, end: sortate[0].zi, minActivi: sortate[0].totalActivi, critic: sortate[0].criticChiarCuSuplinitor };
    for (let i = 1; i < sortate.length; i++) {
      const zi = sortate[i];
      const ziAsteptata = new Date(curent.end.getTime() + 86400000);
      if (fmtDateInput(zi.zi) === fmtDateInput(ziAsteptata)) {
        curent.end = zi.zi;
        curent.minActivi = Math.min(curent.minActivi, zi.totalActivi);
        curent.critic = curent.critic || zi.criticChiarCuSuplinitor;
      } else {
        intervale.push(curent);
        curent = { start: zi.zi, end: zi.zi, minActivi: zi.totalActivi, critic: zi.criticChiarCuSuplinitor };
      }
    }
    intervale.push(curent);
    return intervale;
  }
  const intervaleCriza = useMemo(() => grupeazaInIntervale(alertePersonalInsuficient), [alertePersonalInsuficient]);
  // Versiunea mereu-PLO, folosita de Planul de Criza — independenta de tab-ul curent.
  const intervaleCrizaPLO = useMemo(() => grupeazaInIntervale(alertePersonalInsuficientPLO), [alertePersonalInsuficientPLO]);
  const intervaleCrizaCTA = useMemo(() => grupeazaInIntervale(alertePersonalInsuficientCTA), [alertePersonalInsuficientCTA]);

  // getTuraW — filtreaza echipa intern dupa locatie, suporta runneri
  // Array-uri STABILE (memoizate), refolosite intre apeluri — fara ele, un .filter()
  // nou de fiecare data face cache-ul din getTuraDegradatSigur inutil (cheie noua
  // la fiecare apel = cache miss garantat), exact cauza lag-ului.
  const echipaPLOStabil = useMemo(() => echipa.filter(a => (a.locatieId??1)===1 && a.tip!=='runner'), [echipa]);
  const echipaCTAFixStabil = useMemo(() => echipa.filter(a => (a.locatieId??1)===2 && a.tip!=='runner'), [echipa]);

  const getTuraW = useCallback((d: Date, m: Angajat) => {
    const dStr = fmtDateInput(d);

    // Runner cu ciclu override (asignat la CO) — preia ciclul angajatului absent
    if (isCTA(m) && m.tip==='runner' && runnerCicluOverride[m.id]) {
      const ov = runnerCicluOverride[m.id];
      if (dStr >= ov.perioadaStart && dStr <= ov.perioadaSfarsit) {
        const tura = getTuraCTA(d, ov.dataStartCiclu);
        return { type: tura, label: tura, swapped: false };
      }
    }

    // Runner — verificam intai override de criza (acoperire PLO), apoi drag_, apoi default birou
    if (isCTA(m) && m.tip==='runner') {
      const ovCriza = turaOverride.find(o=>o.id.startsWith('criza_')&&o.angajatId===m.id&&o.data===dStr&&parseD(o.expiraLa)>d);
      if (ovCriza) return { type:'PLO', label:`PLO (${ovCriza.tura})`, swapped:false };
      const ovManual = turaOverride.find(o=>o.id.startsWith('drag_')&&o.angajatId===m.id&&o.data===dStr);
      if (ovManual) {
        if (ovManual.id.startsWith('drag_deplasare_')) return { type:'B', label:ovManual.tura, swapped:false };
        return { type:ovManual.tura, label:ovManual.tura, swapped:false };
      }
      const isWE = d.getDay()===0||d.getDay()===6;
      if (isWE) return { type:'L', label:'L', swapped:false }; // Sa/Du = liber by default
      // Cand suplinitorul e activ la PLO, runnerii sunt natural rezerva disponibila —
      // semnal vizual clar in loc de "Birou" generic, chiar daca inca nu a fost ales
      // unul anume prin Planul de Criza.
      if (suplinitorFinal) return { type:'DISP', label:'DISP', swapped:false };
      return { type:'B', label:'B', swapped:false }; // L-V = birou by default
    }

    // Angajati fix CTA fara data_start_ciclu → L (nu intra in rotatia PLO)
    if (isCTA(m) && !m.dataStartCiclu) return { type:'L', label:'L', swapped:false };

    // Angajati fix CTA si PLO — folosim array-ul stabil (memoizat), per locatie
    const echipaFiltrata = (m.locatieId??1)===1 ? echipaPLOStabil : echipaCTAFixStabil;
    return getTura(d, m, echipaFiltrata, suplinitorFinal, swapuri, turaOverride, oreAcumulate);
  }, [echipa, echipaPLOStabil, echipaCTAFixStabil, suplinitorFinal, swapuri, turaOverride, oreAcumulate, runneriActivi, runnerCicluOverride]);

  const calcScor = useCallback((m: Angajat, refDate: Date) => {
    const yr=refDate.getFullYear(), mo=refDate.getMonth();
    const start=new Date(yr,mo,1), end=new Date(yr,mo+1,0);
    let ore=0,zile=0,sarbLucrate=0,zileCM=0,zileAN=0;
    // Ore per tipul EXACT al zilei — nu o singura valoare per persoana. Altfel un
    // runner care acopera ciclul CTA al unui coleg (Z/N, 12h) era numarat gresit
    // cu 8h, fiindca era exclus din categoria de 12h doar pentru ca e "runner".
    for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
      const t=getTuraW(new Date(d),m);
      const oreZi = t.type==='Z'||t.type==='N' ? 12 : (t.type==='D'||t.type==='S'||t.type==='R'||t.type==='PLO'||t.type==='B'||t.type==='DISP') ? 8 : 0;
      if(oreZi>0){ore+=oreZi;zile++;if(isSarbatoare(new Date(d)))sarbLucrate++;}
      else if(t.type==='CM') zileCM++;
      else if(t.type==='AN') zileAN++;
    }
    return {ore,zile,sarbLucrate,zileCM,zileAN,scor:ore+sarbLucrate*16-zileAN*40};
  }, [getTuraW]);

  // ─── Raport Echitate — calcul pe orice interval [start, end] inclusiv ───
  const calcEchitate = useCallback((m: Angajat, start: Date, end: Date) => {
    let ore=0, nopti=0, weekendZile=0, sarbatoriLucrate=0, ziueLucrate=0;
    const orePerTura = isCTA(m) && m.tip!=='runner' ? 12 : 8;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      const cur = new Date(d);
      const t = getTuraW(cur, m);
      const eMunca = t.type==='D'||t.type==='S'||t.type==='Z'||t.type==='N'||t.type==='R'||t.type==='B'||t.type==='PLO'||t.type==='DISP';
      if (eMunca) {
        ore += (t.type==='Z'||t.type==='N') ? orePerTura : 8;
        ziueLucrate++;
        if (t.type==='S'||t.type==='N') nopti++;
        const wd = cur.getDay();
        if (wd === 0 || wd === 6) weekendZile++;
        if (isSarbatoare(cur)) sarbatoriLucrate++;
      }
    }
    return { ore, nopti, weekendZile, sarbatoriLucrate, ziueLucrate };
  }, [getTuraW]);

  // ─── Prognoza ore suplimentare — verifica saptamanile viitoare pentru depasiri de 48h ───
  const prognozaOreSuplimentare = useCallback((saptamaniInainte: number = 6) => {
    const azi = getMonday(new Date());
    const rezultate: { angajat: string; saptamanaStart: Date; ore: number }[] = [];
    for (let s = 0; s < saptamaniInainte; s++) {
      const wkStart = new Date(azi.getTime() + s * 7 * 86400000);
      echipa.forEach(m => {
        const ore = calcOreSaptamana(m, wkStart, echipa, suplinitorFinal, swapuri, turaOverride, oreAcumulate, runneriActivi, runnerCicluOverride);
        if (ore > 48) {
          rezultate.push({ angajat: m.nume, saptamanaStart: wkStart, ore });
        }
      });
    }
    return rezultate;
  }, [echipa, suplinitorFinal, swapuri]);

  // Interval real de date pe baza selectiei de perioada pentru Raport Echitate
  // IMPORTANT: end nu poate depasi ziua de azi — un raport de echitate reflecta DOAR trecutul real
  const echitateInterval = useMemo(() => {
    const azi = new Date(); azi.setHours(23,59,59,999);
    const aziStartZi = new Date(); aziStartZi.setHours(0,0,0,0);
    if (echitatePerioada === 'luna') {
      const endLuna = new Date(azi.getFullYear(), azi.getMonth()+1, 0);
      return { start: new Date(azi.getFullYear(), azi.getMonth(), 1), end: endLuna < azi ? endLuna : aziStartZi };
    }
    if (echitatePerioada === 'trimestru') {
      const endLuna = new Date(azi.getFullYear(), azi.getMonth()+1, 0);
      return { start: new Date(azi.getFullYear(), azi.getMonth()-2, 1), end: endLuna < azi ? endLuna : aziStartZi };
    }
    if (echitatePerioada === 'an') {
      return { start: new Date(azi.getFullYear(), 0, 1), end: aziStartZi };
    }
    const customEnd = parseD(echitateCustomEnd);
    return { start: parseD(echitateCustomStart), end: customEnd < aziStartZi ? customEnd : aziStartZi };
  }, [echitatePerioada, echitateCustomStart, echitateCustomEnd]);

  // Statistici de echitate per angajat, pentru intervalul selectat
  const echitateDate = useMemo(() => {
    return echipa.map(m => ({ angajat: m, ...calcEchitate(m, echitateInterval.start, echitateInterval.end) }));
  }, [echipa, echitateInterval, calcEchitate]);

  // Prognoza orelor suplimentare pentru urmatoarele 6 saptamani
  const prognozaSuplimentare = useMemo(() => prognozaOreSuplimentare(6), [prognozaOreSuplimentare]);

  // ─── Handlers ───
  const adaugaConcediu = useCallback((pi: number, slot: {n:string;s:string;e:string}): string | null => {
    const angajatTarget = echipa[pi];
    if (!angajatTarget?.uuid) return 'Angajat invalid.';

    const dataS = parseD(slot.s), dataE = parseD(slot.e);
    const nrZileCalendaristice = Math.round((dataE.getTime() - dataS.getTime()) / 86400000) + 1;
    if (nrZileCalendaristice > 14) {
      return `Maxim 2 săptămâni (14 zile) consecutive — perioada aleasă are ${nrZileCalendaristice} zile.`;
    }
    if (nrZileCalendaristice < 1) {
      return 'Data de sfârșit trebuie să fie după data de start.';
    }

    // Suprapunere — blocam STRICT intre colegi din aceeasi locatie; locatii diferite nu au relevanta unele fata de altele
    const locatieTarget = angajatTarget.locatieId ?? 1;
    for (const coleg of echipa) {
      if (coleg.id === angajatTarget.id) continue;
      if ((coleg.locatieId ?? 1) !== locatieTarget) continue;
      const conflict = coleg.concedii.find(c => {
        const cs = parseD(c.s), ce = parseD(c.e);
        return dataS <= ce && dataE >= cs; // suprapunere de interval
      });
      if (conflict) {
        return `${coleg.nume} are deja concediu în perioada ${conflict.s} – ${conflict.e}, suprapusă cu asta (aceeași locație).`;
      }
    }

    const key=`${slot.s}__${slot.e}`;
    const zl=countZileLucratoareReale(slot.s,slot.e,angajatTarget);

    setEchipa(prev=>{
      const azi = fmtDateInput(new Date());
      const next=prev.map((m,i)=>i!==pi?m:{...m,concedii:[...m.concedii,slot],...scadeZileCO(m,zl,azi)});
      return next;
    });
    addLog(`CO adăugat: ${angajatTarget.nume} — ${slot.n}${zl<countZileLucratoare(slot.s,slot.e)?' (zile suprapuse excluse din cost)':''}`);

    apiAdaugaConcediu(angajatTarget.uuid, slot.s, slot.e, slot.n, zl).catch(err => {
      console.error('Eroare la salvarea CO in Supabase:', err);
      incarcaTotul(); // re-sincronizam daca a esuat scrierea
    });
    return null; // succes, fara eroare
  }, [setEchipa, addLog, echipa, incarcaTotul]);

  // ─── Aplica absenta CTA + runner automat ───
  // Salveaza textele de deplasare pentru runner-ul din deplasarePopup — doar pe
  // zilele unde omul e efectiv la Birou (sau are deja o deplasare acolo), ca sa
  // nu suprascriem niciodata o tura reala Z/N.
  // Salveaza (sau actualizeaza) nota de predare pentru un angajat, intr-o zi anume
  const adaugaAngajatNou = useCallback(async () => {
    setPersonalLoading(true);
    setPersonalRezultat(null);
    try {
      const res = await fetch('/api/personal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actiune: 'adauga', nume: personalForm.nume, locatie_id: personalForm.locatieId,
          tip: personalForm.tip, data_start_ciclu: personalForm.dataStartCiclu || null,
          creeaza_cont: personalForm.creeazaCont,
        }),
      });
      const json = await res.json();
      if (!res.ok) { alert(`Eroare: ${json.error}`); setPersonalLoading(false); return; }
      addLog(`Angajat nou: ${personalForm.nume} (${personalForm.locatieId===2?'CTA':'PLO'})`);
      setPersonalRezultat({
        email: json.credentiale?.email || '—', parola: json.credentiale?.parola || '—',
        mesaj: `${personalForm.nume} a fost adăugat cu succes.`,
      });
      incarcaTotul();
    } catch (err: any) {
      alert(`Eroare: ${err.message}`);
    }
    setPersonalLoading(false);
  }, [personalForm, addLog, incarcaTotul]);

  const inlocuiesteAngajat = useCallback(async () => {
    if (!personalTarget?.uuid) return;
    setPersonalLoading(true);
    setPersonalRezultat(null);
    try {
      const res = await fetch('/api/personal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actiune: 'inlocuieste', id_vechi: personalTarget.uuid,
          nume_nou: personalForm.nume, creeaza_cont: personalForm.creeazaCont,
        }),
      });
      const json = await res.json();
      if (!res.ok) { alert(`Eroare: ${json.error}`); setPersonalLoading(false); return; }
      addLog(`Înlocuire: ${personalTarget.nume} → ${personalForm.nume}, aceeași poziție în rotație`);
      setPersonalRezultat({
        email: json.credentiale?.email || '—', parola: json.credentiale?.parola || '—',
        mesaj: `${personalTarget.nume} a fost dezactivat, ${personalForm.nume} preia aceeași poziție din rotație.`,
      });
      incarcaTotul();
    } catch (err: any) {
      alert(`Eroare: ${err.message}`);
    }
    setPersonalLoading(false);
  }, [personalTarget, personalForm, addLog, incarcaTotul]);

  const dezactiveazaAngajat = useCallback(async (angajat: Angajat) => {
    if (!angajat.uuid) return;
    if (!confirm(`Sigur dezactivezi ${angajat.nume}? Rămâne în istoric, dar dispare din echipă și nu se mai poate loga.`)) return;
    try {
      const res = await fetch('/api/personal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actiune: 'dezactiveaza', id: angajat.uuid }),
      });
      const json = await res.json();
      if (!res.ok) { alert(`Eroare: ${json.error}`); return; }
      addLog(`Angajat dezactivat: ${angajat.nume}`);
      incarcaTotul();
    } catch (err: any) {
      alert(`Eroare: ${err.message}`);
    }
  }, [addLog, incarcaTotul]);

  const adaugaCertificat = useCallback(async (angajat: Angajat, nume: string, dataExpirare: string) => {
    if (!angajat.uuid || !nume.trim()) return;
    try {
      const res = await fetch('/api/certificari', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ angajat_id: angajat.uuid, nume_certificat: nume.trim(), data_expirare: dataExpirare || null }),
      });
      const json = await res.json();
      if (res.ok && json.certificat) {
        setCertificari(prev => [...prev, json.certificat]);
        addLog(`Certificat adăugat: ${angajat.nume} — ${nume.trim()}`);
        setCertNouForm(prev => ({ ...prev, [angajat.id]: { nume: '', dataExpirare: '' } }));
      } else {
        alert(`Nu am putut salva certificatul: ${json.error || 'eroare necunoscută'}`);
      }
    } catch (err) {
      console.error('Eroare adaugare certificat:', err);
    }
  }, [addLog]);

  const stergeCertificat = useCallback(async (id: string, label: string) => {
    if (!confirm(`Sigur vrei să ștergi certificatul "${label}"?`)) return;
    setCertificari(prev => prev.filter(c => c.id !== id));
    fetch(`/api/certificari?id=${id}`, { method: 'DELETE' }).catch(()=>{});
    addLog(`Certificat șters: ${label}`);
  }, [addLog]);

  const salveazaNota = useCallback(async (angajat: Angajat, dStr: string, text: string) => {
    if (!angajat.uuid) return;
    if (!text.trim()) {
      // text gol = stergem nota daca exista
      const existenta = noteTura.find(n => n.angajat_id === angajat.uuid && n.data === dStr);
      if (existenta) {
        setNoteTura(prev => prev.filter(n => n.id !== existenta.id));
        fetch(`/api/note-tura?id=${existenta.id}`, { method: 'DELETE' }).catch(()=>{});
      }
      setNotaPopup(null);
      return;
    }
    try {
      const res = await fetch('/api/note-tura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ angajat_id: angajat.uuid, data: dStr, text }),
      });
      const json = await res.json();
      if (res.ok && json.nota) {
        setNoteTura(prev => [json.nota, ...prev.filter(n => n.id !== json.nota.id)]);
        addLog(`Notă de predare: ${angajat.nume}, ${fmtDate(parseD(dStr))}`);
      }
    } catch (err) {
      console.error('Eroare salvare nota:', err);
    }
    setNotaPopup(null);
  }, [noteTura, addLog]);

  // Aplica un tip de tura pe toate celulele selectate deodata (actiune in masa)
  const aplicaInMasa = useCallback((tip: string) => {
    const expiraLa = fmtDateInput(new Date(Date.now() + 365 * 86400000));
    const noi: TuraOverride[] = Array.from(celuleSelectate).map(cheie => {
      const [idStr, dataStr] = cheie.split('_');
      return { id: `drag_${idStr}_${dataStr}`, angajatId: Number(idStr), data: dataStr, tura: tip, expiraLa };
    });
    setTuraOverride(prev => [...prev.filter(o => !noi.some(n => n.id === o.id)), ...noi]);
    addLog(`Aplicat "${tip}" pe ${celuleSelectate.size} celule selectate`);
    setCeluleSelectate(new Set());
  }, [celuleSelectate, addLog]);

  const stergeInMasa = useCallback(() => {
    const idsDeSters = new Set(Array.from(celuleSelectate).map(cheie => {
      const [idStr, dataStr] = cheie.split('_');
      return `drag_${idStr}_${dataStr}`;
    }));
    setTuraOverride(prev => prev.filter(o => !idsDeSters.has(o.id)));
    addLog(`Șterse override-urile pentru ${celuleSelectate.size} celule selectate`);
    setCeluleSelectate(new Set());
  }, [celuleSelectate, addLog]);

  const salveazaDeplasari = useCallback(() => {
    if (!deplasarePopup) return;
    const { angajat, texte } = deplasarePopup;
    const noi: TuraOverride[] = [];
    const deSters: string[] = [];
    days.forEach(d => {
      const dStr = fmtDateInput(d);
      const text = (texte[dStr] || '').trim();
      const idOv = `drag_deplasare_${angajat.id}_${dStr}`;
      const areDejaOverride = turaOverride.some(o => o.id === idOv);
      if (text) {
        const tActuala = getTuraW(d, angajat);
        if (tActuala.type !== 'B') return; // nu suprascriem o tura reala (Z/N/etc)
        noi.push({ id: idOv, angajatId: angajat.id, data: dStr, tura: text, expiraLa: fmtDateInput(new Date(d.getTime() + 365 * 86400000)) });
      } else if (areDejaOverride) {
        deSters.push(idOv);
      }
    });
    setTuraOverride(prev => [...prev.filter(o => !deSters.includes(o.id) && !noi.some(n => n.id === o.id)), ...noi]);
    addLog(`Deplasări actualizate: ${angajat.nume}`);
    setDeplasarePopup(null);
  }, [deplasarePopup, days, turaOverride, getTuraW, addLog]);

  // Alege automat cel mai potrivit runner sa acopere o absenta CTA: doar dintre cei
  // DISPONIBILI (nu sunt in CM/AN, nu acopera deja pe altcineva in aceeasi perioada),
  // pe cel cu cele mai PUTINE ore lucrate in ultimele 30 de zile (echitate).
  // Returneaza null daca nu exista niciun runner disponibil, sau daca oricum nu e nevoie
  // (acoperirea ramane 1Z+1N si fara runner).
  // Functie comuna de asignare + persistenta a unui runner care acopera un concediu —
  // folosita din AMBELE locuri unde se poate adauga un concediu CTA (popup rapid SI
  // fereastra Concedii), ca sa nu mai existe doua copii ale formulei care pot diverge.
  const asigneazaRunnerPentruConcediu = useCallback((
    angajat: Angajat, dataStart: string, dataSfarsit: string, runnerId: number, alesAutomat: boolean
  ) => {
    const ra = echipa.find(m => m.id === runnerId);
    if (!ra || !angajat.dataStartCiclu) return;
    const sf = new Date(dataSfarsit + 'T00:00:00');
    let sfE = new Date(sf);
    const dow = sf.getDay();
    // Extindere identica cu regula reala din inCO: Vineri extinde mereu spre Duminica.
    // Sambata extinde spre Duminica DOAR daca Vinerea dinainte e si ea acoperita de concediu.
    if (dow === 5) sfE = new Date(sf.getTime() + 2*86400000);
    else if (dow === 6) {
      const vineriDinainte = new Date(sf.getTime() - 86400000);
      if (vineriDinainte >= new Date(dataStart + 'T00:00:00')) sfE = new Date(sf.getTime() + 1*86400000);
    }
    const perioadaSfarsitFinal = fmtDateInput(sfE);
    setRunnerCicluOverride(prev => ({...prev, [runnerId]: {dataStartCiclu: angajat.dataStartCiclu!, perioadaStart: dataStart, perioadaSfarsit: perioadaSfarsitFinal}}));
    addLog(alesAutomat
      ? `Runner ${ra.nume} asignat AUTOMAT (cele mai puține ore) → acoperă ${angajat.nume} (${dataStart}–${perioadaSfarsitFinal})`
      : `Runner ${ra.nume} -> acopera ${angajat.nume} (${dataStart}–${perioadaSfarsitFinal})`);
    fetch('/api/runner-alocari', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runner_pozitie: runnerId, angajat_acoperit_pozitie: angajat.id, angajat_acoperit_uuid: angajat.uuid,
        data_start_ciclu: angajat.dataStartCiclu, perioada_start: dataStart, perioada_sfarsit: perioadaSfarsitFinal,
      }),
    }).catch(err => console.error('Eroare salvare alocare runner:', err));
  }, [echipa, addLog, setRunnerCicluOverride]);

  const gasesteRunnerAutomat = useCallback((
    angajatAbsent: Angajat, dataStart: string, dataSfarsit: string
  ): { runnerId: number | null; existaGol: boolean } => {
    if (!isCTA(angajatAbsent) || !angajatAbsent.dataStartCiclu) return { runnerId: null, existaGol: false };

    const fix = echipa.filter(m => isCTA(m) && m.tip !== 'runner' && m.id !== angajatAbsent.id);
    const runneri = echipa.filter(m => isCTA(m) && m.tip === 'runner');
    const start = parseD(dataStart), end = parseD(dataSfarsit);

    let existaGol = false;
    for (let d = new Date(start); d <= end; d = new Date(d.getTime()+86400000)) {
      const activi = fix.filter(m => !inCO(d,m) && !inAbsenta(d,m,'any'));
      const nZ = activi.filter(m => getTuraCTA(d, m.dataStartCiclu!) === 'Z').length;
      const nN = activi.filter(m => getTuraCTA(d, m.dataStartCiclu!) === 'N').length;
      if (nZ < 1 || nN < 1) { existaGol = true; break; }
    }
    if (!existaGol) return { runnerId: null, existaGol: false };

    const disponibili = runneri.filter(r => {
      for (let d = new Date(start); d <= end; d = new Date(d.getTime()+86400000)) {
        if (inAbsenta(d, r, 'any') || inCO(d, r)) return false;
      }
      const ocupatDeja = runnerCicluOverride[r.id];
      if (ocupatDeja) {
        const ocupatStart = parseD(ocupatDeja.perioadaStart), ocupatEnd = parseD(ocupatDeja.perioadaSfarsit);
        // Suprapunere directa cu perioada noua
        if (start <= ocupatEnd && end >= ocupatStart) return false;
        // SAU angajamentul lui vechi inca nu s-a incheiat (data de sfarsit e in viitor) —
        // il excludem oricum, ca sa nu-i "furam" acoperirea inainte sa apuce sa fie sincronizata.
        const azi = new Date(); azi.setHours(0,0,0,0);
        if (ocupatEnd >= azi) return false;
      }
      return true;
    });
    if (disponibili.length === 0) return { runnerId: null, existaGol: true };

    // Prudență suplimentară: nu folosim NICIODATĂ ultimul runner complet liber.
    // Păstrăm mereu cel puțin unul "în buzunar", pentru alte nevoi reale pe care
    // aplicația nu le vede (Craiova, nave etc). Doar dacă AMÂNDOI sunt liberi acum,
    // selecția automată poate folosi unul dintre ei — niciodată pe ultimul rămas.
    const runneriCompletLiberi = runneri.filter(r => {
      const ocupatDeja = runnerCicluOverride[r.id];
      if (!ocupatDeja) return true;
      const ocupatEnd = parseD(ocupatDeja.perioadaSfarsit);
      const azi0 = new Date(); azi0.setHours(0,0,0,0);
      return ocupatEnd < azi0; // liber doar daca angajamentul lui vechi s-a incheiat deja
    });
    if (runneriCompletLiberi.length <= 1) {
      return { runnerId: null, existaGol: true }; // pastram rezerva — nu asignam automat
    }

    const azi = new Date();
    const acum30zile = new Date(azi.getTime() - 30*86400000);
    let celMaiOdihnit: Angajat | null = null;
    let oreMinime = Infinity;
    for (const r of disponibili) {
      let ore = 0;
      for (let d = new Date(acum30zile); d <= azi; d = new Date(d.getTime()+86400000)) {
        const t = getTuraW(d, r);
        ore += (t.type==='Z'||t.type==='N') ? 12 : (['D','S','R','B','PLO','DISP'].includes(t.type) ? 8 : 0);
      }
      if (ore < oreMinime) { oreMinime = ore; celMaiOdihnit = r; }
    }
    return { runnerId: celMaiOdihnit?.id ?? null, existaGol: true };
  }, [echipa, getTuraW, runnerCicluOverride]);

  const aplicaAbsentaCTA = useCallback(async (
    angajat: Angajat,
    tip: 'CO'|'CM'|'AN',
    dataStart: string,
    dataSfarsit: string,
    runnerId: number|null
  ) => {
    const pi = echipa.findIndex(m => m.id === angajat.id);
    if (pi === -1) return;

    // Daca nu s-a ales manual un runner, incercam sa gasim automat unul potrivit —
    // doar daca chiar apare un gol de acoperire, si doar dintre cei disponibili.
    let runnerIdFinal = runnerId;
    let alesAutomat = false;
    let avertismentGolNeacoperit = false;
    if (runnerIdFinal === null && tip === 'CO') {
      const auto = gasesteRunnerAutomat(angajat, dataStart, dataSfarsit);
      if (auto.runnerId !== null) { runnerIdFinal = auto.runnerId; alesAutomat = true; }
      else if (auto.existaGol) { avertismentGolNeacoperit = true; }
    }

    if (tip === 'CO') {
      const numeSlot = `${fmtDate(parseD(dataStart))}–${fmtDate(parseD(dataSfarsit))}`;
      const eroare = adaugaConcediu(pi, { n: numeSlot, s: dataStart, e: dataSfarsit });
      if (eroare) { alert(eroare); return; }
    } else {
      const zile = Math.ceil((parseD(dataSfarsit).getTime() - parseD(dataStart).getTime()) / 86400000) + 1;
      setEchipa(prev => prev.map((m, i) => i !== pi ? m : {
        ...m, absente: [...m.absente, { startDate: dataStart, zile, tip, uuid: `local_${Date.now()}` }]
      }));
      addLog(`${tip} adaugat: ${angajat.nume} 2014 ${dataStart} (${zile} zile)`);
      if (angajat.uuid) apiAdaugaAbsenta(angajat.uuid, tip === 'CM' ? 'CM' : 'AN', dataStart, zile).catch(console.error);
    }

    if (runnerIdFinal !== null) {
      asigneazaRunnerPentruConcediu(angajat, dataStart, dataSfarsit, runnerIdFinal, alesAutomat);
    } else if (avertismentGolNeacoperit) {
      alert(`Atenție: ${angajat.nume} pleacă în concediu, dar niciun runner nu e disponibil automat să acopere golul (fie sunt ocupați/în CM-AN, fie păstrăm intenționat unul în rezervă — nu asignăm automat ultimul runner liber). Alege manual din Matrice dacă vrei să folosești rezerva.`);
    }
    setAbsentaPopup(null);
  }, [echipa, adaugaConcediu, addLog, setEchipa, gasesteRunnerAutomat, asigneazaRunnerPentruConcediu]);

  const stergeConcediu = useCallback((pi: number, ci: number) => {
    const angajatTarget = echipa[pi];
    const c = angajatTarget?.concedii[ci];
    if (!c) return;
    if (!confirm(`Sigur vrei să ștergi concediul lui ${angajatTarget.nume} (${c.n})? Nu poate fi anulat.`)) return;

    // Recalculam zilele de restaurat ca si cum acest concediu nu ar mai exista in lista
    // (evita restaurarea unor zile care erau oricum acoperite de CM/AN/alt CO)
    const angajatFaraAcestConcediu: Angajat = { ...angajatTarget, concedii: angajatTarget.concedii.filter((_,k)=>k!==ci) };
    const zl = countZileLucratoareReale(c.s, c.e, angajatFaraAcestConcediu);

    setEchipa(prev=>prev.map((m,i)=>i!==pi?m:{...m,zileCO:m.zileCO+zl,concedii:m.concedii.filter((_,k)=>k!==ci)}));
    addLog(`CO șters: ${angajatTarget.nume} — ${c.n}`);

    // IMPORTANT: daca un runner acoperea exact acest concediu, il eliberam automat —
    // altfel ramane "agatat" acolo, oglindind ciclul lui angajatTarget la infinit,
    // chiar dupa ce concediul care l-a declansat a disparut.
    const runnerIdLegat = runnerAsignat[`${angajatTarget.id}_${c.s}`];
    if (runnerIdLegat != null) {
      setRunnerCicluOverride(prev => { const n = {...prev}; delete n[runnerIdLegat]; return n; });
      setRunnerAsignat(prev => { const n = {...prev}; delete n[`${angajatTarget.id}_${c.s}`]; return n; });
      const numeRunner = echipa.find(r=>r.id===runnerIdLegat)?.nume ?? `#${runnerIdLegat}`;
      addLog(`Runner ${numeRunner} eliberat automat (concediul pe care-l acoperea a fost șters)`);
    }

    if (c.uuid) {
      apiStergeConcediu(c.uuid).catch(err => {
        console.error('Eroare la stergerea CO din Supabase:', err);
        incarcaTotul();
      });
    }
  }, [setEchipa, addLog, echipa, incarcaTotul, runnerAsignat]);


  const aplicaUrgenta = () => {
    const angajatTarget = echipa[urgTargetIdx];
    if (!angajatTarget?.uuid) return;

    // Daca perioada de CM/AN se suprapune cu zile deja marcate CO, restauram acele zile de CO
    // (CM/AN au prioritate peste CO; angajatul nu trebuie sa piarda zile de concediu nefolosite)
    let zileCORestaurate = 0;
    const urgEnd = new Date(parseD(urgStart).getTime() + (urgZile - 1) * 86400000);
    for (let d = parseD(urgStart); d <= urgEnd; d = new Date(d.getTime() + 86400000)) {
      const wd = d.getDay();
      if (wd > 0 && wd < 6 && !isSarbatoare(d) && inCO(d, angajatTarget)) zileCORestaurate++;
    }

    setEchipa(prev=>prev.map((m,i)=>i!==urgTargetIdx?m:{
      ...m,
      absente:[...m.absente,{startDate:urgStart,zile:urgZile,tip:urgTip}],
      zileCO: m.zileCO + zileCORestaurate,
    }));
    addLog(`${urgTip} adăugat: ${angajatTarget.nume} — ${urgStart} · ${urgZile}z${zileCORestaurate>0?` (${zileCORestaurate} zile CO restaurate, suprapuse cu concediu existent)`:''}`);
    setShowUrgente(false);

    apiAdaugaAbsenta(angajatTarget.uuid, urgTip, urgStart, urgZile).then(() => {
      if (zileCORestaurate > 0 && angajatTarget.uuid) {
        apiActualizeazaAngajat(angajatTarget.uuid, { zile_co: angajatTarget.zileCO + zileCORestaurate }).catch(() => {});
      }
    }).catch(err => {
      console.error('Eroare la salvarea absentei in Supabase:', err);
      incarcaTotul();
    });
  };

  const stergeAbsenta = (pi: number, ai: number) => {
    const angajatTarget = echipa[pi];
    const a = angajatTarget?.absente[ai];
    if (!a) return;
    if (!confirm(`Sigur vrei să ștergi ${a.tip}-ul lui ${angajatTarget.nume} din ${fmtDate(parseD(a.startDate))}? Nu poate fi anulat.`)) return;

    setEchipa(prev=>prev.map((m,i)=>i!==pi?m:{...m,absente:m.absente.filter((_,k)=>k!==ai)}));
    addLog(`${a.tip} șters: ${angajatTarget.nume}`);

    if (a.uuid) {
      fetch(`/api/absente?id=${a.uuid}`, { method: 'DELETE' }).catch(err => {
        console.error('Eroare la stergerea absentei din Supabase:', err);
        incarcaTotul();
      });
    }
  };

  const adaugaSwap = () => {
    if(swAId===swBId) return; // nu poti face swap cu tine insuti, indiferent de date
    const a=echipa.find(m=>m.id===swAId), b=echipa.find(m=>m.id===swBId);
    if (!a || !b) return;

    // Blocam swap-ul daca oricare din cele 2 zile NU e o tura reala de lucru (D/S) pentru
    // persoana care o cedeaza — un swap cu o zi libera/CO/CM/AN nu are acoperire reala,
    // lasa tura initiala fara nimeni la post.
    const turaA = isCTA(a) ? getTuraW(parseD(swAData), a) : {type: getTuraBaza(parseD(swAData), a, echipa, suplinitorFinal).type};
    const turaB = isCTA(b) ? getTuraW(parseD(swBData), b) : {type: getTuraBaza(parseD(swBData), b, echipa, suplinitorFinal).type};
    if (turaA.type!=='D' && turaA.type!=='S') {
      alert(`${a.nume} nu are tură de lucru (D/S) pe ${fmtDate(parseD(swAData))} — swap-ul nu poate fi creat, ar lăsa acea zi fără acoperire.`);
      return;
    }
    if (turaB.type!=='D' && turaB.type!=='S') {
      alert(`${b.nume} nu are tură de lucru (D/S) pe ${fmtDate(parseD(swBData))} — swap-ul nu poate fi creat, ar lăsa acea zi fără acoperire.`);
      return;
    }

    const nou: Swap = {id:Date.now().toString(),aId:swAId,aData:swAData,bId:swBId,bData:swBData,nota:swNota};
    setSwapuri(prev=>[...prev,nou]);
    addLog(`Swap: ${a?.nume} (${swAData}) ↔ ${b?.nume} (${swBData})${swNota?' — '+swNota:''}`);
    setSwNota('');

    if (a?.uuid && b?.uuid) {
      apiCreeazaSwap(a.uuid, swAData, b.uuid, swBData, swNota).then(res => {
        if (res.swap?.id) {
          setSwapuri(prev => prev.map(s => s.id === nou.id ? { ...s, id: res.swap.id } : s));
        }
      }).catch(err => {
        console.error('Eroare la salvarea swap-ului in Supabase:', err);
        incarcaTotul();
      });
    }
  };

  const stergeSwap = (id: string) => {
    const sw=swapuri.find(s=>s.id===id);
    const a=echipa.find(m=>m.id===sw?.aId), b=echipa.find(m=>m.id===sw?.bId);
    if (!confirm(`Sigur vrei să ștergi schimbul de tură ${a?.nume} ↔ ${b?.nume}? Nu poate fi anulat.`)) return;
    setSwapuri(prev=>prev.filter(s=>s.id!==id));
    addLog(`Swap șters: ${a?.nume} ↔ ${b?.nume}`);

    fetch(`/api/swap?id=${id}`, { method: 'DELETE' }).catch(err => {
      console.error('Eroare la stergerea swap-ului din Supabase:', err);
      incarcaTotul();
    });
  };

  const calcBalanta = (sw: Swap) => {
    const a=echipa.find(m=>m.id===sw.aId), b=echipa.find(m=>m.id===sw.bId);
    if(!a||!b) return {ok:true,text:''};
    const oreT=(t:{type:string})=>(t.type==='D'||t.type==='S'?8:0);
    const diff=oreT(getTuraBaza(parseD(sw.aData),a,echipa,suplinitorFinal))-oreT(getTuraBaza(parseD(sw.bData),b,echipa,suplinitorFinal));
    if(diff===0) return {ok:true,text:'Balanță echilibrată ✓'};
    return {ok:false,text:`${diff>0?b.nume:a.nume} datorează ${Math.abs(diff)}h`};
  };

  // ─── Simulare Concedii ───
  const verificaSiAdaugaSim = () => {
    const nou: SimConcediu = { id: Date.now().toString(), angajatId: echipa[simTargetIdx].id, start: simStart, zile: simZile };
    const concediiTestate = [...simConcedii, nou];
    const startCheck = parseD(simStart);
    const issues = analizeazaConformitate(echipa, concediiTestate, simSuplinitor, startCheck, simZile);

    if (issues.length > 0) {
      setSimIssues(issues);
      setSimPendingAction('add');
      setSimPendingPayload(nou);

      // Daca sunt probleme de personal insuficient, generam automat planul de criza
      const arePutiniOameni = issues.some(i => i.tip === 'PUTINI_OAMENI');
      if (arePutiniOameni) {
        const dateProbleme = issues.filter(i => i.tip === 'PUTINI_OAMENI').map(i => i.data).sort();
        const primaProblema = dateProbleme[0] ?? simStart;
        const ultimaProblema = dateProbleme[dateProbleme.length - 1] ?? primaProblema;
        const concediiPending = [...concediiTestate];
        const p = genereazaPlanCriza(echipa, primaProblema, concediiPending, issues);
        if (p) {
          setPlanCrizaStart(primaProblema);
          setPlanCrizaEnd(ultimaProblema);
          setPlanCrizaIssues(issues);
          setPlanCrizaSimConcedii(concediiPending);
          setPlanCriza(p);
        }
      }
    } else {
      setSimConcedii(prev => [...prev, nou]);
      setSimIssues([]);
    }
  };

  const confirmaAdaugareSimCuProbleme = (activeazaSuplinitor: boolean) => {
    if (!simPendingPayload) return;
    if (activeazaSuplinitor) setSimSuplinitor(true);
    setSimConcedii(prev => [...prev, simPendingPayload]);
    setSimPendingAction(null);
    setSimPendingPayload(null);
    setSimIssues([]);
  };

  const anuleazaAdaugareSim = () => {
    setSimPendingAction(null);
    setSimPendingPayload(null);
    setSimIssues([]);
  };

  const stergeSimConcediu = (id: string) => {
    setSimConcedii(prev => prev.filter(c => c.id !== id));
  };

  const reseteazaSimulare = () => {
    setSimConcedii([]);
    setSimSuplinitor(false);
    setSimIssues([]);
    setSimPendingAction(null);
    setSimPendingPayload(null);
  };

  // ─── Aplica Planul de Criza in calendarul real ───
  // ─── Drag & Drop manual ture ───
  const aplicaDragDrop = (src: {angajatId: number; data: string; tura: string}, destAngajatId: number) => {
    const d = parseD(src.data);
    const srcAngajat = echipa.find(m => m.id === src.angajatId);
    const destAngajat = echipa.find(m => m.id === destAngajatId);
    if (!srcAngajat || !destAngajat) return;
    if (src.angajatId === destAngajatId) return;

    const turaDest = getTuraW(d, destAngajat);
    const dStr = src.data;

    // Validari S->D complete — verificam toate cele 4 cazuri:
    const ziPrev = new Date(d.getTime() - 86400000);
    const ziUrm  = new Date(d.getTime() + 86400000);
    const turaPrevSrc  = getTuraW(ziPrev, srcAngajat).type;
    const turaPrevDest = getTuraW(ziPrev, destAngajat).type;
    const turaUrmSrc   = getTuraW(ziUrm,  srcAngajat).type;
    const turaUrmDest  = getTuraW(ziUrm,  destAngajat).type;

    // Dupa swap: src va avea turaDest, dest va avea src.tura
    const turaSrcNou  = turaDest.type.replace('↔','');
    const turaDestNou = src.tura;

    // Caz 1: dest primeste src.tura=D dupa ce ieri a facut S
    if (turaDestNou === 'D' && turaPrevDest === 'S') {
      setDragError(`S→D interzis: ${destAngajat.nume} a făcut S ieri`);
      setTimeout(()=>setDragError(null),3000); return;
    }
    // Caz 2: src primeste turaDest=D dupa ce ieri a facut S
    if (turaSrcNou === 'D' && turaPrevSrc === 'S') {
      setDragError(`S→D interzis: ${srcAngajat.nume} a făcut S ieri`);
      setTimeout(()=>setDragError(null),3000); return;
    }
    // Caz 3: dest primeste src.tura=S si maine face D
    if (turaDestNou === 'S' && turaUrmDest === 'D') {
      setDragError(`S→D interzis: ${destAngajat.nume} face D mâine`);
      setTimeout(()=>setDragError(null),3000); return;
    }
    // Caz 4: src primeste turaDest=S si maine face D
    if (turaSrcNou === 'S' && turaUrmSrc === 'D') {
      setDragError(`S→D interzis: ${srcAngajat.nume} face D mâine`);
      setTimeout(()=>setDragError(null),3000); return;
    }

    // Verifica 48h pentru dest (primeste o tura activa in loc de L)
    const oreDest = calcOreSaptamana(destAngajat, weekStart, echipa, suplinitorFinal, swapuri, turaOverride, oreAcumulate, runneriActivi, runnerCicluOverride);
    if (['D','S'].includes(src.tura) && !['D','S'].includes(turaDest.type)) {
      if (oreDest + 8 > 48) {
        setDragError(`${destAngajat.nume} ar depăși 48h/săptămână`);
        setTimeout(() => setDragError(null), 3000); return;
      }
    }

    // Aplicam: cream override-uri pentru ambii angajati
    const expiraLa = fmtDateInput(new Date(weekStart.getTime() + 7 * 86400000));
    const noileOverride = turaOverride.filter(o =>
      !(o.id.startsWith('drag_') && o.data === dStr && (o.angajatId === src.angajatId || o.angajatId === destAngajatId))
    );

    // src primeste tura lui dest
    noileOverride.push({
      id: `drag_${src.angajatId}_${dStr}`,
      angajatId: src.angajatId,
      data: dStr,
      tura: turaDest.type.replace('↔','') as 'D'|'S'|'L',
      expiraLa,
    });
    // dest primeste tura lui src
    noileOverride.push({
      id: `drag_${destAngajatId}_${dStr}`,
      angajatId: destAngajatId,
      data: dStr,
      tura: src.tura as 'D'|'S'|'L',
      expiraLa,
    });

    setTuraOverride(noileOverride);
    addLog(`Schimb manual: ${srcAngajat.nume} ↔ ${destAngajat.nume} pe ${fmtDate(d)}`);
    setDragSrc(null);
    setDragOver(null);
  };

  const aplicaPlanCriza = () => {
    if (!planCriza) return;

    // Fail-proof: daca vizitatorul e un runner real (nu Suplinitorul generic 999),
    // verificam sa nu fie deja "imprumutat" la alt coleg CTA in aceeasi perioada.
    if (vizitatorId !== 999) {
      const ovExistent = runnerCicluOverride[vizitatorId];
      const ziuaDupaUltimaCheck = new Date(parseD(planCriza.dataPlecareSup).getTime() + 86400000);
      const seSuprapune = ovExistent && !(fmtDateInput(ziuaDupaUltimaCheck) < ovExistent.perioadaStart || planCriza.dataStart > ovExistent.perioadaSfarsit);
      if (seSuprapune) {
        alert(`${echipa.find(m=>m.id===vizitatorId)?.nume ?? 'Runner-ul ales'} e deja asignat să acopere pe altcineva la CTA în perioada ${ovExistent!.perioadaStart} – ${ovExistent!.perioadaSfarsit}. Alege alt runner sau altă perioadă.`);
        return;
      }
    }

    // Planul de criza acum DOAR pune vizitatorul Duminica — nimic pe restul
    // saptamanii. Zilele lucratoare raman pe rotatia normala (getTuraBaza),
    // care deja respecta legea pentru sub 4 activi.
    const echipaPlo = echipa.filter(m => !isCTA(m));
    const noileOverride: TuraOverride[] = [];
    const dataUltimaZi = parseD(planCriza.dataPlecareSup);
    const ziuaDupaUltima = new Date(dataUltimaZi.getTime() + 86400000);
    const expiraLa = fmtDateInput(ziuaDupaUltima);

    planCriza.plan.forEach(zi => {
      if (!zi.ziuaSef) return; // doar Duminicile primesc override
      noileOverride.push({
        id: `criza_SUP_${zi.data}`,
        angajatId: vizitatorId,
        data: zi.data,
        tura: 'D',
        expiraLa,
      });
      echipaPlo.forEach(m => {
        noileOverride.push({
          id: `criza_${m.id}_${zi.data}`,
          angajatId: m.id,
          data: zi.data,
          tura: 'L',
          expiraLa,
        });
      });
    });

    setTuraOverride(prev => [...prev.filter(o => !o.id.startsWith('criza_')), ...noileOverride]);

    const zileSup = planCriza.plan.filter(zi => zi.ziuaSef).map(zi => fmtDate(parseD(zi.data))).join(', ');
    addLog(`Plan Criză aplicat: vizitator Duminica pana la ${expiraLa}. Zile: ${zileSup}. Restul săptămânii — rotație normală.`);
    setShowPlanCriza(false);
  };

  // Aplica rezultatul simularii in calendarul real — converteste SimConcediu in Concediu pe fiecare angajat
  const aplicaSimulareInReal = () => {
    if (simConcedii.length === 0) return;

    const operatiiApi: Promise<unknown>[] = [];

    setEchipa(prev => prev.map(m => {
      const concediiAngajat = simConcedii.filter(sc => sc.angajatId === m.id);
      if (concediiAngajat.length === 0) return m;

      // Procesam secvential — fiecare concediu nou tine cont de cele deja adaugate
      // mai sus in aceeasi simulare, ca sa nu taxam de doua ori zilele suprapuse
      let angajatProgresiv: Angajat = { ...m };
      let zileTotale = 0;
      const noiConcedii: Concediu[] = [];

      concediiAngajat.forEach(sc => {
        const start = parseD(sc.start);
        const end = new Date(start.getTime() + (sc.zile - 1) * 86400000);
        const endStr = fmtDateInput(end);
        const numeSlot = `${fmtDate(start)}–${fmtDate(end)}`;
        const zl = countZileLucratoareReale(sc.start, endStr, angajatProgresiv);
        zileTotale += zl;
        const concediuNou: Concediu = { n: numeSlot, s: sc.start, e: endStr };
        noiConcedii.push(concediuNou);
        angajatProgresiv = { ...angajatProgresiv, concedii: [...angajatProgresiv.concedii, concediuNou] };

        if (m.uuid) {
          operatiiApi.push(apiAdaugaConcediu(m.uuid, sc.start, endStr, numeSlot, zl));
        }
      });

      const azi = fmtDateInput(new Date());
      return { ...m, concedii: [...m.concedii, ...noiConcedii], ...scadeZileCO(m, zileTotale, azi) };
    }));

    if (simSuplinitor) setSuplinitorActiv(true);
    addLog(`Simulare aplicată: ${simConcedii.length} concedii adăugate în calendarul real`);
    reseteazaSimulare();
    setShowSimulare(false);

    Promise.all(operatiiApi).catch(err => {
      console.error('Eroare la aplicarea simularii in Supabase:', err);
      incarcaTotul();
    });
  };

  const salveazaNume = useCallback((i:number)=>{
    const v=tempNume.trim();
    const angajatTarget = echipa[i];
    if(v && angajatTarget){
      setEchipa(prev=>prev.map((m,idx)=>idx===i?{...m,nume:v}:m));
      addLog(`Nume schimbat: ${angajatTarget.nume} → ${v}`);
      if (angajatTarget.uuid) {
        apiActualizeazaAngajat(angajatTarget.uuid, { nume: v }).catch(err => {
          console.error('Eroare la salvarea numelui in Supabase:', err);
          incarcaTotul();
        });
      }
    }
    setEditIdx(null);
  },[tempNume, setEchipa, addLog, echipa, incarcaTotul]);

  // ─── PDF complet (luna intreaga) ───
  const generatePDF = (lunaRef?: Date) => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const refDate = lunaRef ?? lunaStart;
    const luna = fmtMonth(refDate);
    const yr = refDate.getFullYear(), mo = refDate.getMonth();
    const nrZile = new Date(yr, mo+1, 0).getDate();
    const isCTAView = locatieActiva === 'CTA';
    const echipaPDF = isCTAView ? toataEchipaCTA : echipaPLO;

    doc.setFontSize(16); doc.setTextColor(0, 120, 212);
    doc.text(faraDiacritice(`RotaFlow — Pontaj ${luna} — ${isCTAView ? 'Constanta (CTA)' : 'Ploiesti (PLO)'}`), 14, 14);
    doc.setFontSize(9); doc.setTextColor(100,100,100);
    doc.text(faraDiacritice(`Generat: ${fmtTs(new Date())}`), 14, 20);

    // Tabel ture zilnice
    const zileCols = Array.from({length:nrZile},(_,i)=>(i+1).toString());
    const head = [['Angajat', ...zileCols]];

    // Suplinitor doar pentru PLO
    const tureSup: string[] = [faraDiacritice('Suplinitor (Cta)')];
    let supAreOre = false;
    if (!isCTAView) {
      for(let i=0;i<nrZile;i++){
        const d=new Date(yr,mo,i+1);
        const t=getTuraW(d,SUPLINITOR_OBJ);
        const base=t.type.replace('↔','');
        const val = base==='D'?'D':base==='S'?'S':base==='L'?'':base;
        if(base==='D'||base==='S') supAreOre=true;
        tureSup.push(val);
      }
    }

    const body = [
      ...echipaPDF.map(m => {
        const row: string[] = [faraDiacritice(m.nume)];
        for(let i=0;i<nrZile;i++){
          const d=new Date(yr,mo,i+1);
          const t=getTuraW(d,m);
          const base=t.type.replace('↔','');
          // PLO: D/S, CTA: Z/N, ambele: CO/CM/AN/R/B
          if (isCTAView) {
            row.push(base==='Z'?'Z':base==='N'?'N':base==='R'?'R':base==='B'?'B':base==='CO'?'CO':base==='CM'?'CM':base==='AN'?'AN':'');
          } else {
            row.push(base==='D'?'Z':base==='S'?'N':base==='CO'?'CO':base==='CM'?'CM':base==='AN'?'AN':'');
          }
        }
        return row;
      }),
      ...(supAreOre ? [tureSup] : []),
    ];

    autoTable(doc, {
      head, body, startY: 25,
      styles: { fontSize: 7, cellPadding: 2, halign: 'center' },
      headStyles: { fillColor: isCTAView ? [180,83,9] : [0,120,212], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { halign: 'left', cellWidth: 28, fontStyle: 'bold' } },
      didParseCell: (data) => {
        const v = data.cell.raw as string;
        if (supAreOre && data.row.index === echipaPDF.length && data.section === 'body') {
          data.cell.styles.fillColor = [254, 243, 199];
          data.cell.styles.textColor = [120, 53, 15];
        }
        if(!isCTAView && v==='Z') { data.cell.styles.fillColor=[219,234,254]; data.cell.styles.textColor=[30,64,175]; } // PLO Zi (8h) — culoarea veche de "D"
        else if(!isCTAView && v==='N') { data.cell.styles.fillColor=[243,232,255]; data.cell.styles.textColor=[126,34,206]; } // PLO Noapte (8h) — culoarea veche de "S"
        else if(v==='Z') { data.cell.styles.fillColor=[254,243,199]; data.cell.styles.textColor=[120,53,15]; } // CTA Zi (12h)
        else if(v==='N') { data.cell.styles.fillColor=[224,231,255]; data.cell.styles.textColor=[55,48,163]; } // CTA Noapte (12h)
        else if(v==='R') { data.cell.styles.fillColor=[255,237,213]; data.cell.styles.textColor=[154,52,18]; }
        else if(v==='B') { data.cell.styles.fillColor=[241,245,249]; data.cell.styles.textColor=[100,116,139]; }
        else if(v==='CO') { data.cell.styles.fillColor=[254,242,242]; data.cell.styles.textColor=[185,28,28]; }
        else if(v==='CM') { data.cell.styles.fillColor=[255,247,237]; data.cell.styles.textColor=[194,65,12]; }
        else if(v==='AN') { data.cell.styles.fillColor=[254,226,226]; data.cell.styles.textColor=[153,27,27]; }
      }
    });

    // Tabel statistici
    const statsY = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(11); doc.setTextColor(isCTAView ? 180 : 0, isCTAView ? 83 : 120, isCTAView ? 9 : 212);
    doc.text(faraDiacritice('Statistici lunare'), 14, statsY);
    autoTable(doc, {
      head:[['Angajat','Zile lucrate','Ore lucrate','Sarbatori lucrate','CO ramas','CM','Abs. Nemot.','Scor performanta']],
      body: [
        ...echipaPDF.map(m=>{
          const s=calcScor(m,refDate);
          return[faraDiacritice(m.nume),s.zile.toString(),`${s.ore}h`,s.sarbLucrate.toString(),m.zileCO.toString(),s.zileCM.toString(),s.zileAN.toString(),`${s.scor}p`];
        }),
        ...(!isCTAView ? (() => {
          const sSup = calcScor(SUPLINITOR_OBJ, refDate);
          if (sSup.ore === 0) return [];
          return [[faraDiacritice('Suplinitor (Cta)'), sSup.zile.toString(), `${sSup.ore}h`, sSup.sarbLucrate.toString(), '—', '—', '—', '—']];
        })() : []),
      ],
      startY: statsY+4,
      styles: { fontSize: 9, textColor: [30, 30, 30], fillColor: [255, 255, 255] },
      headStyles: { fillColor: isCTAView ? [180,83,9] : [0,120,212], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data: any) => {
        if (!isCTAView) {
          const supRow = data.row.index === (data.table.body.length - 1) && data.section === 'body';
          if (supRow) {
            data.cell.styles.fillColor = [255, 243, 205];
            data.cell.styles.textColor = [120, 60, 0];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    });

    doc.save(`RotaFlow_Pontaj_${isCTAView?'CTA':'PLO'}_${luna.replace(' ','_')}.pdf`);
    addLog(`PDF exportat: ${luna} — ${isCTAView?'CTA':'PLO'}`);
  };

  // ─── Export CSV, gata de payroll — un rand per angajat, ore defalcate zi/noapte,
  // gata de import in Excel sau software de contabilitate ───
  const exportaCSVPayroll = (lunaRef?: Date) => {
    const refDate = lunaRef ?? lunaStart;
    const luna = fmtMonth(refDate);
    const echipaPDF = locatieActiva === 'CTA' ? toataEchipaCTA : echipaPLO;
    const yr = refDate.getFullYear(), mo = refDate.getMonth();
    const start = new Date(yr, mo, 1), end = new Date(yr, mo + 1, 0);

    const linii: string[] = [];
    linii.push(['Nume', 'Zile lucrate', 'Ore zi', 'Ore noapte', 'Ore total', 'Zile weekend lucrate', 'Sărbători lucrate', 'Zile CO', 'Zile CM', 'Zile AN', 'CO rămas', 'CO reportat'].join(';'));

    echipaPDF.forEach(m => {
      let oreZi = 0, oreNoapte = 0, zileLucrate = 0, weekendLucrate = 0, sarbLucrate = 0, zileCM = 0, zileAN = 0;
      for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
        const t = getTuraW(d, m);
        const esteZiTip = t.type === 'D' || t.type === 'Z';
        const esteNoapteTip = t.type === 'S' || t.type === 'N';
        if (esteZiTip || esteNoapteTip || t.type === 'R' || t.type === 'B' || t.type === 'PLO' || t.type === 'DISP') {
          zileLucrate++;
          const oreZiua = (t.type === 'Z' || t.type === 'N') ? 12 : 8;
          if (esteNoapteTip) oreNoapte += oreZiua; else oreZi += oreZiua;
          if (d.getDay() === 0 || d.getDay() === 6) weekendLucrate++;
          if (isSarbatoare(d)) sarbLucrate++;
        } else if (t.type === 'CM') zileCM++;
        else if (t.type === 'AN') zileAN++;
      }
      const randCSV = [
        faraDiacritice(m.nume), zileLucrate, oreZi, oreNoapte, oreZi + oreNoapte,
        weekendLucrate, sarbLucrate,
        m.concedii.filter(c => { const s = parseD(c.s); return s >= start && s <= end; }).length,
        zileCM, zileAN, m.zileCO, m.zileCOReportate ?? 0,
      ].join(';');
      linii.push(randCSV);
    });

    const csvContent = '\uFEFF' + linii.join('\r\n'); // BOM pentru diacritice corecte in Excel
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RotaFlow_Payroll_${locatieActiva}_${luna.replace(' ', '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`CSV payroll exportat: ${luna} — ${locatieActiva}`);
  };

  // ─── Raport Conformitate — dovada documentata pentru inspectia muncii ───
  // Verifica direct programul REAL (ce arata aplicatia, nu o simulare) pe o perioada
  // aleasa: ore saptamanale, zile consecutive, respectarea S->D. Motorul deja PREVINE
  // structural incalcarile (verificarea universala din getTura), deci raportul confirma
  // si documenteaza conformitatea, nu doar cauta probleme.
  const generateRaportConformitate = (dataStart: Date, dataEnd: Date) => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const echipaVerif = locatieActiva === 'CTA' ? toataEchipaCTA.filter(m => m.tip !== 'runner') : echipaPLO;

    type RandRaport = { nume: string; saptamaniTotale: number; saptamaniLa48h: number; maxConsecutive: number; violariSD: number; violari6zile: number; violari48h: number };
    const randuri: RandRaport[] = [];
    let totalViolari = 0;

    echipaVerif.forEach(m => {
      let maxConsecutive = 0, consecutiveCurent = 0, violariSD = 0, violari6zile = 0;
      let tipIeri: string | null = null;
      const oreSaptamana: Record<string, number> = {};

      for (let d = new Date(dataStart); d <= dataEnd; d = new Date(d.getTime() + 86400000)) {
        const t = getTuraW(d, m);
        const esteLucru = ['D', 'S', 'Z', 'N', 'R', 'B', 'PLO', 'DISP'].includes(t.type);
        if (esteLucru) {
          consecutiveCurent++;
          maxConsecutive = Math.max(maxConsecutive, consecutiveCurent);
          if (consecutiveCurent > 6) violari6zile++;
          if ((t.type === 'D' || t.type === 'Z') && (tipIeri === 'S' || tipIeri === 'N')) violariSD++;
          const luniStr = fmtDateInput(getMonday(d));
          const oreZiua = (t.type === 'Z' || t.type === 'N') ? 12 : 8;
          oreSaptamana[luniStr] = (oreSaptamana[luniStr] ?? 0) + oreZiua;
        } else {
          consecutiveCurent = 0;
        }
        tipIeri = t.type;
      }

      const saptamani = Object.values(oreSaptamana);
      const violari48h = saptamani.filter(o => o > 48).length;
      const la48h = saptamani.filter(o => o === 48).length;
      totalViolari += violariSD + violari6zile + violari48h;

      randuri.push({ nume: m.nume, saptamaniTotale: saptamani.length, saptamaniLa48h: la48h, maxConsecutive, violariSD, violari6zile, violari48h });
    });

    doc.setFontSize(16); doc.setTextColor(0, 0, 0);
    doc.text(faraDiacritice('Raport de Conformitate — Legislatia Muncii'), 14, 18);
    doc.setFontSize(10); doc.setTextColor(100, 100, 100);
    doc.text(faraDiacritice(`Perioada: ${fmtDate(dataStart)} — ${fmtDate(dataEnd)} · Locatie: ${locatieActiva} · Generat: ${fmtTs(new Date())}`), 14, 25);
    doc.setFontSize(9);
    doc.text(faraDiacritice('Verificat: max. 48h/saptamana, max. 6 zile lucratoare consecutive, repaus intre ture (fara tranzitie Seara->Zi imediata).'), 14, 31);

    autoTable(doc, {
      startY: 37,
      head: [['Angajat', 'Saptamani verificate', 'Sapt. la limita 48h', 'Max zile consecutive', 'Incalcari 48h', 'Incalcari 6 zile', 'Incalcari repaus']],
      body: randuri.map(r => [
        faraDiacritice(r.nume), r.saptamaniTotale.toString(), r.saptamaniLa48h.toString(), r.maxConsecutive.toString(),
        r.violari48h.toString(), r.violari6zile.toString(), r.violariSD.toString(),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 41, 59] },
      didParseCell: (data: any) => {
        if (data.section === 'body' && [4, 5, 6].includes(data.column.index) && Number(data.cell.raw) > 0) {
          data.cell.styles.fillColor = [254, 226, 226];
          data.cell.styles.textColor = [153, 27, 27];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    if (totalViolari === 0) {
      doc.setTextColor(21, 128, 61);
      doc.text(faraDiacritice(`✓ Nicio incalcare gasita — ${echipaVerif.length} angajati, ${randuri.reduce((s,r)=>s+r.saptamaniTotale,0)} saptamani-persoana verificate.`), 14, finalY);
    } else {
      doc.setTextColor(185, 28, 28);
      doc.text(faraDiacritice(`⚠ ${totalViolari} incalcari gasite — vezi randurile marcate mai sus.`), 14, finalY);
    }

    doc.save(`RotaFlow_Conformitate_${locatieActiva}_${fmtDateInput(dataStart)}_${fmtDateInput(dataEnd)}.pdf`);
    addLog(`Raport Conformitate generat: ${fmtDate(dataStart)} — ${fmtDate(dataEnd)}, ${locatieActiva}`);
  };

  const generateEchitatePDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const perioadaLabel = echitatePerioada==='luna' ? 'Luna' : echitatePerioada==='trimestru' ? 'Trimestru' : echitatePerioada==='an' ? 'An' : 'Custom';
    const intervalLabel = `${fmtDate(echitateInterval.start)} - ${fmtDate(echitateInterval.end)}`;

    doc.setFontSize(16); doc.setTextColor(16,150,100);
    doc.text(faraDiacritice('RotaFlow — Raport de Echitate'), 14, 14);
    doc.setFontSize(9); doc.setTextColor(100,100,100);
    doc.text(faraDiacritice(`Perioada: ${perioadaLabel} · ${intervalLabel}  ·  Generat: ${fmtTs(new Date())}`), 14, 20);

    autoTable(doc, {
      head: [['Angajat','Ore totale','Nopti (S)','Zile weekend','Sarbatori lucrate','CO ramas']],
      body: echitateDate.map(({angajat,ore,nopti,weekendZile,sarbatoriLucrate})=>[
        faraDiacritice(angajat.nume), `${ore}h`, nopti.toString(), weekendZile.toString(), sarbatoriLucrate.toString(), angajat.zileCO.toString()
      ]),
      startY: 26, styles:{fontSize:9, cellPadding:3}, headStyles:{fillColor:[16,150,100]},
      columnStyles: { 0: { fontStyle: 'bold' } },
    });

    const prognozaY = (doc as any).lastAutoTable.finalY + 10;
    const prognoza = prognozaOreSuplimentare(6);
    if (prognoza.length > 0) {
      doc.setFontSize(11); doc.setTextColor(200,30,30);
      doc.text(faraDiacritice('Prognoză depășiri 48h/săptămână — următoarele 6 săptămâni'), 14, prognozaY);
      autoTable(doc, {
        head: [['Angajat','Saptamana','Ore prognozate']],
        body: prognoza.map(r=>[faraDiacritice(r.angajat), fmtDate(r.saptamanaStart), `${r.ore}h`]),
        startY: prognozaY+4, styles:{fontSize:9}, headStyles:{fillColor:[185,28,28]},
      });
    }

    doc.save(`RotaFlow_Raport_Echitate_${perioadaLabel}.pdf`);
    addLog(`Raport Echitate exportat: ${perioadaLabel} (${intervalLabel})`);
  };

  const generateOrePDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const luna = fmtMonth(weekStart);
    const saptLabel = `${fmtDate(weekStart)} - ${fmtDate(new Date(weekStart.getTime()+6*86400000))}`;

    doc.setFontSize(16); doc.setTextColor(0,120,212);
    doc.text(faraDiacritice('RotaFlow — Pontaj Ore & Suplimentare'), 14, 14);
    doc.setFontSize(9); doc.setTextColor(100,100,100);
    doc.text(faraDiacritice(`Saptamana: ${saptLabel}  |  Luna: ${luna}  |  Generat: ${fmtTs(new Date())}`), 14, 20);

    autoTable(doc, {
      head: [['Angajat', 'Ore sapt.', 'Norma sapt.', 'Ore supl. sapt.', 'Ore luna', 'Zile lucrate luna', 'Ore supl. luna', 'Depasire 48h?']],
      body: tabelOre.map(r => [
        faraDiacritice(r.angajat.nume),
        `${r.oreSapt}h`,
        '40h',
        r.oreSuplSapt > 0 ? `+${r.oreSuplSapt}h` : '0h',
        `${r.oreLuna}h`,
        r.zileLucrateLuna.toString(),
        r.oreSuplLuna > 0 ? `+${r.oreSuplLuna}h` : '0h',
        r.depaseste ? 'DA - ATENTIE!' : 'Nu',
      ]),
      startY: 26,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [0, 120, 212] },
      columnStyles: { 0: { fontStyle: 'bold' } },
      didParseCell: (data) => {
        if (data.column.index === 7 && data.cell.raw === 'DA - ATENTIE!') {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = 'bold';
        }
        if ((data.column.index === 3 || data.column.index === 6) && String(data.cell.raw).startsWith('+')) {
          data.cell.styles.textColor = [194, 65, 12];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(8); doc.setTextColor(120,120,120);
    doc.text(faraDiacritice('Norma saptamanala: 40h | Ore suplimentare = ore lucrate - 40h | Depasire legala: >48h/sapt (Art. 114 Codul Muncii)'), 14, finalY);

    doc.save(`RotaFlow_Ore_Suplimentare_${luna.replace(' ','_')}.pdf`);
    addLog(`Pontaj ore exportat: ${luna}`);
  };

  // Filtrare echipa per locatie activa
  const echipaPLO = useMemo(() => echipa.filter(m => (m.locatieId ?? 1) === 1), [echipa]);
  // Toti angajatii CTA (fix + runneri)
  const toataEchipaCTA = useMemo(() => echipa.filter(m => (m.locatieId ?? 1) === 2), [echipa]);

  const deschidePopupAbsenta = useCallback((m: Angajat) => {
    const azi = new Date();
    const dataStart = fmtDateInput(azi);
    const runneri = toataEchipaCTA.filter(r => r.tip==='runner');
    const disponibili = runneri.filter(r => !runnerCicluOverride[r.id]);
    const sugerat = disponibili.sort((a,b) => (oreAcumulate[a.id]||0)-(oreAcumulate[b.id]||0))[0] ?? null;
    setAbsentaPopup({ angajat: m, tip: null, dataStart, dataSfarsit: dataStart, saptamani: 1, runnerId: sugerat?.id ?? null });
  }, [toataEchipaCTA, runnerCicluOverride, oreAcumulate]);
  // Toggle runner — local only, nu afecteaza PWA
  const toggleRunner = (id: number) => {
    setRunneriActivi(prev => {
      const nou = new Set(prev);
      if (nou.has(id)) {
        nou.delete(id);
        setRunnerDestinatie(d => { const n={...d}; delete n[id]; return n; });
        setRunnerPerioadaStart(d => { const n={...d}; delete n[id]; return n; });
        setRunnerPerioadaEnd(d => { const n={...d}; delete n[id]; return n; });
      } else {
        nou.add(id);
        // Default: saptamana curenta L-Du
        const luni = getMonday(new Date());
        const dum = new Date(luni.getTime() + 6*86400000);
        setRunnerPerioadaStart(d => ({...d, [id]: fmtDateInput(luni)}));
        setRunnerPerioadaEnd(d => ({...d, [id]: fmtDateInput(dum)}));
      }
      return nou;
    });
  };
  // Echipa CTA afisata = TOTI angajatii CTA (runnerii raman vizibili cu stil diferit)
  const echipaCTA = useMemo(() => toataEchipaCTA, [toataEchipaCTA]);
  const echipaActiva = locatieActiva === 'PLO' ? echipaPLO : echipaCTA;

  const displayEchipa = useMemo(()=>{
    const azi = new Date(); azi.setHours(0,0,0,0);
    const areOverrideSup = turaOverride.some(o => o.angajatId === 999 && parseD(o.expiraLa) > azi);
    if (locatieActiva === 'PLO') {
      return (suplinitorFinal || areOverrideSup) ? [...echipaPLO, SUPLINITOR_OBJ] : echipaPLO;
    }
    return echipaCTA; // CTA: toti angajatii CTA (fix + runneri), fara suplinitor PLO
  },[echipa, echipaPLO, echipaCTA, suplinitorFinal, turaOverride, locatieActiva]);

  // Clasament si statistici — per locatie activa
  const echipaStatistici = locatieActiva === 'PLO' ? echipaPLO : toataEchipaCTA;
  const clasament = useMemo(()=>[...echipaStatistici].map(m=>({...m,...calcScor(m,weekStart)})).sort((a,b)=>b.scor-a.scor),[echipaStatistici,weekStart,calcScor]);

  // ─── Tabel Ore & Suplimentare ───
  const tabelOre = useMemo(() => {
    const displayEchipaOre = locatieActiva === 'PLO'
      ? (suplinitorFinal ? [...echipaPLO, SUPLINITOR_OBJ] : echipaPLO)
      : toataEchipaCTA;
    return displayEchipaOre.map((m, i) => {
      const oreSapt = calcOreSaptamana(m, weekStart, echipa, suplinitorFinal, swapuri, turaOverride, oreAcumulate, runneriActivi, runnerCicluOverride);
      const oreSuplSapt = Math.max(0, oreSapt - 40);
      const st = calcScor(m, weekStart);
      const oreLuna = st.ore;
      // Norma lunara = numar zile lucratoare din luna * 8h
      const yr = weekStart.getFullYear(), mo = weekStart.getMonth();
      let normaZile = 0;
      for (let d = new Date(yr,mo,1); d < new Date(yr,mo+1,1); d.setDate(d.getDate()+1)) {
        if (d.getDay() > 0 && d.getDay() < 6 && !isSarbatoare(new Date(d))) normaZile++;
      }
      const normaLuna = normaZile * 8;
      const oreSuplLuna = Math.max(0, oreLuna - normaLuna);
      const depaseste = oreSapt > 48;
      return { angajat: m, idx: i, oreSapt, oreSuplSapt, oreLuna, oreSuplLuna: Math.round(oreSuplLuna), depaseste, zileLucrateLuna: st.zile, normaLuna };
    });
  }, [echipa, weekStart, suplinitorFinal, swapuri, calcScor]);

  // Calendar lunar — zilele lunii
  const zileLuna = useMemo(() => {
    const yr=lunaStart.getFullYear(), mo=lunaStart.getMonth();
    const n=new Date(yr,mo+1,0).getDate();
    return Array.from({length:n},(_,i)=>new Date(yr,mo,i+1));
  }, [lunaStart]);

  // DisplayEchipa pentru tab Luna — include suplinitorul daca are ture in luna afisata
  const displayEchipaLuna = useMemo(() => {
    const supAreOreInLuna = zileLuna.some(d => {
      const t = getTura(d, SUPLINITOR_OBJ, echipa, suplinitorFinal, swapuri, turaOverride, oreAcumulate);
      return t.type === 'D' || t.type === 'S';
    });
    return supAreOreInLuna ? [...echipa, SUPLINITOR_OBJ] : echipa;
  }, [echipa, zileLuna, suplinitorFinal, swapuri, turaOverride, oreAcumulate]);

  const inputCls = "w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-[#60cdff]/50 transition-all";

  if (seIncarca) {
    return (
      <div className="min-h-screen bg-[#1c1c1e] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#60cdff] to-[#0078d4] flex items-center justify-center text-[16px] font-black text-white shadow-lg shadow-[#0078d4]/30 mx-auto mb-4 animate-pulse">R</div>
          <p className="text-zinc-500 text-[13px]">Se încarcă datele din RotaFlow...</p>
        </div>
      </div>
    );
  }

  if (eroareIncarcare) {
    return (
      <div className="min-h-screen bg-[#1c1c1e] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <p className="text-red-400 text-[14px] font-semibold mb-2">Eroare la conectare</p>
          <p className="text-zinc-500 text-[13px] mb-4">{eroareIncarcare}</p>
          <button onClick={incarcaTotul} className="bg-[#0078d4] hover:bg-[#0086ef] text-white text-[13px] font-semibold px-4 py-2 rounded-lg transition-colors">
            Încearcă din nou
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <div className="min-h-screen bg-[#1c1c1e] text-white font-sans text-[13px] flex flex-col">

        {/* ── Titlebar ── */}
        <div className="sticky top-0 z-50 bg-[#1c1c1e]/90 backdrop-blur-xl border-b border-white/[0.07] px-4 py-2.5 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 flex-shrink-0 w-[150px]">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#60cdff] to-[#0078d4] flex items-center justify-center text-[14px] font-black text-white shadow-lg shadow-[#0078d4]/30 flex-shrink-0">R</div>
              <span className="font-bold text-[16px] tracking-tight whitespace-nowrap">RotaFlow</span>
            </div>

            {/* ── Selector Locatie ── */}
            <div className="h-11 flex items-center gap-1 bg-white/[0.05] border border-white/[0.08] rounded-xl p-1">
              <button
                onClick={()=>setLocatieActiva('PLO')}
                className={`h-full flex items-center gap-2 px-5 rounded-lg text-[14px] font-bold transition-all duration-150 ${
                  locatieActiva==='PLO'
                    ? 'bg-[#0078d4] text-white shadow-md shadow-[#0078d4]/25'
                    : 'text-zinc-400 hover:text-white'
                }`}>
                🏭 Ploiești
              </button>
              <button
                onClick={()=>setLocatieActiva('CTA')}
                className={`h-full flex items-center gap-2 px-5 rounded-lg text-[14px] font-bold transition-all duration-150 ${
                  locatieActiva==='CTA'
                    ? 'bg-amber-600 text-white shadow-md shadow-amber-600/25'
                    : 'text-zinc-400 hover:text-white'
                }`}>
                ⚓ Constanța
              </button>
            </div>

            {/* Badge locatie activa */}
            {locatieActiva==='CTA' && (
              <span className="flex items-center gap-1 bg-amber-950/60 border border-amber-500/40 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                12h · Z/N
              </span>
            )}
            {locatieActiva==='PLO' && modeAvarie && (
              <span className="flex items-center gap-1 bg-orange-950/60 border border-orange-500/40 text-orange-300 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                <AlertTriangle size={9}/> AVARIE
              </span>
            )}
            {locatieActiva==='PLO' && alerteOre.length > 0 && (
              <span className="flex items-center gap-1 bg-red-950/60 border border-red-500/40 text-red-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <AlertTriangle size={9}/> {alerteOre.join(', ')} &gt;48h/săpt!
              </span>
            )}
            {locatieActiva==='PLO' && alertePersonalInsuficient.length > 0 && (
              <span className="flex items-center gap-1 bg-amber-950/60 border border-amber-500/40 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <AlertTriangle size={9}/> Personal insuficient — {alertePersonalInsuficient.length} {alertePersonalInsuficient.length===1?'zi':'zile'}!
              </span>
            )}
            {locatieActiva==='PLO' && crizaActiva && (
              <span onClick={()=>setShowPlanCriza(true)} className="flex items-center gap-1 bg-orange-950/60 border border-orange-500/40 text-orange-300 text-[10px] font-bold px-2 py-0.5 rounded-full cursor-pointer hover:bg-orange-900/50 transition-colors">
                ⚡ Plan Criză activ
              </span>
            )}
          </div>
          <div className="h-9 flex items-center gap-1">
            {([['rota','Rotație'],['luna','Calendar'],['stats','Statistici'],['swap','Swap'],['log','Istoric']] as const).map(([t,l])=>(
              <button key={t} onClick={()=>setActiveTab(t)}
                className={`h-full flex items-center px-3.5 rounded-lg text-[12.5px] font-medium transition-all duration-150 ${activeTab===t?'bg-white/10 text-white':'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-2 relative">
            <button onClick={()=>{ setPdfLunaDate(`${weekStart.getFullYear()}-${String(weekStart.getMonth()+1).padStart(2,'0')}`); setShowPdfPicker(p=>!p); }}
              className="h-9 min-w-[92px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.09] text-zinc-100 text-[12.5px] font-semibold transition-all duration-150 active:scale-[0.96] whitespace-nowrap">
              <FileDown size={15} strokeWidth={2.25}/> PDF
            </button>
            {showPdfPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={()=>setShowPdfPicker(false)}/>
                <div className="absolute top-11 left-0 z-50 bg-[#2c2c2e] border border-white/[0.1] rounded-2xl shadow-2xl shadow-black/40 p-3 w-56" onClick={e=>e.stopPropagation()}>
                <p className="text-[11px] text-zinc-400 font-semibold mb-2">Alege luna pentru PDF:</p>
                <input type="month" value={pdfLunaDate}
                  onChange={e=>setPdfLunaDate(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-[12px] text-white outline-none focus:border-emerald-500/50 transition-all mb-2"/>
                <button onClick={()=>{
                  const [yr, mo] = pdfLunaDate.split('-').map(Number);
                  generatePDF(new Date(yr, mo-1, 1));
                  setShowPdfPicker(false);
                }} className="w-full h-9 bg-emerald-900/50 border border-emerald-500/40 text-emerald-300 text-[12px] font-semibold rounded-xl hover:bg-emerald-800/60 transition-all duration-150 active:scale-[0.97] flex items-center justify-center gap-1.5 mb-2">
                  <FileDown size={13}/> Generează PDF
                </button>
                <button onClick={()=>{
                  const [yr, mo] = pdfLunaDate.split('-').map(Number);
                  exportaCSVPayroll(new Date(yr, mo-1, 1));
                  setShowPdfPicker(false);
                }} className="w-full h-9 bg-lime-900/50 border border-lime-500/40 text-lime-300 text-[12px] font-semibold rounded-xl hover:bg-lime-800/60 transition-all duration-150 active:scale-[0.97] flex items-center justify-center gap-1.5">
                  <FileText size={13}/> Export CSV (payroll)
                </button>
              </div>
              </>
            )}
            <button onClick={sincronizeazaDB} disabled={syncLoading}
              className={`h-9 min-w-[92px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl border text-[12.5px] font-semibold transition-all duration-150 active:scale-[0.96] disabled:active:scale-100 disabled:opacity-60 whitespace-nowrap
                ${syncError ? 'bg-red-900/50 border-red-500/40 text-red-300' : syncOk ? 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-600/20' : 'bg-[#0078d4] hover:bg-[#0086ef] border-[#0078d4] text-white shadow-md shadow-[#0078d4]/25'}`}>
              {syncLoading
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block"/><span>Sincronizare...</span></>
                : syncError
                  ? <><AlertTriangle size={15}/> Reîncearcă</>
                : syncOk
                  ? <><Check size={15} strokeWidth={2.5}/> Sincronizat!</>
                  : <><Cloud size={15} strokeWidth={2.25}/> Sincronizează DB</>
              }
            </button>
            {syncError && (
              <div className="w-full basis-full flex items-center gap-2 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2 text-[11px] text-red-300">
                <AlertTriangle size={12} className="flex-shrink-0"/>
                <span className="flex-1">{syncError}</span>
                <button onClick={()=>setSyncError(null)} className="text-red-400/70 hover:text-red-300">✕</button>
              </div>
            )}

            {/* ── Meniu unificat — restul actiunilor, ca sa nu se aglomereze bara ── */}
            <div className="relative">
              <button onClick={()=>setShowMeniuPrincipal(p=>!p)} className="h-9 min-w-[92px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.09] text-zinc-100 text-[12.5px] font-semibold transition-all duration-150 active:scale-[0.96] whitespace-nowrap">
                <Edit3 size={15} strokeWidth={2.25}/> Meniu
              </button>
              {showMeniuPrincipal && (
                <>
                  <div className="fixed inset-0 z-40" onClick={()=>setShowMeniuPrincipal(false)}/>
                  <div className="absolute top-11 left-0 z-50 bg-[#2c2c2e] border border-white/[0.1] rounded-2xl shadow-2xl shadow-black/40 p-1.5 w-56 flex flex-col gap-0.5" onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>{ setShowCO(true); setShowMeniuPrincipal(false); }} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-sky-300 hover:bg-white/[0.06] transition-all text-left">
                      <Calendar size={14}/> Concedii
                    </button>
                    <button onClick={()=>{ setShowMatrice(true); setShowMeniuPrincipal(false); }} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-teal-300 hover:bg-white/[0.06] transition-all text-left">
                      <Scale size={14}/> Matrice
                    </button>
                    <button onClick={()=>{ setShowPersonal(true); setPersonalMod('lista'); setPersonalRezultat(null); setShowMeniuPrincipal(false); }} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-cyan-300 hover:bg-white/[0.06] transition-all text-left">
                      <Plus size={14}/> Personal
                    </button>
                    <button onClick={()=>{ setShowCertificari(true); setShowMeniuPrincipal(false); }} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-orange-300 hover:bg-white/[0.06] transition-all text-left">
                      <HeartPulse size={14}/> Certificări
                    </button>
                    <button onClick={()=>{ setShowAnalizaTermenLung(true); setShowMeniuPrincipal(false); }} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-violet-300 hover:bg-white/[0.06] transition-all text-left">
                      <Trophy size={14}/> Analiză termen lung
                    </button>
                    <button onClick={()=>{ setShowConformitatePicker(true); setShowMeniuPrincipal(false); }} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-slate-300 hover:bg-white/[0.06] transition-all text-left">
                      <FileDown size={14}/> Raport conformitate
                    </button>
                    <div className="h-px bg-white/[0.06] my-1"/>
                    <button onClick={()=>{ setModSelectieMultipla(p=>!p); setCeluleSelectate(new Set()); setShowMeniuPrincipal(false); }} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold hover:bg-white/[0.06] transition-all text-left ${modSelectieMultipla?'text-sky-300':'text-zinc-300'}`}>
                      <Check size={14}/> {modSelectieMultipla?'Ieși din selecția multiplă':'Selectare multiplă'}
                    </button>
                    <button onClick={()=>{ window.print(); setShowMeniuPrincipal(false); }} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-zinc-300 hover:bg-white/[0.06] transition-all text-left">
                      <Printer size={14}/> Print
                    </button>
                    {locatieActiva==='PLO' && (
                      <>
                        <div className="h-px bg-white/[0.06] my-1"/>
                        <button onClick={()=>{ setSuplinitorActiv(s=>!s); setShowMeniuPrincipal(false); }} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold hover:bg-white/[0.06] transition-all text-left ${suplinitorFinal?'text-orange-300':'text-zinc-300'}`}>
                          <HeartPulse size={14}/> {suplinitorFinal?'Scoate Suplinitor':'Activează Suplinitor'}
                        </button>
                        <button onClick={()=>{ setShowUrgente(true); setShowMeniuPrincipal(false); }} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold hover:bg-white/[0.06] transition-all text-left ${modeAvarie?'text-orange-300':'text-rose-300'}`}>
                          <AlertTriangle size={14}/> Urgențe
                        </button>
                        <button onClick={()=>{ setShowSimulare(true); setShowMeniuPrincipal(false); }} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-purple-300 hover:bg-white/[0.06] transition-all text-left">
                          <FlaskConical size={14}/> Simulare Concedii
                        </button>
                        <button onClick={()=>{
                          if (intervaleCrizaPLO.length > 0) {
                            const prima = intervaleCrizaPLO[0];
                            const primaZiCriza = fmtDateInput(prima.start);
                            const ultimaZiCriza = fmtDateInput(prima.end);
                            setModCrizaPerioada('auto');
                            setPlanCrizaStart(primaZiCriza);
                            setPlanCrizaEnd(ultimaZiCriza);
                            setPlanCrizaIssues(alertePersonalInsuficientPLO.map(a => ({
                              tip: 'PUTINI_OAMENI' as const,
                              data: fmtDateInput(a.zi),
                              detalii: `${fmtDate(a.zi)}: ${a.totalActivi} activi din ${echipa.length} (necesari minim 4 fără suplinitor)`,
                            })));
                            setPlanCrizaSimConcedii([]);
                            const p = genereazaPlanCriza(echipa, primaZiCriza, [], [], ultimaZiCriza);
                            if (p) setPlanCriza(p);
                          } else {
                            setModCrizaPerioada('manual');
                            setPlanCrizaStart(fmtDateInput(new Date()));
                            setPlanCrizaEnd('');
                            setPlanCrizaIssues([]);
                            setPlanCrizaSimConcedii([]);
                            setPlanCriza(null);
                          }
                          setShowPlanCriza(true);
                          setShowMeniuPrincipal(false);
                        }} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-red-300 hover:bg-white/[0.06] transition-all text-left">
                          <AlertTriangle size={14}/> Plan Criză
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Popup separat pentru raportul de conformitate — deschis din meniu */}
            {showConformitatePicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={()=>setShowConformitatePicker(false)}/>
                <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[#2c2c2e] border border-white/[0.1] rounded-xl shadow-2xl p-3 w-64" onClick={e=>e.stopPropagation()}>
                  <p className="text-[11px] text-zinc-400 font-semibold mb-2">Raport de conformitate — alege perioada:</p>
                  <div className="flex items-center gap-2 mb-2">
                    <input type="date" value={conformitateStart} onChange={e=>setConformitateStart(e.target.value)}
                      className="flex-1 bg-black/40 border border-white/[0.08] rounded-lg px-2 py-1.5 text-[11px] text-white outline-none focus:border-slate-400/50"/>
                    <span className="text-zinc-600 text-[11px]">–</span>
                    <input type="date" value={conformitateEnd} onChange={e=>setConformitateEnd(e.target.value)}
                      className="flex-1 bg-black/40 border border-white/[0.08] rounded-lg px-2 py-1.5 text-[11px] text-white outline-none focus:border-slate-400/50"/>
                  </div>
                  <button onClick={()=>{
                    generateRaportConformitate(parseD(conformitateStart), parseD(conformitateEnd));
                    setShowConformitatePicker(false);
                  }} className="w-full bg-slate-700 border border-slate-500/40 text-slate-200 text-[12px] font-semibold py-1.5 rounded-lg hover:bg-slate-600 transition-all flex items-center justify-center gap-1.5">
                    <FileDown size={12}/> Generează raport
                  </button>
                </div>
              </>
            )}

            <button onClick={()=>{ if(confirm('Ieși din aplicație?')) logout(); }} className="h-9 min-w-[92px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-white/[0.06] hover:bg-red-950/40 border border-white/[0.09] hover:border-red-500/30 text-zinc-300 hover:text-red-300 text-[12.5px] font-semibold transition-all duration-150 active:scale-[0.96] whitespace-nowrap ml-auto">
              <LogOut size={15} strokeWidth={2.25}/> Logout
            </button>
          </div>
        </div>

        {/* Print header — vizibil doar la print */}
        <div className="print-only hidden p-6 print-header">
          <h1>RotaFlow — {fmtMonth(lunaStart)}</h1>
          <p>Generat: {fmtTs(new Date())}</p>
        </div>

        <div className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full space-y-5">

          {/* Avertizare: zile de CO reportate care expira curand, nefolosite */}
          {(() => {
            const azi = fmtDateInput(new Date());
            const in60zile = fmtDateInput(new Date(Date.now()+60*86400000));
            const cuExpirare = echipa.filter(m => (m.zileCOReportate??0) > 0 && m.zileCOReportateExpira && m.zileCOReportateExpira >= azi && m.zileCOReportateExpira < in60zile);
            if (cuExpirare.length === 0) return null;
            return (
              <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-3.5 flex items-center gap-3 no-print">
                <AlertTriangle size={18} className="text-amber-400 flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-amber-300">Zile de concediu reportate, pe cale să expire</p>
                  <p className="text-[11px] text-amber-400/80">
                    {cuExpirare.map(m => `${m.nume} (${m.zileCOReportate}z, exp. ${fmtDate(parseD(m.zileCOReportateExpira!))})`).join(' · ')}
                  </p>
                </div>
                <button onClick={()=>setShowCO(true)} className="flex-shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-900/50 border border-amber-500/40 text-amber-200 hover:bg-amber-800/60 transition-all whitespace-nowrap">
                  Planifică →
                </button>
              </div>
            );
          })()}

          {/* Avertizare: certificari/calificari care expira curand */}
          {(() => {
            const azi = fmtDateInput(new Date());
            const in60zile = fmtDateInput(new Date(Date.now()+60*86400000));
            const cuExpirare = certificari.filter(c => c.data_expirare && c.data_expirare >= azi && c.data_expirare < in60zile);
            if (cuExpirare.length === 0) return null;
            return (
              <div className="bg-orange-950/30 border border-orange-500/30 rounded-xl p-3.5 flex items-center gap-3 no-print">
                <AlertTriangle size={18} className="text-orange-400 flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-orange-300">Certificări/calificări pe cale să expire</p>
                  <p className="text-[11px] text-orange-400/80">
                    {cuExpirare.map(c => {
                      const ang = echipa.find(m=>m.uuid===c.angajat_id);
                      return `${ang?.nume ?? '?'}: ${c.nume_certificat} (exp. ${fmtDate(parseD(c.data_expirare!))})`;
                    }).join(' · ')}
                  </p>
                </div>
                <button onClick={()=>setShowCertificari(true)} className="flex-shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-orange-900/50 border border-orange-500/40 text-orange-200 hover:bg-orange-800/60 transition-all whitespace-nowrap">
                  Vezi →
                </button>
              </div>
            );
          })()}

          {/* Dashboard unificat de criza — ambele locatii, mereu vizibil, indiferent de tab */}
          {(intervaleCrizaPLO.length > 0 || intervaleCrizaCTA.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 no-print">
              <div className={`rounded-xl p-3 border flex items-center gap-3 ${intervaleCrizaPLO.length>0 ? 'bg-red-950/30 border-red-500/40' : 'bg-white/[0.02] border-white/[0.06]'}`}>
                <span className="text-[16px]">🏭</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-zinc-300">PLOIEȘTI</p>
                  {intervaleCrizaPLO.length > 0 ? (
                    <p className="text-[11px] text-red-300">
                      Criză: {fmtDate(intervaleCrizaPLO[0].start)} → {fmtDate(intervaleCrizaPLO[0].end)} (min. {intervaleCrizaPLO[0].minActivi} activi)
                    </p>
                  ) : (
                    <p className="text-[11px] text-emerald-400/80">Acoperire OK — următoarele 90 de zile</p>
                  )}
                </div>
                {intervaleCrizaPLO.length > 0 && (
                  <button onClick={()=>{
                    const primaZiCriza = fmtDateInput(intervaleCrizaPLO[0].start);
                    const ultimaZiCriza = fmtDateInput(intervaleCrizaPLO[0].end);
                    setModCrizaPerioada('auto');
                    setPlanCrizaStart(primaZiCriza);
                    setPlanCrizaEnd(ultimaZiCriza);
                    const p = genereazaPlanCriza(echipa, primaZiCriza, [], [], ultimaZiCriza);
                    setPlanCriza(p);
                    setShowPlanCriza(true);
                  }} className="flex-shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-red-900/50 border border-red-500/40 text-red-200 hover:bg-red-800/60 transition-all whitespace-nowrap">
                    Plan Criză →
                  </button>
                )}
              </div>
              <div className={`rounded-xl p-3 border flex items-center gap-3 ${intervaleCrizaCTA.length>0 ? 'bg-amber-950/30 border-amber-500/40' : 'bg-white/[0.02] border-white/[0.06]'}`}>
                <span className="text-[16px]">⚓</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-zinc-300">CONSTANȚA</p>
                  {intervaleCrizaCTA.length > 0 ? (
                    <p className="text-[11px] text-amber-300">
                      Acoperire insuficientă: {fmtDate(intervaleCrizaCTA[0].start)} → {fmtDate(intervaleCrizaCTA[0].end)}
                    </p>
                  ) : (
                    <p className="text-[11px] text-emerald-400/80">Acoperire OK — următoarele 90 de zile</p>
                  )}
                </div>
                {intervaleCrizaCTA.length > 0 && (
                  <button onClick={()=>setLocatieActiva('CTA')} className="flex-shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-900/50 border border-amber-500/40 text-amber-200 hover:bg-amber-800/60 transition-all whitespace-nowrap">
                    Vezi CTA →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Banner avarie */}
          {modeAvarie && (
            <div className="bg-orange-950/40 border border-orange-500/40 rounded-xl p-3.5 flex items-center justify-between gap-3 no-print">
              <div className="flex items-center gap-3">
                <AlertTriangle className="text-orange-400 flex-shrink-0" size={18}/>
                <div>
                  <p className="font-bold text-orange-300 text-[12px]">Protocol Avarie Activat</p>
                  <p className="text-orange-400/70 text-[10px] mt-0.5">
                    {echipa.filter(m=>days.some(d=>inAbsenta(d,m,'CM'))).map(m=>m.nume).join(', ')} — CM activ.
                    {suplinitorFinal?' Suplinitor activ.':' Recomandat suplinitor dacă CM > 7 zile.'}
                  </p>
                </div>
              </div>
              <button onClick={()=>setSuplinitorActiv(s=>!s)}
                className={`flex-shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${suplinitorFinal?'bg-zinc-800 border-zinc-600 text-zinc-300':'bg-orange-500/20 border-orange-500/40 text-orange-300 hover:bg-orange-500/30'}`}>
                {suplinitorFinal?'Scoate Suplinitor':'+ Suplinitor'}
              </button>
            </div>
          )}

          {/* Alerta ore maxime */}
          {alerteOre.length > 0 && (
            <div className="bg-red-950/40 border border-red-500/40 rounded-xl p-3 flex items-center gap-3 no-print">
              <AlertTriangle className="text-red-400 flex-shrink-0" size={16}/>
              <p className="text-red-300 text-[12px]">
                <span className="font-bold">Atenție Art. 114 Codul Muncii:</span> {alerteOre.join(', ')} depășesc 48h/săptămână în săptămâna curentă!
              </p>
            </div>
          )}

          {/* Alerta personal insuficient */}
          {intervaleCriza.length > 0 && (
            <div className={`border rounded-xl p-4 no-print ${intervaleCriza.some(a=>a.critic)?'bg-red-950/50 border-red-500/50':'bg-amber-950/40 border-amber-500/40'}`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={intervaleCriza.some(a=>a.critic)?'text-red-400 flex-shrink-0 mt-0.5':'text-amber-400 flex-shrink-0 mt-0.5'} size={16}/>
                <div className="flex-1 min-w-0">
                  <p className={intervaleCriza.some(a=>a.critic)?'text-red-300 text-[12px]':'text-amber-300 text-[12px]'}>
                    <span className="font-bold">
                      {intervaleCriza.some(a=>a.critic) ? 'CRITIC — chiar și cu Suplinitorul activ:' : 'Personal insuficient, următoarele 90 de zile:'}
                    </span>{' '}
                    {intervaleCriza.map((iv,i)=>(
                      <span key={i}>{i>0?', ':''}{fmtDateInput(iv.start)===fmtDateInput(iv.end) ? fmtDate(iv.start) : `${fmtDate(iv.start)} – ${fmtDate(iv.end)}`} (min. {iv.minActivi} activi)</span>
                    ))} — minim recomandat 4 angajați activi.
                  </p>
                  {locatieActiva !== 'CTA' && intervaleCrizaPLO.length > 0 && (
                  <button
                    onClick={()=>{
                      const primaZiCriza = fmtDateInput(intervaleCrizaPLO[0].start);
                      const ultimaZiCriza = fmtDateInput(intervaleCrizaPLO[0].end);
                      setModCrizaPerioada('auto');
                      setPlanCrizaStart(primaZiCriza);
                      setPlanCrizaEnd(ultimaZiCriza);
                      const p = genereazaPlanCriza(echipa, primaZiCriza, [], [], ultimaZiCriza);
                      setPlanCriza(p);
                      setShowPlanCriza(true);
                    }}
                    className={`mt-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                      intervaleCriza.some(a=>a.critic)
                        ? 'bg-red-900/50 border border-red-500/40 text-red-200 hover:bg-red-800/60'
                        : 'bg-amber-900/50 border border-amber-500/40 text-amber-200 hover:bg-amber-800/60'
                    }`}>
                    <AlertTriangle size={11}/>
                    Generează Plan de Criză automat →
                  </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Cards echipa */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {echipa.map((m,i)=>{
              const st=calcScor(m,weekStart);
              const pct=Math.round((1-m.zileCO/24)*100);
              const col=AVATAR_COLORS[i%5];
              const hasCM=m.absente.some(a=>a.tip==='CM');
              const hasAN=m.absente.some(a=>a.tip==='AN');
              const oreS=calcOreSaptamana(m,weekStart,echipa,suplinitorFinal,swapuri,turaOverride,oreAcumulate,runneriActivi,runnerCicluOverride);
              return (
                <div key={i} className={`bg-[#2c2c2e] border ${hasCM?'border-orange-500/50':hasAN?'border-red-500/40':oreS>48?'border-red-500/60':'border-white/[0.08]'} rounded-xl p-3.5 hover:border-white/20 transition-all`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{background:col+'22',color:col,border:`1px solid ${col}44`}}>{m.nume.substring(0,2).toUpperCase()}</div>
                    {editIdx===i?(
                      <input autoFocus className="bg-black/50 border border-[#60cdff] rounded-md px-1.5 py-0.5 text-xs text-white outline-none w-full"
                        defaultValue={m.nume} onChange={e=>setTempNume(e.target.value)}
                        onKeyDown={e=>e.key==='Enter'&&salveazaNume(i)} onBlur={()=>salveazaNume(i)}/>
                    ):(
                      <div className="flex items-center justify-between flex-1 min-w-0">
                        <span className="font-semibold truncate text-sm">{m.nume}</span>
                        <button onClick={()=>{setEditIdx(i);setTempNume(m.nume);}} className="text-zinc-600 hover:text-[#60cdff] transition-colors flex-shrink-0"><Edit3 size={11}/></button>
                      </div>
                    )}
                  </div>
                  {m.absente.length>0&&(
                    <div className="mb-2 space-y-1">
                      {m.absente.map((a,ai)=>(
                        <div key={ai} className={`flex items-center justify-between rounded-lg px-2 py-1 ${a.tip==='CM'?'bg-orange-950/40 border border-orange-500/25':'bg-red-950/40 border border-red-500/25'}`}>
                          <span className={`text-[10px] font-bold flex items-center gap-1 ${a.tip==='CM'?'text-orange-300':'text-red-300'}`}>
                            {a.tip==='CM'?<HeartPulse size={9}/>:<AlertTriangle size={9}/>} {a.tip} {a.zile}z
                          </span>
                          <button onClick={()=>stergeAbsenta(i,ai)} className="text-zinc-600 hover:text-red-400 text-[12px] leading-none">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-1.5 mb-3">
                    {[{v:`${st.ore}h`,l:'ore'},{v:st.zile,l:'zile'},{v:m.zileCO,l:'CO răm.'}].map(({v,l})=>(
                      <div key={l} className="bg-black/30 rounded-lg py-1.5 text-center">
                        <div className="text-[13px] font-bold text-[#60cdff]">{v}</div>
                        <div className="text-[9px] text-zinc-500 mt-0.5">{l}</div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
                      <span>CO utilizat</span>
                      <span className={oreS>48?'text-red-400 font-bold':''}>
                        {oreS>48?`⚠ ${oreS}h/săpt`:pct+'%'}
                      </span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${oreS>48?'bg-red-500':'bg-[#60cdff]'}`} style={{width:`${pct}%`}}/>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Tab Rotatie saptamanala ── */}
          {activeTab==='rota'&&(
            <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl overflow-hidden">

              {/* Panel echipa — doar CTA */}
              {locatieActiva==='CTA' && toataEchipaCTA.length > 0 && (
                <div className="px-4 py-3 border-b border-white/[0.07] flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Echipă:</span>
                  {toataEchipaCTA.map(m => {
                    const isRunner = m.tip === 'runner';
                    // Tura de azi
                    const azi = new Date(); azi.setHours(0,0,0,0);
                    const aziStr = fmtDateInput(azi);
                    // Daca e runner si e plecat la PLO azi (plan de criza activ), aratam asta clar,
                    // ca sa nu para disponibil la CTA cand de fapt lucreaza la PLO
                    const laPloAzi = isRunner && turaOverride.some(o =>
                      o.id.startsWith('criza_') && o.angajatId === m.id && o.data === aziStr && parseD(o.expiraLa) > azi
                    );
                    const turaAzi = getTuraW(azi, m).type;
                    // Label tura
                    const turaLabel = laPloAzi ? 'La PLO' : turaAzi==='Z' ? 'Zi' : turaAzi==='N' ? 'Noapte' : turaAzi==='R' ? 'Runner' : turaAzi==='DISP' ? 'Disponibil' : turaAzi==='B' ? 'Birou' : turaAzi==='CO' ? 'CO' : turaAzi==='L' ? 'Liber' : turaAzi;
                    // Culoare badge
                    const badgeCls = laPloAzi ? 'text-orange-300 bg-orange-950/40 border-orange-500/40' :
                                     turaAzi==='Z' ? 'text-amber-400 bg-amber-950/30 border-amber-500/30' :
                                     turaAzi==='N' ? 'text-indigo-300 bg-indigo-950/30 border-indigo-500/30' :
                                     turaAzi==='R' ? 'text-orange-300 bg-orange-950/30 border-orange-500/30' :
                                     turaAzi==='DISP' ? 'text-amber-300 bg-amber-950/40 border-amber-500/30' :
                                     turaAzi==='B' ? 'text-teal-400 bg-zinc-800/60 border-zinc-600/40' :
                                     turaAzi==='CO' ? 'text-rose-300 bg-rose-950/30 border-rose-500/30' :
                                     'text-zinc-500 bg-white/[0.03] border-white/[0.06]';
                    return (
                      <div key={m.id} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border ${badgeCls}`}>
                        {laPloAzi ? '🚌' : turaAzi==='DISP' ? '🟡' : isRunner ? '💼' : '🔵'}
                        <span>{m.nume.split(' ')[0]}</span>
                        <span className="text-[10px] opacity-70">({turaLabel})</span>
                      </div>
                    );
                  })}
                  <span className="text-[10px] text-zinc-600">
                    Click stg = R · Click dr = Z/N
                  </span>
                  <button onClick={()=>setShowConfigEchipa(true)}
                    className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-zinc-500 text-[11px] hover:text-zinc-300 hover:bg-white/[0.08] transition-all">
                    ⚙️ Configurare
                  </button>
                </div>
              )}
              <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[12px] text-zinc-300">Rotație săptămânală</span>
                  <span className="text-[10px] text-zinc-600 bg-white/5 px-2 py-0.5 rounded-full">
                    {locatieActiva==='CTA'
                      ? `CTA · ciclu 4 (Z/N/L/L)`
                      : modeAvarie
                        ? `Avarie · ciclu ${displayEchipa.filter(m=>!days.some(d=>inAbsenta(d,m,'any')||inCO(d,m))).length}`
                        : 'Normal · ciclu 5'
                    }
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={()=>setWeekOffset(o=>o-1)} className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/[0.08] rounded-md transition-all text-zinc-400"><ChevronLeft size={13}/></button>
                  <span className="text-[11px] font-mono text-zinc-400 min-w-[120px] text-center">{fmtDate(days[0])} – {fmtDate(days[6])}</span>
                  <button onClick={()=>setWeekOffset(o=>o+1)} className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/[0.08] rounded-md transition-all text-zinc-400"><ChevronRight size={13}/></button>
                </div>
              </div>
              <div className="overflow-x-auto p-4">
                <table className="w-full border-separate border-spacing-2 table-fixed">
                  <thead>
                    <tr>
                      <th className="text-left text-[12px] font-semibold text-zinc-400 uppercase tracking-wider pl-3 pb-2 w-44">Angajat</th>
                      {days.map((d,i)=>(
                        <th key={i} className={`text-center text-[11px] font-semibold uppercase tracking-wide pb-2 w-[108px] ${isSarbatoare(d)?'text-amber-400':'text-zinc-400'}`}>
                          {DAY_FULL[i]}<br/><span className="text-[11px] font-normal opacity-60 normal-case">{fmtDate(d)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayEchipa.map((m,mi)=>{
                      const oreS=calcOreSaptamana(m,weekStart,echipa,suplinitorFinal,swapuri,turaOverride,oreAcumulate,runneriActivi,runnerCicluOverride);
                      return (
                        <tr key={mi}>
                          <td className="pl-3 pr-4 py-1.5 overflow-hidden">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                                style={{background:AVATAR_COLORS[mi%5]+'22',color:AVATAR_COLORS[mi%5],border:`1.5px solid ${AVATAR_COLORS[mi%5]}55`}}>
                                {m.nume.substring(0,2).toUpperCase()}
                              </div>
                              <div>
                                <span
                                  className={`font-semibold text-[14px] leading-tight text-zinc-100 cursor-pointer hover:text-blue-400 transition-colors`}
                                  onClick={() => {
                                    if (m.tip==='runner') {
                                      const texte: Record<string,string> = {};
                                      days.forEach(d => {
                                        const dStr = fmtDateInput(d);
                                        const ov = turaOverride.find(o => o.id === `drag_deplasare_${m.id}_${dStr}`);
                                        if (ov) texte[dStr] = ov.tura;
                                      });
                                      setDeplasarePopup({ angajat: m, texte });
                                      return;
                                    }
                                    deschidePopupAbsenta(m);
                                  }}
                                  title={m.tip==='runner' ? 'Click pentru deplasări' : 'Click pentru absență rapidă'}
                                >{m.nume}</span>
                                {oreS>0&&<span className={`ml-2 text-[10px] ${oreS>48?'text-red-400 font-bold':'text-zinc-600'}`}>{oreS}h</span>}
                                <span className="ml-1 text-[9px] text-zinc-700 cursor-pointer hover:text-blue-400"
                                  title="Concediu / CM / AN"
                                  onClick={() => deschidePopupAbsenta(m)}>＋</span>
                              </div>
                            </div>
                          </td>
                          {days.map((d,di)=>{
                            const t=getTuraW(d,m);
                            const sarb=isSarbatoare(d);
                            const baseType=t.type.replace('↔','');
                            const esteDeplasare = baseType==='B' && t.label!=='B';
                            const style=esteDeplasare ? 'bg-purple-950/50 text-purple-300 border border-purple-500/30' : SHIFT_STYLE[baseType]??SHIFT_STYLE.L;
                            const dStr=fmtDateInput(d);
                            // CTA: Z e N sunt locked (non-editabile fara override manual)
                            // Pentru CTA: celulele Z/N sunt editabile (nu locked)
                            const isLocked=['CO','CM','AN'].includes(baseType);
                            const hasManualOverride=turaOverride.some(o=>o.id.startsWith('drag_')&&o.angajatId===m.id&&o.data===dStr);

                            const handleCellClick = (e: React.MouseEvent) => {
                              if (isLocked) return;
                              e.preventDefault();

                              if (modSelectieMultipla) {
                                const cheie = `${m.id}_${dStr}`;
                                setCeluleSelectate(prev => {
                                  const nou = new Set(prev);
                                  if (nou.has(cheie)) nou.delete(cheie); else nou.add(cheie);
                                  return nou;
                                });
                                return;
                              }

                              const overrideActiv = turaOverride.find(o=>o.id.startsWith('drag_')&&o.angajatId===m.id&&o.data===dStr);
                              const isRightClick = e.button === 2 || e.ctrlKey;

                              let turaNouaType: string|null;

                              if (isCTA(m)) {
                                if (m.tip === 'runner') {
                                  // RUNNER: toate zilele editabile
                                  // Click stanga L-V: B → R → sterge
                                  // Click dreapta orice zi: Z → N → L → Z
                                  if (overrideActiv) {
                                    turaNouaType = null; // sterge, revine la B/L
                                  } else if (isRightClick) {
                                    turaNouaType = baseType==='B'||baseType==='L' ? 'Z' : baseType==='Z' ? 'N' : baseType==='N' ? 'L' : 'Z';
                                  } else {
                                    // Click stanga: B→R, L(weekend)→R, R→sterge
                                    turaNouaType = baseType==='R' ? null : 'R';
                                  }
                                } else {
                                  // Fix CTA: click stanga Z→L→Z, click dreapta N→L→N
                                  if (overrideActiv) {
                                    turaNouaType = null;
                                  } else if (isRightClick) {
                                    turaNouaType = baseType === 'N' ? 'L' : 'N';
                                  } else {
                                    turaNouaType = baseType === 'Z' ? 'L' : 'Z';
                                  }
                                }
                              } else {
                                // PLO: logica originala D/S/L
                                const turaAfisata = baseType as 'D'|'S'|'L';
                                if (isRightClick) {
                                  turaNouaType = overrideActiv?.tura === 'S' ? null : 'S';
                                } else {
                                  if (turaAfisata === 'D') turaNouaType = 'L';
                                  else if (turaAfisata === 'S') turaNouaType = 'L';
                                  else turaNouaType = 'D';
                                }

                                // Validari S->D (doar PLO)
                                if (turaNouaType !== null) {
                                  const ziPrev=new Date(d.getTime()-86400000);
                                  const ziUrm=new Date(d.getTime()+86400000);
                                  const turaPrevM=getTuraW(ziPrev,m).type;
                                  const turaUrmM=getTuraW(ziUrm,m).type;
                                  if (turaNouaType==='D' && turaPrevM==='S') {
                                    setDragError(`S→D interzis: ${m.nume} a făcut S ieri`);
                                    setTimeout(()=>setDragError(null),3000); return;
                                  }
                                  if (turaNouaType==='S' && turaUrmM==='D') {
                                    setDragError(`S→D interzis: ${m.nume} face D mâine`);
                                    setTimeout(()=>setDragError(null),3000); return;
                                  }
                                }
                              }

                              if (turaNouaType === null) {
                                setTuraOverride(prev=>prev.filter(o=>!(o.id.startsWith('drag_')&&o.angajatId===m.id&&o.data===dStr)));
                                setDragError(null);
                                return;
                              }

                              // Validare 48h — pentru runneri calculam doar orele efective (Z/N/R), nu birou
                              const orePerTura = isCTA(m) ? 12 : 8;
                              let oreAct: number;
                              if (isCTA(m) && m.tip==='runner') {
                                // Numaram doar override-urile din saptamana curenta
                                oreAct = 0;
                                for (let i=0; i<7; i++) {
                                  const dCheck = new Date(weekStart.getTime()+i*86400000);
                                  const dCheckStr = fmtDateInput(dCheck);
                                  if (dCheckStr === dStr) continue; // sarim ziua curenta (o calculam cu delta)
                                  const ov = turaOverride.find(o=>o.id.startsWith('drag_')&&o.angajatId===m.id&&o.data===dCheckStr);
                                  if (ov?.tura === 'Z' || ov?.tura === 'N') oreAct += 12;
                                  else if (ov?.tura === 'R') oreAct += 8;
                                }
                              } else {
                                oreAct = calcOreSaptamana(m, weekStart, echipa, suplinitorFinal, swapuri, turaOverride, oreAcumulate, runneriActivi, runnerCicluOverride);
                              }
                              const eraActiv = ['D','S','Z','N','R'].includes(baseType);
                              const vaFiActiv = ['D','S','Z','N','R'].includes(turaNouaType??'');
                              const oreNoua = turaNouaType==='Z'||turaNouaType==='N' ? 12 : turaNouaType==='R'||turaNouaType==='D'||turaNouaType==='S' ? 8 : 0;
                              const oreVeche = baseType==='Z'||baseType==='N' ? 12 : baseType==='R'||baseType==='D'||baseType==='S' ? 8 : 0;
                              const delta = oreNoua - (eraActiv ? oreVeche : 0);
                              if (oreAct + delta > 48) {
                                setDragError(`${m.nume} ar depăși 48h/săptămână (${oreAct+delta}h)`);
                                setTimeout(()=>setDragError(null),3000); return;
                              }

                              const expiraLaOv = fmtDateInput(new Date(new Date(dStr).getTime()+365*86400000));
                              setTuraOverride(prev=>[
                                ...prev.filter(o=>!(o.id.startsWith('drag_')&&o.angajatId===m.id&&o.data===dStr)),
                                {id:`drag_${m.id}_${dStr}`, angajatId:m.id, data:dStr, tura:turaNouaType as 'D'|'S'|'L'|'Z'|'N', expiraLa:expiraLaOv}
                              ]);
                              setDragError(null);
                            };

                            // Runner: click pe celula functioneaza mereu (nu e locked)
                            const esteRunner = isCTA(m) && m.tip==='runner';
                            const isWE = d.getDay()===0||d.getDay()===6;
                            // Stil: R = portocaliu, B = zinc cu dunga, Z/N/L = normal
                            const styleRunnerSau = (esteRunner && baseType==='R')
                              ? 'bg-orange-950/50 text-orange-300 border border-orange-500/40'
                              : style;

                            return (
                              <td key={di} className="text-center">
                                <div
                                  onClick={handleCellClick}
                                  onContextMenu={e=>{ e.preventDefault(); handleCellClick(e); }}
                                  title={modSelectieMultipla ? 'Click pentru a selecta/deselecta' : esteRunner
                                    ? 'Click stg = R (8h) · Click dr = Z→N→L · din nou = șterge'
                                    : isLocked ? '' : isCTA(m)
                                      ? 'Click = Z/L · Click dr = N/L · din nou = șterge'
                                      : 'Click stg = Z · Click dr = N · din nou = șterge'
                                  }
                                  className={`relative group text-[14px] font-bold py-3.5 px-2 rounded-lg transition-all select-none tracking-tight
                                    ${styleRunnerSau}
                                    ${t.swapped?'ring-2 ring-amber-400/60':''}
                                    ${hasManualOverride?'ring-2 ring-white/30':''}
                                    ${modSelectieMultipla && celuleSelectate.has(`${m.id}_${dStr}`) ? 'ring-2 ring-sky-400 bg-sky-500/20' : ''}
                                    ${isLocked ? 'cursor-default' : 'cursor-pointer active:scale-95'}
                                  `}>
                                  {/* Continut celula */}
                                  {baseType==='R' ? (
                                    <span className="text-[11px] font-black text-orange-300">R</span>
                                  ) : esteDeplasare ? (
                                    <div className="flex flex-col items-center gap-0.5 w-full relative" title={t.label}>
                                      <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-purple-500/60"/>
                                      <span className="text-[11px]">🧭</span>
                                      <span className="text-[8px] font-bold text-purple-300 tracking-tight uppercase truncate max-w-full px-0.5">{t.label}</span>
                                    </div>
                                  ) : baseType==='B' ? (
                                    <div className="flex flex-col items-center gap-0.5 w-full relative">
                                      <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-teal-500/60"/>
                                      <span className="text-[11px]">💼</span>
                                      <span className="text-[7px] font-bold text-teal-400/80 tracking-wider uppercase">birou</span>
                                    </div>
                                  ) : baseType==='L' ? (
                                    <span className="text-zinc-700">—</span>
                                  ) : (
                                    <span className={dispLabelFull(baseType).length > 5 ? 'text-[12px]' : 'text-[14px]'}>{dispLabelFull(baseType)}</span>
                                  )}
                                  {sarb&&!['L','CO','CM','AN','B'].includes(baseType)&&<span className="absolute -top-1.5 -right-1 text-amber-400 text-[10px]">★</span>}
                                  {hasManualOverride&&<span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-white/50"/>}
                                  {(() => {
                                    const notaExistenta = noteTura.find(n => n.angajat_id === m.uuid && n.data === dStr);
                                    return (
                                      <span
                                        onClick={e => { e.stopPropagation(); setNotaPopup({ angajat: m, dStr, text: notaExistenta?.text ?? '' }); }}
                                        title={notaExistenta ? notaExistenta.text : 'Adaugă notă de predare'}
                                        className={`absolute -bottom-1 -left-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] transition-all ${notaExistenta ? 'bg-amber-500 text-black opacity-100' : 'bg-white/10 text-white/40 opacity-0 group-hover:opacity-100 hover:bg-white/20'}`}
                                      >📝</span>
                                    );
                                  })()}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-white/[0.05] flex gap-5 flex-wrap items-center">
                {locatieActiva === 'PLO' ? (
                  // Legenda PLO — clase hardcodate (Tailwind purge)
                  <>
                    <div className="flex items-center gap-2 text-[12px] text-zinc-400"><div className="w-4 h-4 rounded-md bg-orange-400/[0.15] border-l-4 border-orange-400"/>Zi</div>
                    <div className="flex items-center gap-2 text-[12px] text-zinc-400"><div className="w-4 h-4 rounded-md bg-violet-400/[0.15] border-l-4 border-violet-500"/>Noapte</div>
                    <div className="flex items-center gap-2 text-[12px] text-zinc-400"><div className="w-4 h-4 rounded-md bg-white/[0.03] border border-white/10 flex items-center justify-center text-[9px] text-zinc-600">L</div>Liber</div>
                    <div className="flex items-center gap-2 text-[12px] text-zinc-400"><div className="w-4 h-4 rounded-md bg-red-400/[0.15] border-l-4 border-red-500"/>Concediu</div>
                    <div className="flex items-center gap-2 text-[12px] text-zinc-400"><div className="w-4 h-4 rounded-md bg-pink-400/[0.15] border-l-4 border-pink-500"/>Medical</div>
                    <div className="flex items-center gap-2 text-[12px] text-zinc-400"><div className="w-4 h-4 rounded-md bg-zinc-500/[0.15] border-l-4 border-zinc-500"/>Abs. Nemot.</div>
                    <div className="flex items-center gap-2 text-[12px] text-zinc-400"><span className="text-amber-400/80 text-[11px]">↔</span>Swap</div>
                    <div className="flex items-center gap-2 text-[12px] text-zinc-400"><span className="text-amber-400">★</span>Sărbătoare</div>
                  </>
                ) : (
                  // Legenda locatie activa (CTA sau orice alta locatie 12h)
                  <>
                    <div className="flex items-center gap-1.5 text-[12px] text-zinc-400"><div className="w-4 h-4 rounded-md bg-orange-400/[0.15] border-l-4 border-orange-400"/>Zi</div>
                    <div className="flex items-center gap-1.5 text-[12px] text-zinc-400"><div className="w-4 h-4 rounded-md bg-violet-400/[0.15] border-l-4 border-violet-500"/>Noapte</div>
                    <div className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                      <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold bg-red-400/[0.15] text-red-300 border-l-4 border-red-500">CO</div>
                      <span>Concediu</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                      <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold bg-zinc-800/80 text-teal-400 border border-zinc-500/50">💼</div>
                      <span>Birou (8h)</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                      <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold bg-orange-950/50 text-orange-300 border border-orange-500/30">→</div>
                      <span>Runner activ</span>
                    </div>
                  </>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[11px] text-zinc-600">
                    {locatieActiva==='CTA'
                      ? '👆 Stânga = Z/L · Dreapta = N/L · din nou = șterge'
                      : '👆 Stânga = D · Dreapta = S · din nou = șterge'
                    }
                  </span>
                  <button onClick={verificaSaptamana}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-900/40 border border-emerald-500/30 text-emerald-300 text-[12px] font-semibold hover:bg-emerald-800/50 transition-all">
                    <Check size={13}/> Verifică
                  </button>
                  {/* Buton Salvează — 2 pași */}
                  {saveStep === 0 ? (
                    <button
                      onClick={() => { if (turaOverride.filter(o=>o.id.startsWith('drag_')).length > 0) setSaveStep(1); else addLog('Nu există modificări manuale de salvat.'); }}
                      disabled={saveLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900/40 border border-amber-500/30 text-amber-300 text-[12px] font-semibold hover:bg-amber-800/50 transition-all disabled:opacity-50">
                      <FileText size={13}/> Salvează modificările
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-amber-400 font-semibold">Ești sigur?</span>
                      <button
                        onClick={salveazaModificari}
                        disabled={saveLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 border border-amber-500 text-white text-[12px] font-bold hover:bg-amber-500 transition-all disabled:opacity-50">
                        {saveLoading
                          ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin inline-block"/> Se salvează...</>
                          : saveOk
                            ? <><Check size={13}/> Salvat!</>
                            : <><Check size={13}/> Da, salvează</>
                        }
                      </button>
                      <button onClick={() => setSaveStep(0)}
                        className="px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-400 text-[12px] hover:bg-zinc-700 transition-all">
                        <X size={13}/>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {dragError && (
                <div className="mx-4 mb-3 flex items-center gap-2 bg-red-950/60 border border-red-500/40 text-red-300 text-[12px] font-semibold px-4 py-2 rounded-xl animate-pulse">
                  <AlertTriangle size={14}/> {dragError}
                </div>
              )}
              {/* Alert runner weekend — doar CTA */}
              {locatieActiva==='CTA' && (() => {
                const runneriWeekend = toataEchipaCTA.filter(m =>
                  m.tip==='runner' && !runneriActivi.has(m.id) &&
                  days.some(d => {
                    const isWE = d.getDay()===0||d.getDay()===6;
                    const t = getTuraW(d,m);
                    return isWE && (t.type==='D'||t.type==='S'||t.type==='Z'||t.type==='N');
                  })
                );
                return runneriWeekend.length > 0 ? (
                  <div className="mx-4 mb-3 flex items-center gap-2 bg-amber-950/60 border border-amber-500/40 text-amber-300 text-[12px] font-semibold px-4 py-2 rounded-xl">
                    <AlertTriangle size={14}/>
                    {runneriWeekend.map(m=>m.nume.split(' ')[0]).join(', ')} — ore standard depășite (weekend)
                  </div>
                ) : null;
              })()}
              {/* Modal rezultate verificare */}
              {showVerificare && (
                <div className="mx-4 mb-3 bg-[#1c1c1e] border border-white/[0.1] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.07]">
                    <span className="text-[13px] font-bold text-white flex items-center gap-2">
                      <Check size={14} className="text-emerald-400"/> Verificare săptămâna {fmtDate(weekStart)} – {fmtDate(new Date(weekStart.getTime()+6*86400000))}
                    </span>
                    <button onClick={()=>setShowVerificare(false)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                      <X size={16}/>
                    </button>
                  </div>
                  <div className="p-3 space-y-1.5 max-h-60 overflow-y-auto">
                    {rezultateVerificare.map((r,i) => (
                      <div key={i} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12px]
                        ${r.tip==='ok' ? 'bg-emerald-950/40 text-emerald-300' :
                          r.tip==='err' ? 'bg-red-950/50 text-red-300' :
                          'bg-amber-950/40 text-amber-300'}`}>
                        <span className="flex-shrink-0 mt-0.5">
                          {r.tip==='ok' ? '✓' : r.tip==='err' ? '✗' : '⚠'}
                        </span>
                        <span>{r.mesaj}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab Calendar Lunar ── */}
          {activeTab==='luna'&&(
            <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
                <span className="font-semibold text-[12px] text-zinc-300">Calendar lunar</span>
                <div className="flex items-center gap-1.5">
                  <button onClick={()=>setLunaOffset(o=>o-1)} className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/[0.08] rounded-md text-zinc-400"><ChevronLeft size={13}/></button>
                  <span className="text-[12px] font-semibold text-zinc-300 min-w-[140px] text-center capitalize">{fmtMonth(lunaStart)}</span>
                  <button onClick={()=>setLunaOffset(o=>o+1)} className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/[0.08] rounded-md text-zinc-400"><ChevronRight size={13}/></button>
                </div>
              </div>
              <div className="overflow-x-auto p-3">
                <table className="w-full border-separate border-spacing-1 print-table table-fixed">
                  <thead>
                    <tr>
                      <th className="text-left text-[11px] font-semibold text-zinc-500 uppercase pl-2 pb-1 w-40">Angajat</th>
                      {zileLuna.map((d,i)=>(
                        <th key={i} className={`text-center text-[10px] font-semibold pb-1 w-9 ${isSarbatoare(d)?'text-amber-400':d.getDay()===0||d.getDay()===6?'text-zinc-500':'text-zinc-400'}`}>
                          {d.getDate()}<br/>
                          <span className="text-[8px] font-normal opacity-60">{DAY_SHORT[(d.getDay()+6)%7]}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayEchipaLuna.map((m,mi)=>(
                      <tr key={mi}>
                        <td className="pl-2 pr-2 py-1 overflow-hidden">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                              style={m.id===999
                                ? {background:'#f59e0b22',color:'#f59e0b',border:'1px solid #f59e0b44'}
                                : {background:AVATAR_COLORS[mi%5]+'22',color:AVATAR_COLORS[mi%5],border:`1px solid ${AVATAR_COLORS[mi%5]}44`}}>
                              {m.id===999?'SUP':m.nume.substring(0,2).toUpperCase()}
                            </div>
                            <span className="font-semibold text-[12px] leading-tight">{m.id===999?'Suplinitor':m.nume}</span>
                          </div>
                        </td>
                        {zileLuna.map((d,di)=>{
                          const t=getTuraW(d,m);
                          const sarb=isSarbatoare(d);
                          const baseType=t.type.replace('↔','');
                          const esteDeplasare = baseType==='B' && t.label!=='B';
                          const style=esteDeplasare ? 'bg-purple-950/50 text-purple-300 border border-purple-500/30' : SHIFT_STYLE[baseType]??SHIFT_STYLE.L;
                          return (
                            <td key={di} className="text-center">
                              <div className={`relative text-[10px] font-black py-1.5 rounded-lg overflow-hidden ${style} ${sarb&&!['L','CO','CM','AN'].includes(baseType)?'ring-1 ring-amber-400/50':''} print-${baseType}`} title={esteDeplasare?t.label:''}>
                                <span className={esteDeplasare?'block truncate px-0.5 text-[8px]':''}>{baseType==='L'?'':dispLabel(t.label)}</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Tab Statistici ── */}
          {activeTab==='stats'&&(
            <div className="space-y-4">
              <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
                  <span className="font-semibold text-[12px] text-zinc-300">Statistici lunare</span>
                  <span className="text-[11px] text-zinc-500">{fmtMonth(weekStart)}</span>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {displayEchipaLuna.map((m,i)=>{
                    const st=calcScor(m,weekStart);
                    const isSup = m.id===999;
                    if (isSup && st.ore===0) return null; // suplinitor fara ore nu apare
                    return (
                      <div key={i} className={`rounded-xl p-4 ${isSup?'bg-amber-950/20 border border-amber-500/20':'bg-black/20'}`}>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={isSup
                              ? {background:'#f59e0b22',color:'#f59e0b',border:'1px solid #f59e0b44'}
                              : {background:AVATAR_COLORS[i%5]+'22',color:AVATAR_COLORS[i%5],border:`1px solid ${AVATAR_COLORS[i%5]}44`}}>
                            {isSup?'SUP':m.nume.substring(0,2).toUpperCase()}
                          </div>
                          <span className="font-semibold text-[13px]">{isSup?'Suplinitor (Cta)':m.nume}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                          {[{v:`${st.ore}h`,l:'Ore',c:isSup?'text-amber-400':'text-[#60cdff]'},{v:st.zile,l:'Zile',c:isSup?'text-amber-400':'text-[#60cdff]'},{v:st.sarbLucrate,l:'Sărb.',c:'text-amber-400'}].map(({v,l,c})=>(
                            <div key={l} className="bg-black/30 rounded-lg py-1.5 text-center">
                              <div className={`text-[13px] font-bold ${c}`}>{v}</div>
                              <div className="text-[9px] text-zinc-500 mt-0.5">{l}</div>
                            </div>
                          ))}
                        </div>
                        {!isSup && (
                          <div className="grid grid-cols-3 gap-1.5">
                            {[{v:st.zileCM,l:'CM',c:'text-orange-400'},{v:st.zileAN,l:'Abs.N.',c:'text-red-400'},{v:m.zileCO,l:'CO răm.',c:'text-zinc-300'}].map(({v,l,c})=>(
                              <div key={l} className="bg-black/30 rounded-lg py-1.5 text-center">
                                <div className={`text-[13px] font-bold ${c}`}>{v}</div>
                                <div className="text-[9px] text-zinc-500 mt-0.5">{l}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Scale size={13} className="text-emerald-400"/>
                    <span className="font-semibold text-[12px] text-zinc-300">Raport de Echitate</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {([['luna','Lună'],['trimestru','Trimestru'],['an','An'],['custom','Custom']] as const).map(([k,l])=>(
                      <button key={k} onClick={()=>setEchitatePerioada(k)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${echitatePerioada===k?'bg-[#0078d4] text-white':'bg-black/20 text-zinc-400 hover:bg-black/30'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {echitatePerioada==='custom' && (
                  <div className="px-4 pt-3 flex items-center gap-2">
                    <input type="date" value={echitateCustomStart} onChange={e=>setEchitateCustomStart(e.target.value)} className={inputCls} />
                    <span className="text-zinc-600 text-[11px]">până la</span>
                    <input type="date" value={echitateCustomEnd} onChange={e=>setEchitateCustomEnd(e.target.value)} className={inputCls} />
                  </div>
                )}

                <div className="p-4">
                  <p className="text-[10px] text-zinc-600 mb-3">
                    {fmtDate(echitateInterval.start)} – {fmtDate(echitateInterval.end)} · ore, nopți (S), zile de weekend și sărbători lucrate, per angajat
                  </p>

                  {/* Grafic comparativ — bare orizontale suprapuse pentru ore totale */}
                  <div className="space-y-2.5 mb-4">
                    {echitateDate.map(({angajat,ore,nopti,weekendZile,sarbatoriLucrate})=>{
                      const maxOre = Math.max(...echitateDate.map(e=>e.ore), 1);
                      const idx = echipa.findIndex(e=>e.id===angajat.id);
                      const pct = Math.round((ore/maxOre)*100);
                      return (
                        <div key={angajat.id} className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                            style={{background:AVATAR_COLORS[idx%5]+'22',color:AVATAR_COLORS[idx%5]}}>
                            {angajat.nume.substring(0,2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-[12px]">{angajat.nume}</span>
                              <span className="text-[11px] text-[#60cdff] font-bold">{ore}h</span>
                            </div>
                            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-[#0078d4] to-[#60cdff] transition-all duration-700" style={{width:`${pct}%`}}/>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Tabel detaliat */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-zinc-500 border-b border-white/[0.07]">
                          <th className="text-left py-2 font-medium">Angajat</th>
                          <th className="text-center py-2 font-medium">Ore</th>
                          <th className="text-center py-2 font-medium">Nopți (S)</th>
                          <th className="text-center py-2 font-medium">Weekend</th>
                          <th className="text-center py-2 font-medium">Sărbători</th>
                        </tr>
                      </thead>
                      <tbody>
                        {echitateDate.map(({angajat,ore,nopti,weekendZile,sarbatoriLucrate})=>(
                          <tr key={angajat.id} className="border-b border-white/[0.04]">
                            <td className="py-2 font-medium">{angajat.nume}</td>
                            <td className="text-center py-2 text-[#60cdff] font-bold">{ore}h</td>
                            <td className="text-center py-2">{nopti}</td>
                            <td className="text-center py-2">{weekendZile}</td>
                            <td className="text-center py-2">{sarbatoriLucrate>0?<span className="text-amber-400 font-bold">{sarbatoriLucrate}</span>:0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button onClick={generateEchitatePDF}
                    className="mt-4 w-full flex items-center justify-center gap-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-[12px] font-semibold py-2.5 rounded-xl transition-all">
                    <FileText size={13}/> Exportă raport PDF
                  </button>
                </div>
              </div>

              {/* ── Prognoza Ore Suplimentare ── */}
              {prognozaSuplimentare.length > 0 && (
                <div className="bg-[#2c2c2e] border border-red-500/30 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/[0.07] flex items-center gap-2">
                    <AlertTriangle size={13} className="text-red-400"/>
                    <span className="font-semibold text-[12px] text-zinc-300">Prognoză depășiri ore — următoarele 6 săptămâni</span>
                  </div>
                  <div className="p-4 space-y-2">
                    <p className="text-[10px] text-zinc-600 mb-2">Art. 114 Codul Muncii — verifică din timp dacă rotația curentă duce la depășiri viitoare de 48h/săptămână</p>
                    {prognozaSuplimentare.map((r,i)=>(
                      <div key={i} className="flex items-center justify-between bg-red-950/20 border border-red-500/20 rounded-lg px-3.5 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-semibold text-[12px] text-zinc-200">{r.angajat}</span>
                          <span className="text-[10px] text-zinc-500">săptămâna {fmtDate(r.saptamanaStart)}</span>
                        </div>
                        <span className="text-[12px] font-bold text-red-400">{r.ore}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Tabel Ore & Suplimentare ── */}
              <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Clock size={13} className="text-[#60cdff]"/>
                    <span className="font-semibold text-[12px] text-zinc-300">Ore lucrate & Suplimentare</span>
                  </div>
                  <button onClick={generateOrePDF}
                    className="flex items-center gap-1.5 bg-[#0078d4]/20 hover:bg-[#0078d4]/30 border border-[#0078d4]/30 text-[#60cdff] text-[11px] font-semibold px-3 py-1 rounded-lg transition-all">
                    <FileDown size={11}/> Export PDF
                  </button>
                </div>
                <div className="p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-zinc-500 border-b border-white/[0.07]">
                          <th className="text-left py-2 font-medium">Angajat</th>
                          <th className="text-center py-2 font-medium">Ore săpt.</th>
                          <th className="text-center py-2 font-medium">Normă</th>
                          <th className="text-center py-2 font-medium">Supl. săpt.</th>
                          <th className="text-center py-2 font-medium">Ore lună</th>
                          <th className="text-center py-2 font-medium">Zile lucrate</th>
                          <th className="text-center py-2 font-medium">Supl. lună</th>
                          <th className="text-center py-2 font-medium">Depășire</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tabelOre.map((r, i) => (
                          <tr key={i} className={`border-b border-white/[0.04] ${r.depaseste ? 'bg-red-950/20' : ''}`}>
                            <td className="py-2 font-semibold">{r.angajat.nume}</td>
                            <td className="text-center py-2 text-[#60cdff] font-bold">{r.oreSapt}h</td>
                            <td className="text-center py-2 text-zinc-500">40h</td>
                            <td className={`text-center py-2 font-bold ${r.oreSuplSapt > 0 ? 'text-amber-400' : 'text-zinc-600'}`}>
                              {r.oreSuplSapt > 0 ? `+${r.oreSuplSapt}h` : '—'}
                            </td>
                            <td className="text-center py-2 text-[#60cdff] font-bold">{r.oreLuna}h</td>
                            <td className="text-center py-2">{r.zileLucrateLuna}</td>
                            <td className={`text-center py-2 font-bold ${r.oreSuplLuna > 0 ? 'text-amber-400' : 'text-zinc-600'}`}>
                              {r.oreSuplLuna > 0 ? `+${r.oreSuplLuna}h` : '—'}
                            </td>
                            <td className="text-center py-2">
                              {r.depaseste
                                ? <span className="bg-red-900/40 text-red-300 text-[10px] font-bold px-2 py-0.5 rounded-full">⚠ &gt;48h</span>
                                : <span className="text-zinc-600 text-[10px]">✓</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[9px] text-zinc-600 mt-3">
                    Normă săptămânală: 40h | Ore suplimentare = ore lucrate − 40h | Depășire legală: &gt;48h/săpt (Art. 114 Codul Muncii) | Săptămâna afișată: {fmtDate(weekStart)} – {fmtDate(new Date(weekStart.getTime()+6*86400000))}
                  </p>
                </div>
              </div>

              <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.07] flex items-center gap-2">
                  <Trophy size={13} className="text-amber-400"/>
                  <span className="font-semibold text-[12px] text-zinc-300">Clasament Performanță — {fmtMonth(weekStart)}</span>
                </div>
                <div className="p-4 space-y-2">
                  <p className="text-[10px] text-zinc-600 mb-3">Scor = ore lucrate + sărbători×16 − absențe nemotivate×40</p>
                  {clasament.map((m,rank)=>{
                    const max=clasament[0].scor||1;
                    const pct=Math.max(0,Math.round((m.scor/max)*100));
                    const medal=['🥇','🥈','🥉'][rank]||`#${rank+1}`;
                    const idx=echipa.findIndex(e=>e.id===m.id);
                    return (
                      <div key={m.id} className="flex items-center gap-3 bg-black/20 rounded-xl p-3">
                        <span className="text-[15px] w-6 text-center flex-shrink-0">{medal}</span>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                          style={{background:AVATAR_COLORS[idx%5]+'22',color:AVATAR_COLORS[idx%5]}}>
                          {m.nume.substring(0,2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-[12px]">{m.nume}</span>
                            <span className={`font-black text-[12px] ${m.scor>0?'text-[#60cdff]':m.scor<0?'text-red-400':'text-zinc-400'}`}>{m.scor}p</span>
                          </div>
                          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700"
                              style={{width:`${pct}%`,background:rank===0?'#ffd60a':rank===1?'#8e8e93':rank===2?'#cd7f32':'#60cdff'}}/>
                          </div>
                          <div className="flex gap-3 mt-1 text-[9px] text-zinc-600">
                            <span>{m.ore}h lucrate</span>
                            {m.sarbLucrate>0&&<span className="text-amber-500/70">+{m.sarbLucrate} sărb.</span>}
                            {m.zileAN>0&&<span className="text-red-500/70">−{m.zileAN} abs.n.</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Tab Swap ── */}
          {activeTab==='swap'&&(
            <div className="space-y-4">
              <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-4">
                  <ArrowLeftRight size={13} className="text-[#60cdff]"/>
                  <span className="font-semibold text-[12px] text-zinc-300">Înregistrare Swap Tură</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[{id:swAId,setId:setSwAId,data:swAData,setData:setSwAData,label:'Angajat A (dă tura)',col:'text-[#60cdff]',activeCls:'bg-sky-900/40 border-sky-500/50 text-sky-300'},
                    {id:swBId,setId:setSwBId,data:swBData,setData:setSwBData,label:'Angajat B (preia tura)',col:'text-purple-400',activeCls:'bg-purple-900/30 border-purple-500/50 text-purple-300'}
                  ].map((side,si)=>{
                    const angajat=echipa.find(m=>m.id===side.id);
                    const rawTura = angajat ? (isCTA(angajat) ? getTuraW(parseD(side.data), angajat) : getTuraBaza(parseD(side.data),angajat,echipa,suplinitorFinal)) : null;
                    const turaLabel = rawTura ? (rawTura.label==='D'?'Zi (8h)':rawTura.label==='S'?'Noapte (8h)':rawTura.label==='Z'?'Zi (12h)':rawTura.label==='N'?'Noapte (12h)':rawTura.label) : '—';
                    return (
                      <div key={si} className="bg-black/20 rounded-xl p-3 space-y-3">
                        <p className={`text-[11px] font-bold uppercase tracking-wider ${side.col}`}>{side.label}</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {echipa.map(m=>(
                            <button key={m.id} onClick={()=>side.setId(m.id)}
                              className={`py-1.5 rounded-lg text-[11px] font-medium border transition-all ${side.id===m.id?side.activeCls:'bg-white/[0.04] border-white/[0.07] text-zinc-400 hover:border-white/20'}`}>
                              {m.nume}
                            </button>
                          ))}
                        </div>
                        <input type="date" value={side.data} onChange={e=>side.setData(e.target.value)} className={inputCls}/>
                        <p className="text-[11px] text-zinc-500">Tură: <span className="font-bold text-white">{turaLabel}</span></p>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 space-y-2">
                  <input type="text" value={swNota} onChange={e=>setSwNota(e.target.value)} placeholder="Motiv (ex: nuntă, eveniment personal...)"
                    className={inputCls+' placeholder:text-zinc-700'}/>
                  {swAId===swBId && (
                    <p className="text-[10px] text-red-400 mb-2">Selectează doi angajați diferiți pentru schimb.</p>
                  )}
                  {(() => {
                    if (swAId===swBId) return null;
                    const a=echipa.find(m=>m.id===swAId), b=echipa.find(m=>m.id===swBId);
                    if (!a||!b) return null;
                    const turaA = a && isCTA(a) ? getTuraW(parseD(swAData),a) : (a ? getTuraBaza(parseD(swAData),a,echipa,suplinitorFinal) : null);
                    const turaB = b && isCTA(b) ? getTuraW(parseD(swBData),b) : (b ? getTuraBaza(parseD(swBData),b,echipa,suplinitorFinal) : null);
                    const eMuncaA = ['D','S','Z','N'].includes(turaA?.type||'');
                    const eMuncaB = ['D','S','Z','N'].includes(turaB?.type||'');
                    const problemaA = !eMuncaA;
                    const problemaB = !eMuncaB;
                    if (!problemaA && !problemaB) return null;
                    return (
                      <p className="text-[10px] text-red-400 mb-2">
                        {problemaA && `${a.nume} nu are tură de lucru pe ${fmtDate(parseD(swAData))} (${dispLabel(turaA.label)}). `}
                        {problemaB && `${b.nume} nu are tură de lucru pe ${fmtDate(parseD(swBData))} (${dispLabel(turaB.label)}). `}
                        Swap-ul nu poate fi creat — ar lăsa o zi fără acoperire reală.
                      </p>
                    );
                  })()}
                  <button onClick={adaugaSwap} disabled={swAId===swBId}
                    className="w-full bg-sky-900/30 hover:bg-sky-900/50 border border-sky-500/30 text-sky-300 font-semibold text-[12px] py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                    <ArrowLeftRight size={13}/> Înregistrează Swap
                  </button>
                </div>
              </div>
              {swapuri.length>0&&(
                <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/[0.07]">
                    <span className="font-semibold text-[12px] text-zinc-300">Swap-uri active ({swapuri.length})</span>
                  </div>
                  <div className="p-3 space-y-2">
                    {swapuri.map(sw=>{
                      const a=echipa.find(m=>m.id===sw.aId), b=echipa.find(m=>m.id===sw.bId);
                      const bal=calcBalanta(sw);
                      return (
                        <div key={sw.id} className="bg-black/20 rounded-xl p-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap text-[12px]">
                              <span className="font-semibold text-[#60cdff]">{a?.nume}</span>
                              <span className="text-zinc-600 text-[10px]">{sw.aData}</span>
                              <ArrowLeftRight size={10} className="text-zinc-500"/>
                              <span className="font-semibold text-purple-400">{b?.nume}</span>
                              <span className="text-zinc-600 text-[10px]">{sw.bData}</span>
                            </div>
                            <div className="flex gap-3 mt-0.5">
                              <span className={`text-[10px] font-medium ${bal.ok?'text-emerald-400':'text-amber-400'}`}>{bal.text}</span>
                              {sw.nota&&<span className="text-[10px] text-zinc-600 italic">"{sw.nota}"</span>}
                            </div>
                          </div>
                          <button onClick={()=>stergeSwap(sw.id)} className="text-zinc-600 hover:text-red-400 transition-colors"><X size={13}/></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab Istoric ── */}
          {activeTab==='log'&&(
            <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-[#60cdff]"/>
                  <span className="font-semibold text-[12px] text-zinc-300">Istoric modificări</span>
                </div>
                <button onClick={()=>{
                  if (!confirm('Sigur vrei să ștergi tot istoricul? Această acțiune nu poate fi anulată.')) return;
                  setLogRaw([]);
                  fetch('/api/istoric', { method: 'DELETE' }).catch(err => {
                    console.error('Eroare la stergerea istoricului din Supabase:', err);
                    incarcaTotul();
                  });
                }} className="text-[11px] text-zinc-600 hover:text-red-400 transition-colors">Șterge tot</button>
              </div>
              {log.length===0?(
                <div className="p-8 text-center text-zinc-600 text-[12px]">Nicio modificare înregistrată încă.</div>
              ):(
                <div className="divide-y divide-white/[0.04] max-h-[500px] overflow-y-auto">
                  {log.map((entry,i)=>(
                    <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                      <span className="text-[10px] text-zinc-600 font-mono whitespace-nowrap mt-0.5">{entry.ts}</span>
                      <span className="text-[12px] text-zinc-300">{entry.msg}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer legislativ ── */}
        <footer className="border-t border-white/[0.06] bg-black/20 px-6 py-3 no-print">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <span className="text-[10px] text-zinc-600 font-semibold">Referințe legislative:</span>
            {[
              {label:'Art. 145 — Durata concediului de odihnă', href:'https://codulmuncii.ro/art-145-durata-concediului-de-odihna'},
              {label:'Art. 125 — Definiția și durata muncii de noapte', href:'https://codulmuncii.ro/art-125-definitia-legala-si-durata-muncii-de-noapte'},
              {label:'Art. 114 — Durata maximă a timpului de muncă', href:'https://codulmuncii.ro/art-114-durata-maxima-a-timpului-de-munca'},
            ].map(({label,href})=>(
              <a key={href} href={href} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-[#60cdff] transition-colors">
                <ExternalLink size={9}/>{label}
              </a>
            ))}
          </div>
        </footer>

        {/* ── Modal Matrice de calificare — cine poate acoperi unde ── */}
        {showMatrice && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print" onClick={()=>setShowMatrice(false)}>
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] flex-shrink-0">
                <span className="font-bold text-[14px]">Matrice de calificare</span>
                <button onClick={()=>setShowMatrice(false)} className="w-7 h-7 flex items-center justify-center bg-white/[0.07] hover:bg-white/10 text-zinc-400 rounded-md"><X size={14}/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <p className="text-[11px] text-zinc-500 mb-3">Cine poate acoperi unde — regula actuală: doar runnerii CTA pot acoperi crize la PLO (niciodată invers).</p>
                <input
                  type="text"
                  value={cautareMatrice}
                  onChange={e=>setCautareMatrice(e.target.value)}
                  placeholder="Caută după nume..."
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-teal-500/50 transition-all mb-4"
                />
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] text-zinc-500 uppercase tracking-wider border-b border-white/[0.08]">
                      <th className="pb-2 font-semibold">Nume</th>
                      <th className="pb-2 font-semibold">Locație</th>
                      <th className="pb-2 font-semibold">Tip</th>
                      <th className="pb-2 font-semibold">Poate acoperi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {echipa.filter(m => m.nume.toLowerCase().includes(cautareMatrice.toLowerCase())).sort((a,b)=>{
                      const locA=(a.locatieId??1), locB=(b.locatieId??1);
                      if (locA!==locB) return locA-locB;
                      return (a.tip==='runner'?0:1)-(b.tip==='runner'?0:1);
                    }).map(m=>{
                      const loc = (m.locatieId??1)===2 ? 'CTA' : 'PLO';
                      const tipLabel = m.tip==='runner' ? 'Runner' : loc==='CTA' ? 'Fix (Z/N)' : 'Fix (Z/N, 8h)';
                      const poateAcoperi = m.tip==='runner'
                        ? 'PLO — Plan de Criză (vizitator Duminica)'
                        : '—';
                      const ocupat = m.tip==='runner' ? runnerCicluOverride[m.id] : null;
                      return (
                        <tr key={m.id} className="border-b border-white/[0.04]">
                          <td className="py-2 font-semibold text-zinc-200">{m.nume}</td>
                          <td className="py-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${loc==='CTA'?'bg-amber-950/40 text-amber-300':'bg-sky-950/40 text-sky-300'}`}>{loc==='CTA'?'⚓ CTA':'🏭 PLO'}</span>
                          </td>
                          <td className="py-2 text-zinc-400">{tipLabel}</td>
                          <td className="py-2 text-zinc-400">
                            {poateAcoperi}
                            {ocupat && <span className="block text-[10px] text-amber-400/80 mt-0.5">ocupat {ocupat.perioadaStart} → {ocupat.perioadaSfarsit}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Personal — adauga / inlocuieste / dezactiveaza ── */}
        {showPersonal && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print" onClick={()=>setShowPersonal(false)}>
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-2xl" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] flex-shrink-0">
                <span className="font-bold text-[14px]">
                  {personalMod==='lista' ? 'Personal' : personalMod==='adauga' ? 'Angajat nou' : `Înlocuiește pe ${personalTarget?.nume}`}
                </span>
                <button onClick={()=>setShowPersonal(false)} className="w-7 h-7 flex items-center justify-center bg-white/[0.07] hover:bg-white/10 text-zinc-400 rounded-md"><X size={14}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {personalRezultat && (
                  <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-4 mb-4">
                    <p className="text-[12px] font-bold text-emerald-300 mb-2">✓ {personalRezultat.mesaj}</p>
                    {personalRezultat.email !== '—' && (
                      <p className="text-[11px] text-emerald-400/80">
                        Login: <b>{personalRezultat.email}</b> — parolă: <b>{personalRezultat.parola}</b>
                      </p>
                    )}
                    <button onClick={()=>{ setPersonalRezultat(null); setPersonalMod('lista'); }} className="mt-3 text-[11px] font-semibold text-emerald-300 underline">
                      Înapoi la listă
                    </button>
                  </div>
                )}

                {personalMod==='lista' && !personalRezultat && (
                  <>
                    <button onClick={()=>{ setPersonalMod('adauga'); setPersonalForm({nume:'',locatieId:1,tip:'fix',dataStartCiclu:'',creeazaCont:true}); }}
                      className="w-full flex items-center justify-center gap-2 bg-cyan-900/40 border border-cyan-500/30 text-cyan-300 text-[12px] font-semibold py-2.5 rounded-lg hover:bg-cyan-800/50 transition-all mb-4">
                      <Plus size={14}/> Adaugă angajat nou
                    </button>
                    <div className="space-y-2">
                      {echipa.filter(m=>m.id!==999).map(m => (
                        <div key={m.id} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2.5">
                          <div>
                            <span className="text-[12px] font-semibold text-zinc-200">{m.nume}</span>
                            <span className="text-[10px] text-zinc-500 ml-2">{isCTA(m) ? (m.tip==='runner'?'CTA · runner':'CTA · fix') : 'PLO'}</span>
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={()=>{ setPersonalTarget(m); setPersonalMod('inlocuieste'); setPersonalForm({nume:'',locatieId:m.locatieId??1,tip:m.tip??'fix',dataStartCiclu:'',creeazaCont:true}); }}
                              className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-900/40 border border-amber-500/30 text-amber-300 hover:bg-amber-800/50 transition-all">
                              Înlocuiește
                            </button>
                            <button onClick={()=>dezactiveazaAngajat(m)}
                              className="text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-red-900/30 border border-red-500/25 text-red-300 hover:bg-red-800/40 transition-all">
                              Dezactivează
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {personalMod==='adauga' && !personalRezultat && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wide">Nume complet</label>
                      <input type="text" value={personalForm.nume} onChange={e=>setPersonalForm(p=>({...p,nume:e.target.value}))}
                        placeholder="ex. Ion Popescu"
                        className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-cyan-500/50 mt-1"/>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wide">Locație</label>
                      <div className="flex gap-2 mt-1">
                        <button onClick={()=>setPersonalForm(p=>({...p,locatieId:1}))} className={`flex-1 py-2 rounded-lg text-[12px] font-semibold border ${personalForm.locatieId===1?'bg-sky-900/50 border-sky-500/40 text-sky-300':'bg-white/[0.03] border-white/[0.08] text-zinc-400'}`}>🏭 PLO</button>
                        <button onClick={()=>setPersonalForm(p=>({...p,locatieId:2}))} className={`flex-1 py-2 rounded-lg text-[12px] font-semibold border ${personalForm.locatieId===2?'bg-amber-900/50 border-amber-500/40 text-amber-300':'bg-white/[0.03] border-white/[0.08] text-zinc-400'}`}>⚓ CTA</button>
                      </div>
                    </div>
                    {personalForm.locatieId===2 && (
                      <>
                        <div>
                          <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wide">Tip</label>
                          <div className="flex gap-2 mt-1">
                            <button onClick={()=>setPersonalForm(p=>({...p,tip:'fix'}))} className={`flex-1 py-2 rounded-lg text-[12px] font-semibold border ${personalForm.tip==='fix'?'bg-amber-900/50 border-amber-500/40 text-amber-300':'bg-white/[0.03] border-white/[0.08] text-zinc-400'}`}>Fix (ciclu Z/N)</button>
                            <button onClick={()=>setPersonalForm(p=>({...p,tip:'runner'}))} className={`flex-1 py-2 rounded-lg text-[12px] font-semibold border ${personalForm.tip==='runner'?'bg-orange-900/50 border-orange-500/40 text-orange-300':'bg-white/[0.03] border-white/[0.08] text-zinc-400'}`}>Runner</button>
                          </div>
                        </div>
                        {personalForm.tip==='fix' && (
                          <div>
                            <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wide">Dată start ciclu (ancorare Z/N/L/L)</label>
                            <input type="date" value={personalForm.dataStartCiclu} onChange={e=>setPersonalForm(p=>({...p,dataStartCiclu:e.target.value}))}
                              className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-amber-500/50 mt-1"/>
                            <p className="text-[9px] text-zinc-600 mt-1">⚠ Verifică în Matrice că nu se suprapune cu faza altui coleg fix.</p>
                          </div>
                        )}
                      </>
                    )}
                    <label className="flex items-center gap-2 mt-2">
                      <input type="checkbox" checked={personalForm.creeazaCont} onChange={e=>setPersonalForm(p=>({...p,creeazaCont:e.target.checked}))}/>
                      <span className="text-[11px] text-zinc-400">Creează automat cont de login (email + parolă)</span>
                    </label>
                    <button onClick={adaugaAngajatNou} disabled={!personalForm.nume.trim() || personalLoading}
                      className="w-full bg-cyan-900/50 border border-cyan-500/40 text-cyan-300 text-[12px] font-semibold py-2.5 rounded-lg hover:bg-cyan-800/60 transition-all disabled:opacity-40 mt-2">
                      {personalLoading ? 'Se salvează...' : 'Adaugă angajat'}
                    </button>
                    <button onClick={()=>setPersonalMod('lista')} className="w-full text-[11px] text-zinc-500 py-1">← Înapoi</button>
                  </div>
                )}

                {personalMod==='inlocuieste' && personalTarget && !personalRezultat && (
                  <div className="space-y-3">
                    <div className="bg-amber-950/20 border border-amber-500/20 rounded-lg p-3 text-[11px] text-amber-300/90">
                      Preia automat: aceeași poziție din rotație, aceeași locație ({isCTA(personalTarget)?'CTA':'PLO'}){isCTA(personalTarget)&&personalTarget.dataStartCiclu?`, aceeași fază de ciclu (${personalTarget.dataStartCiclu})`:''}.
                      {personalTarget.nume} rămâne în istoric, dar dispare din echipă și nu se mai poate loga.
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wide">Numele noului angajat</label>
                      <input type="text" value={personalForm.nume} onChange={e=>setPersonalForm(p=>({...p,nume:e.target.value}))}
                        placeholder="ex. Ion Popescu"
                        className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-amber-500/50 mt-1"/>
                    </div>
                    <label className="flex items-center gap-2 mt-2">
                      <input type="checkbox" checked={personalForm.creeazaCont} onChange={e=>setPersonalForm(p=>({...p,creeazaCont:e.target.checked}))}/>
                      <span className="text-[11px] text-zinc-400">Creează automat cont de login (email + parolă)</span>
                    </label>
                    <button onClick={inlocuiesteAngajat} disabled={!personalForm.nume.trim() || personalLoading}
                      className="w-full bg-amber-900/50 border border-amber-500/40 text-amber-300 text-[12px] font-semibold py-2.5 rounded-lg hover:bg-amber-800/60 transition-all disabled:opacity-40 mt-2">
                      {personalLoading ? 'Se salvează...' : `Înlocuiește pe ${personalTarget.nume}`}
                    </button>
                    <button onClick={()=>setPersonalMod('lista')} className="w-full text-[11px] text-zinc-500 py-1">← Înapoi</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Certificări / calificări ── */}
        {showCertificari && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print" onClick={()=>setShowCertificari(false)}>
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] flex-shrink-0">
                <span className="font-bold text-[14px]">Certificări / calificări</span>
                <button onClick={()=>setShowCertificari(false)} className="w-7 h-7 flex items-center justify-center bg-white/[0.07] hover:bg-white/10 text-zinc-400 rounded-md"><X size={14}/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <input
                  type="text"
                  value={cautareCert}
                  onChange={e=>setCautareCert(e.target.value)}
                  placeholder="Caută după nume..."
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-orange-500/50 transition-all"
                />
                {echipa.filter(m => m.nume.toLowerCase().includes(cautareCert.toLowerCase())).map(m => {
                  const certificatele = certificari.filter(c => c.angajat_id === m.uuid);
                  const azi = fmtDateInput(new Date());
                  const formCurent = certNouForm[m.id] ?? { nume: '', dataExpirare: '' };
                  return (
                    <div key={m.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                      <p className="font-bold text-[13px] text-zinc-200 mb-2">{m.nume}</p>
                      {certificatele.length > 0 && (
                        <div className="space-y-1.5 mb-3">
                          {certificatele.map(c => {
                            const expirat = c.data_expirare && c.data_expirare < azi;
                            const expiraCurand = c.data_expirare && !expirat && c.data_expirare < fmtDateInput(new Date(Date.now()+60*86400000));
                            return (
                              <div key={c.id} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] ${expirat?'bg-red-950/30 border border-red-500/20':expiraCurand?'bg-amber-950/30 border border-amber-500/20':'bg-white/[0.02]'}`}>
                                <span className={expirat?'text-red-300':expiraCurand?'text-amber-300':'text-zinc-300'}>
                                  {c.nume_certificat}{c.data_expirare && ` — exp. ${fmtDate(parseD(c.data_expirare))}`}{expirat?' (EXPIRAT)':''}
                                </span>
                                <button onClick={()=>stergeCertificat(c.id, c.nume_certificat)} className="text-zinc-500 hover:text-red-400 flex-shrink-0 ml-2">✕</button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <input type="text" placeholder="ex. High Voltage, ADR, etc." value={formCurent.nume}
                          onChange={e=>setCertNouForm(prev=>({...prev, [m.id]: {...formCurent, nume: e.target.value}}))}
                          className="flex-1 bg-black/40 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-orange-500/50"/>
                        <input type="date" value={formCurent.dataExpirare}
                          onChange={e=>setCertNouForm(prev=>({...prev, [m.id]: {...formCurent, dataExpirare: e.target.value}}))}
                          className="bg-black/40 border border-white/[0.08] rounded-lg px-2 py-1.5 text-[11px] text-white outline-none focus:border-orange-500/50"/>
                        <button onClick={()=>adaugaCertificat(m, formCurent.nume, formCurent.dataExpirare)}
                          disabled={!formCurent.nume.trim()}
                          className="flex-shrink-0 bg-orange-900/50 border border-orange-500/40 text-orange-300 text-[11px] font-semibold px-3 py-1.5 rounded-lg hover:bg-orange-800/60 transition-all disabled:opacity-30">
                          + Adaugă
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Analiză Termen Lung ── */}
        {showAnalizaTermenLung && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print" onClick={()=>setShowAnalizaTermenLung(false)}>
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] flex-shrink-0">
                <div>
                  <span className="font-bold text-[14px]">Analiză Termen Lung — {locatieActiva}</span>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Tendințe pe ultimele luni, nu doar luna curentă</p>
                </div>
                <div className="flex items-center gap-2">
                  <select value={analizaLunile} onChange={e=>setAnalizaLunile(Number(e.target.value))}
                    className="bg-[#1c1c1e] border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 outline-none cursor-pointer">
                    <option value={3}>Ultimele 3 luni</option>
                    <option value={6}>Ultimele 6 luni</option>
                    <option value={12}>Ultimele 12 luni</option>
                  </select>
                  <button onClick={()=>setShowAnalizaTermenLung(false)} className="w-7 h-7 flex items-center justify-center bg-white/[0.07] hover:bg-white/10 text-zinc-400 rounded-md"><X size={14}/></button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {(() => {
                  const echipaAnaliza = locatieActiva === 'CTA' ? toataEchipaCTA.filter(m=>m.tip!=='runner') : echipaPLO;
                  const azi = new Date();
                  const dataStart = new Date(azi.getFullYear(), azi.getMonth() - analizaLunile, 1);
                  const dataEnd = new Date(azi.getFullYear(), azi.getMonth(), 0);

                  const randuri = echipaAnaliza.map(m => {
                    let oreTotale = 0, zileCM = 0, zileCOfolosite = 0;
                    const oreSaptamana: Record<string, number> = {};
                    const zileCOPeLuna: Record<number, number> = {};

                    for (let d = new Date(dataStart); d <= dataEnd; d = new Date(d.getTime()+86400000)) {
                      const t = getTuraW(d, m);
                      const oreZiua = (t.type==='Z'||t.type==='N') ? 12 : (['D','S','R','B','PLO','DISP'].includes(t.type) ? 8 : 0);
                      if (oreZiua > 0) {
                        oreTotale += oreZiua;
                        const luniStr = fmtDateInput(getMonday(d));
                        oreSaptamana[luniStr] = (oreSaptamana[luniStr] ?? 0) + oreZiua;
                      } else if (t.type === 'CM') zileCM++;
                      else if (t.type === 'CO') {
                        zileCOfolosite++;
                        zileCOPeLuna[d.getMonth()] = (zileCOPeLuna[d.getMonth()] ?? 0) + 1;
                      }
                    }

                    const saptamani = Object.values(oreSaptamana);
                    const saptamaniLa48 = saptamani.filter(o => o >= 48).length;
                    const mediaOreSapt = saptamani.length > 0 ? Math.round(oreTotale / saptamani.length) : 0;
                    const lunaFrecventaCO = Object.entries(zileCOPeLuna).sort((a,b)=>b[1]-a[1])[0];
                    const NUME_LUNI = ['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec'];

                    return {
                      nume: m.nume, oreTotale, mediaOreSapt, saptamaniLa48, zileCM, zileCOfolosite,
                      lunaFrecventaCO: lunaFrecventaCO ? `${NUME_LUNI[Number(lunaFrecventaCO[0])]} (${lunaFrecventaCO[1]}z)` : '—',
                    };
                  });

                  return (
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-left text-[10px] text-zinc-500 uppercase tracking-wider border-b border-white/[0.08]">
                          <th className="pb-2 font-semibold">Angajat</th>
                          <th className="pb-2 font-semibold text-center">Ore totale</th>
                          <th className="pb-2 font-semibold text-center">Medie ore/săpt.</th>
                          <th className="pb-2 font-semibold text-center">Săpt. la 48h</th>
                          <th className="pb-2 font-semibold text-center">Zile CM</th>
                          <th className="pb-2 font-semibold text-center">Zile CO folosite</th>
                          <th className="pb-2 font-semibold">Luna preferată de CO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {randuri.sort((a,b)=>b.saptamaniLa48-a.saptamaniLa48).map((r,i) => (
                          <tr key={i} className="border-b border-white/[0.04]">
                            <td className="py-2.5 font-semibold text-zinc-200">{r.nume}</td>
                            <td className="py-2.5 text-center text-zinc-400">{r.oreTotale}h</td>
                            <td className="py-2.5 text-center text-zinc-400">{r.mediaOreSapt}h</td>
                            <td className={`py-2.5 text-center font-bold ${r.saptamaniLa48>4?'text-red-400':r.saptamaniLa48>0?'text-amber-400':'text-zinc-500'}`}>{r.saptamaniLa48}</td>
                            <td className={`py-2.5 text-center ${r.zileCM>10?'text-orange-400 font-bold':'text-zinc-400'}`}>{r.zileCM}</td>
                            <td className="py-2.5 text-center text-zinc-400">{r.zileCOfolosite}</td>
                            <td className="py-2.5 text-zinc-500">{r.lunaFrecventaCO}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── Modal CO ── */}
        {showCO&&(
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print">
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] flex-shrink-0">
                <span className="font-bold text-[14px]">Planificare Concedii</span>
                <button onClick={()=>setShowCO(false)} className="w-6 h-6 flex items-center justify-center bg-white/[0.07] hover:bg-rose-900/50 text-zinc-400 hover:text-rose-300 rounded-md transition-all"><X size={14}/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                <input
                  type="text"
                  value={cautareCO}
                  onChange={e=>setCautareCO(e.target.value)}
                  placeholder="Caută după nume..."
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-sky-500/50 transition-all"
                />
                {/* Vedere combinata, cronologica — cine e plecat unde, din ambele locatii deodata */}
                {(() => {
                  const azi = new Date(); azi.setHours(0,0,0,0);
                  const toate = echipa.flatMap(m => m.concedii
                    .filter(c => parseD(c.e) >= azi) // doar active/viitoare
                    .map(c => ({ m, c }))
                  ).sort((a,b) => parseD(a.c.s).getTime() - parseD(b.c.s).getTime());
                  if (toate.length === 0) return null;
                  return (
                    <div>
                      <p className="text-[11px] font-black text-teal-400 uppercase tracking-widest mb-3 pb-1 border-b border-teal-500/20">Cronologic — toate locațiile</p>
                      <div className="flex flex-wrap gap-1.5">
                        {toate.map(({m,c},idx) => {
                          const loc = isCTA(m) ? 'CTA' : 'PLO';
                          const activ = parseD(c.s) <= azi && parseD(c.e) >= azi;
                          return (
                            <span key={idx} className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full border ${activ ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-white/[0.03] border-white/[0.08] text-zinc-400'}`}>
                              <span className={`text-[9px] font-bold px-1 rounded ${loc==='CTA'?'bg-amber-950/50 text-amber-400':'bg-sky-950/50 text-sky-400'}`}>{loc}</span>
                              {m.nume.split(' ')[0]} · {c.n}
                              {activ && <span className="text-emerald-400">●</span>}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {[{label:'PLO', filtru:(m:Angajat)=>!isCTA(m)}, {label:'CTA', filtru:(m:Angajat)=>isCTA(m)}].map(({label,filtru}) => {
                  const membriGrup = echipa.map((m,i)=>({m,i})).filter(x=>filtru(x.m) && x.m.nume.toLowerCase().includes(cautareCO.toLowerCase()));
                  if (membriGrup.length===0) return null;
                  return (
                    <div key={label}>
                      <p className="text-[11px] font-black text-sky-500 uppercase tracking-widest mb-3 pb-1 border-b border-sky-500/20">{label}</p>
                      <div className="space-y-6">
                        {membriGrup.map(({m,i})=>(
                          <div key={i}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-bold text-[13px]" style={{color:AVATAR_COLORS[i%5]}}>{m.nume}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-zinc-500">zile rămase:</span>
                                <input type="number" min={0} value={m.zileCO}
                                  onChange={e => {
                                    const nou = Math.max(0, Number(e.target.value) || 0);
                                    setEchipa(prev => prev.map((a,ai) => ai!==i ? a : {...a, zileCO: nou}));
                                  }}
                                  onBlur={e => {
                                    const nou = Math.max(0, Number(e.target.value) || 0);
                                    if (m.uuid) apiActualizeazaAngajat(m.uuid, { zile_co: nou }).catch(err => console.error('Eroare la salvarea zilelor CO:', err));
                                  }}
                                  className="w-14 bg-black/40 border border-white/[0.08] rounded-md px-1.5 py-0.5 text-[11px] text-white text-center outline-none focus:border-sky-500/50"
                                />
                              </div>
                            </div>
                            {(() => {
                              const azi = fmtDateInput(new Date());
                              const areReportate = (m.zileCOReportate ?? 0) > 0;
                              const expiraCurand = areReportate && m.zileCOReportateExpira && m.zileCOReportateExpira < fmtDateInput(new Date(Date.now()+60*86400000));
                              const expirat = areReportate && m.zileCOReportateExpira && m.zileCOReportateExpira < azi;
                              return (
                                <div className={`flex items-center justify-between mb-2 px-2 py-1.5 rounded-lg ${expirat?'bg-red-950/30 border border-red-500/20':expiraCurand?'bg-amber-950/30 border border-amber-500/20':'bg-white/[0.02]'}`}>
                                  <span className="text-[10px] text-zinc-500">
                                    {expirat ? '⚠️ reportate expirate, nefolosite:' : expiraCurand ? '⚠️ reportate — expiră curând:' : 'zile reportate (din anii trecuți):'}
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    <input type="number" min={0} value={m.zileCOReportate ?? 0}
                                      onChange={e => {
                                        const nou = Math.max(0, Number(e.target.value) || 0);
                                        setEchipa(prev => prev.map((a,ai) => ai!==i ? a : {...a, zileCOReportate: nou}));
                                      }}
                                      onBlur={e => {
                                        const nou = Math.max(0, Number(e.target.value) || 0);
                                        if (m.uuid) apiActualizeazaAngajat(m.uuid, { zile_co_reportate: nou }).catch(err => console.error('Eroare la salvarea zilelor reportate:', err));
                                      }}
                                      className="w-12 bg-black/40 border border-white/[0.08] rounded-md px-1 py-0.5 text-[10px] text-white text-center outline-none focus:border-amber-500/50"
                                    />
                                    <span className="text-[9px] text-zinc-600">exp.</span>
                                    <input type="date" value={m.zileCOReportateExpira ?? ''}
                                      onChange={e => {
                                        const nou = e.target.value || null;
                                        setEchipa(prev => prev.map((a,ai) => ai!==i ? a : {...a, zileCOReportateExpira: nou}));
                                        if (m.uuid) apiActualizeazaAngajat(m.uuid, { zile_co_reportate_expira: nou }).catch(err => console.error('Eroare la salvarea datei de expirare:', err));
                                      }}
                                      className="bg-black/40 border border-white/[0.08] rounded-md px-1 py-0.5 text-[10px] text-white outline-none focus:border-amber-500/50"
                                    />
                                  </div>
                                </div>
                              );
                            })()}
                            {m.concedii.length>0&&(
                              <div className="flex flex-wrap gap-1.5 mb-3">
                                {m.concedii.map((c,ci)=>(
                                  <div key={ci} className="flex flex-col gap-1">
                                    <span className="flex items-center gap-1 bg-rose-950/40 border border-rose-500/25 text-rose-400 text-[10px] px-2 py-0.5 rounded-full">
                                      {c.n}<button onClick={()=>stergeConcediu(i,ci)} className="ml-1 leading-none hover:text-rose-200">×</button>
                                    </span>
                                    {/* Dropdown runner — doar pentru CTA */}
                                    {isCTA(m) && (
                                      <div className="flex items-center gap-1.5 ml-1">
                                        <span className="text-[9px] text-zinc-600 uppercase tracking-wider">Runner:</span>
                                        <select
                                          value={runnerAsignat[`${m.id}_${c.s}`] ?? ''}
                                          onChange={e => {
                                            const val = e.target.value ? Number(e.target.value) : null;
                                            const runnerAnteriorAsignat = runnerAsignat[`${m.id}_${c.s}`];
                                            setRunnerAsignat(prev => ({...prev, [`${m.id}_${c.s}`]: val}));
                                            if (val !== null) {
                                              const dataStartAbsent = m.dataStartCiclu ?? c.s;

                                              // Extindem perioada sa includa Sa/Du adiacente (angajatul lipseste fizic)
                                              const sfarsitCO = new Date(c.e + 'T00:00:00');
                                              let sfarsitExtins = new Date(sfarsitCO);
                                              // Extindere identica cu regula reala din inCO: doar Vineri/Sambata
                                              // extind spre Duminica. Luni-Joi NU extind (revine normal a doua zi).
                                              // Extindere identica cu regula reala din inCO: Vineri extinde mereu spre
                                              // Duminica. Sambata extinde DOAR daca Vinerea dinainte e si ea in concediu.
                                              if (sfarsitCO.getDay() === 5) sfarsitExtins = new Date(sfarsitCO.getTime() + 2*86400000);
                                              else if (sfarsitCO.getDay() === 6) {
                                                const vineriDinainte = new Date(sfarsitCO.getTime() - 86400000);
                                                if (vineriDinainte >= new Date(c.s + 'T00:00:00')) sfarsitExtins = new Date(sfarsitCO.getTime() + 1*86400000);
                                              }
                                              const perioadaSfarsitExtins = fmtDateInput(sfarsitExtins);

                                              setRunnerAsignat(prev => ({...prev, [`${m.id}_${c.s}`]: val}));
                                              setRunnerCicluOverride(prev => ({
                                                ...prev,
                                                [val]: {
                                                  dataStartCiclu: dataStartAbsent,
                                                  perioadaStart: c.s,
                                                  perioadaSfarsit: perioadaSfarsitExtins,
                                                }
                                              }));
                                              setRunneriActivi(prev => { const n=new Set(prev); n.delete(val); return n; });
                                              addLog(`Runner ${echipa.find(r=>r.id===val)?.nume} asignat → acoperire ${c.s} – ${perioadaSfarsitExtins}`);
                                              fetch('/api/runner-alocari', {
                                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                  runner_pozitie: val, angajat_acoperit_pozitie: m.id, angajat_acoperit_uuid: m.uuid,
                                                  data_start_ciclu: dataStartAbsent, perioada_start: c.s, perioada_sfarsit: perioadaSfarsitExtins,
                                                }),
                                              }).catch(err => console.error('Eroare salvare alocare runner:', err));
                                            } else {
                                              setRunnerAsignat(prev => ({...prev, [`${m.id}_${c.s}`]: null}));
                                              if (runnerAnteriorAsignat != null) {
                                                setRunnerCicluOverride(prev => { const n={...prev}; delete n[runnerAnteriorAsignat]; return n; });
                                                fetch(`/api/runner-alocari?runner_pozitie=${runnerAnteriorAsignat}`, { method: 'DELETE' }).catch(err => console.error('Eroare eliberare runner:', err));
                                              }
                                            }
                                          }}
                                          className="bg-[#1c1c1e] border border-white/10 rounded-lg px-2 py-0.5 text-[10px] text-zinc-300 outline-none cursor-pointer"
                                        >
                                          <option value="">— Fără runner —</option>
                                          {toataEchipaCTA.filter(r => r.tip==='runner').map(r => (
                                            <option key={r.id} value={r.id}>{r.nume}</option>
                                          ))}
                                        </select>
                                        {runnerAsignat[`${m.id}_${c.s}`] && (
                                          <span className="text-[9px] text-amber-400">✓ Asignat</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {/* Adaugare concediu — foloseste EXACT acelasi popup ca butonul rapid de pe grila
                                principala (cu alegere de tip CO/CM/AN, date, si runner manual/automat),
                                ca sa nu existe doua fluxuri diferite care pot ajunge sa se comporte diferit. */}
                            <button
                              onClick={() => deschidePopupAbsenta(m)}
                              className="w-full flex items-center justify-center gap-1.5 bg-sky-900/30 border border-sky-500/25 text-sky-300 text-[11px] font-semibold py-2 rounded-lg hover:bg-sky-800/40 transition-all"
                            >
                              + Adaugă concediu / CM / AN
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Plan Criză ── */}
        {showPlanCriza && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={()=>setShowPlanCriza(false)}>
            <div className="bg-[#1c1c1e] border border-white/[0.09] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e=>e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-white/[0.07] flex items-center justify-between sticky top-0 bg-[#1c1c1e] z-10">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-red-400"/>
                  <span className="font-bold text-[14px]">Plan de Criză — Distribuire Optimă</span>
                </div>
                <button onClick={()=>setShowPlanCriza(false)} className="w-7 h-7 flex items-center justify-center bg-white/[0.07] hover:bg-white/10 text-zinc-400 rounded-md"><X size={14}/></button>
              </div>

              {/* Selector perioadă criză — doua optiuni clare: accept automat, sau introduc manual */}
              <div className="px-6 py-4 border-b border-white/[0.07] space-y-2.5">

                {/* Linia 1: accept perioada detectata automat */}
                <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  modCrizaPerioada==='auto' ? 'bg-red-950/30 border-red-500/40' : 'bg-white/[0.02] border-white/[0.07] hover:bg-white/[0.04]'
                } ${intervaleCrizaPLO.length===0 ? 'opacity-50 pointer-events-none' : ''}`}>
                  <input type="radio" checked={modCrizaPerioada==='auto'} onChange={()=>{
                    setModCrizaPerioada('auto');
                    if (intervaleCrizaPLO.length>0) {
                      setPlanCrizaStart(fmtDateInput(intervaleCrizaPLO[0].start));
                      setPlanCrizaEnd(fmtDateInput(intervaleCrizaPLO[0].end));
                      setPlanCriza(null);
                    }
                  }} className="mt-0.5 accent-red-500"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-zinc-200">
                      {intervaleCrizaPLO.length>0
                        ? <>Confirm criza detectată automat: <span className="text-red-300">{fmtDate(intervaleCrizaPLO[0].start)} → {fmtDate(intervaleCrizaPLO[0].end)}</span></>
                        : <span className="text-zinc-500">Nicio criză detectată automat în următoarele 90 de zile</span>}
                    </p>
                    {intervaleCrizaPLO.length>0 && (
                      <p className="text-[10px] text-zinc-500 mt-0.5">minim {intervaleCrizaPLO[0].minActivi} activi în această perioadă{intervaleCrizaPLO[0].critic?' — CRITIC chiar și cu Suplinitor':''}</p>
                    )}
                  </div>
                </label>

                {/* Linia 2: introduc perioada manual */}
                <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  modCrizaPerioada==='manual' ? 'bg-red-950/30 border-red-500/40' : 'bg-white/[0.02] border-white/[0.07] hover:bg-white/[0.04]'
                }`}>
                  <input type="radio" checked={modCrizaPerioada==='manual'} onChange={()=>setModCrizaPerioada('manual')} className="mt-0.5 accent-red-500"/>
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-[12px] font-semibold text-zinc-200">Introduc perioada manual</p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-zinc-400 whitespace-nowrap font-semibold">Start:</label>
                        <input type="date" value={planCrizaStart} disabled={modCrizaPerioada!=='manual'}
                          onChange={e => { setModCrizaPerioada('manual'); setPlanCrizaStart(e.target.value); setPlanCriza(null); }}
                          className="bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-[12px] text-white outline-none focus:border-red-500/50 transition-all disabled:opacity-40"/>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-zinc-400 whitespace-nowrap font-semibold">End:</label>
                        <input type="date" value={planCrizaEnd} disabled={modCrizaPerioada!=='manual'}
                          onChange={e => { setModCrizaPerioada('manual'); setPlanCrizaEnd(e.target.value); setPlanCriza(null); }}
                          min={planCrizaStart}
                          className="bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-[12px] text-white outline-none focus:border-red-500/50 transition-all disabled:opacity-40"/>
                      </div>
                    </div>
                  </div>
                </label>

                <button onClick={()=>{
                  const p = genereazaPlanCriza(echipa, planCrizaStart, planCrizaSimConcedii, planCrizaIssues, planCrizaEnd || undefined);
                  if(p) setPlanCriza(p);
                }} className="w-full bg-red-900/40 border border-red-500/30 text-red-300 text-[12px] font-semibold px-4 py-2 rounded-lg hover:bg-red-800/50 transition-all flex items-center justify-center gap-1.5">
                  <AlertTriangle size={12}/> Generează plan pentru {planCrizaStart && fmtDate(parseD(planCrizaStart))}{planCrizaEnd?` → ${fmtDate(parseD(planCrizaEnd))}`:''}
                </button>
              </div>

              <div className="p-6 space-y-5">
                {!planCriza ? (
                  <div className="text-center py-8">
                    <p className="text-emerald-400 font-semibold text-[14px] mb-2">✓ Echipa e la capacitate normală!</p>
                    <p className="text-zinc-500 text-[12px]">Nu am detectat perioade cu personal insuficient în următoarele 90 de zile.</p>
                    <p className="text-zinc-600 text-[11px] mt-2">Poți selecta manual o perioadă de start/end și genera un plan preventiv.</p>
                  </div>
                ) : (
                  <>
                    {/* Rezumat */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-red-950/30 border border-red-500/20 rounded-xl p-3 text-center">
                        <p className="text-[20px] font-black text-red-400">{planCriza.zileCuSup}</p>
                        <p className="text-[10px] text-zinc-500">zile cu suplinitorii din Cta</p>
                      </div>
                      <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl p-3 text-center">
                        <p className="text-[20px] font-black text-amber-400">{planCriza.zileTotal - planCriza.zileCuSup}</p>
                        <p className="text-[10px] text-zinc-500">zile totale plan</p>
                      </div>
                      <div className="bg-emerald-950/30 border border-emerald-500/20 rounded-xl p-3 text-center">
                        <p className="text-[13px] font-bold text-emerald-400">{planCriza.dataPlecareSup}</p>
                        <p className="text-[10px] text-zinc-500">criza se termină</p>
                      </div>
                    </div>

                    <p className="text-[10px] text-zinc-600">
                      Un angajat face S toată săptămâna (rotativ săptămânal). Sâmbăta = zi normală de lucru (2D+1S cu localii). Duminica = vizitatorul ales vine, localii liberi — zi de tranziție. Luni noul om pe S începe tura. Zero S→D garantat matematic.
                    </p>

                    {/* Selector vizitator: Suplinitor generic sau un runner CTA anume */}
                    <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl p-3 space-y-2">
                      <label className="text-[11px] text-zinc-400 font-semibold">Cine vine duminica?</label>
                      <select
                        value={vizitatorId}
                        onChange={e => setVizitatorId(Number(e.target.value))}
                        className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-emerald-500/50 transition-all"
                      >
                        <option value={999}>Suplinitor generic (necontorizat în ore)</option>
                        {toataEchipaCTA.filter(r => r.tip === 'runner').map(r => {
                          const ocupat = runnerCicluOverride[r.id];
                          return (
                            <option key={r.id} value={r.id}>
                              {r.nume}{ocupat ? ` — ocupat ${ocupat.perioadaStart}→${ocupat.perioadaSfarsit}` : ''}
                            </option>
                          );
                        })}
                      </select>
                      {vizitatorId !== 999 && (
                        <p className="text-[10px] text-amber-400/80">
                          ⚠️ {echipa.find(m=>m.id===vizitatorId)?.nume} va lucra o tură normală (8h) la PLO în zilele marcate SUP — orele intră în calculul lui săptămânal și pot depăși 48h/săpt (apare doar ca avertisment, nu blochează).
                        </p>
                      )}
                    </div>

                    {/* Tabel plan zilnic */}
                    <p className="text-[10px] text-zinc-600 mb-2">Coloanele estompate = rotație normală (informativ, nu e override de criză). Doar Duminicile (⭐) primesc override real.</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-zinc-500 border-b border-white/[0.07]">
                            <th className="text-left py-2 font-medium">Data</th>
                            {echipa.map(m=>(
                              <th key={m.id} className="text-center py-2 font-medium">{m.nume.split(' ')[0]}</th>
                            ))}
                            <th className="text-center py-2 font-medium text-orange-400">{vizitatorId===999?'SUP':(echipa.find(m=>m.id===vizitatorId)?.nume.split(' ')[0]??'SUP')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {planCriza.plan.map((zi, idx) => {
                            const d = parseD(zi.data);
                            const isWeekend = d.getDay()===0||d.getDay()===6;
                            return (
                              <tr key={idx} className={`border-b border-white/[0.03] ${isWeekend?'bg-white/[0.01]':''} ${zi.ziuaSef?'bg-orange-950/20':''}`}>
                                <td className="py-1.5 text-zinc-400">
                                  {fmtDate(d)}
                                  <span className="ml-1 text-[9px] text-zinc-600">{['Du','Lu','Ma','Mi','Jo','Vi','Sâ'][d.getDay()]}</span>
                                  {zi.ziuaSef && <span className="ml-1 text-[9px] text-orange-400 font-bold">⭐ suplinitori Cta</span>}
                                </td>
                                {echipa.map(m=>{
                                  const turaCriza = zi.ture[m.id];
                                  // Zi de vizitator: toti localii sunt fortat 'L' (din plan). Zi normala:
                                  // n-avem override aici — aratam informativ ce calculeaza rotatia normala,
                                  // stil mai estompat, ca sa fie clar ca nu-i o alocare de criza, ci normala.
                                  const t = zi.ziuaSef ? (turaCriza || 'L') : getTuraBaza(d, m, echipaPLO, false).type;
                                  const esteNormal = !zi.ziuaSef;
                                  return (
                                    <td key={m.id} className="text-center py-1.5">
                                      <span className={`inline-block w-6 h-6 rounded text-[10px] font-bold leading-6 ${
                                        t==='D'?'bg-blue-900/50 text-blue-300':t==='S'?'bg-purple-900/50 text-purple-300':'text-zinc-700'
                                      } ${esteNormal?'opacity-60':''}`} title={esteNormal?'Rotație normală (nu e override de criză)':''}>
                                        {dispLabel(t)}
                                      </span>
                                    </td>
                                  );
                                })}
                                <td className="text-center py-1.5">
                                  {zi.ziuaSef ? (
                                    <span className="inline-block px-1.5 h-6 rounded text-[9px] font-bold leading-6 bg-orange-900/50 text-orange-300">2D+2S</span>
                                  ) : (
                                    <span className="text-zinc-700 text-[10px]">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button onClick={()=>{ const p=genereazaPlanCriza(echipa, planCrizaStart, planCrizaSimConcedii, planCrizaIssues, planCrizaEnd || undefined); if(p) setPlanCriza(p); }}
                        className="flex-1 bg-[#2c2c2e] border border-white/[0.07] text-zinc-300 text-[12px] font-semibold py-2 rounded-lg hover:bg-white/[0.05] transition-all">
                        🔄 Regenerează plan
                      </button>
                      {crizaActiva && (
                        <button onClick={()=>{
                          setTuraOverride(prev => prev.filter(o => !o.id.startsWith('criza_')));
                          setCrizaAplicataInterval(null);
                          addLog('Plan Criză anulat — override-uri de tură șterse');
                          setShowPlanCriza(false);
                        }} className="flex-1 bg-red-900/30 border border-red-500/30 text-red-300 text-[12px] font-semibold py-2 rounded-lg hover:bg-red-900/50 transition-all">
                          ✕ Anulează criza
                        </button>
                      )}
                      <button onClick={aplicaPlanCriza}
                        className="flex-1 bg-emerald-900/40 border border-emerald-500/40 text-emerald-300 text-[12px] font-semibold py-2 rounded-lg hover:bg-emerald-900/60 transition-all flex items-center justify-center gap-1.5">
                        <Check size={13}/> Aplică în calendarul real
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Configurare Echipa CTA ── */}
        {showConfigEchipa && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print">
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
                <div>
                  <h3 className="font-bold text-[15px]">⚙️ Configurare Echipă</h3>
                  <p className="text-[11px] text-zinc-500 mt-0.5">Setează rolul fiecărui angajat CTA</p>
                </div>
                <button onClick={()=>setShowConfigEchipa(false)} className="w-7 h-7 rounded-lg bg-white/[0.06] text-zinc-400 hover:text-white flex items-center justify-center text-[14px]">×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {toataEchipaCTA.map(m => {
                  // Citim tip/data live din echipa (se actualizeaza dupa setEchipa)
                  const angajatLive = echipa.find(a => a.id === m.id);
                  const tipCurent = angajatLive?.tip ?? 'fix';
                  const dataCicluCurenta = angajatLive?.dataStartCiclu ?? null;
                  const areNevoieDeData = tipCurent === 'fix' && !dataCicluCurenta;
                  return (
                  <div key={m.id} className={`bg-white/[0.03] border rounded-xl px-4 py-3 ${areNevoieDeData ? 'border-amber-500/40' : 'border-white/[0.06]'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black"
                          style={{background:'rgba(42,109,217,0.2)',color:'#60a5fa'}}>
                          {m.nume.split(' ').map((p:string)=>p[0]).slice(0,2).join('')}
                        </div>
                        <span className="text-[13px] font-semibold text-white">{m.nume}</span>
                      </div>
                      <select
                        value={tipCurent}
                        onChange={async e => {
                          const nouTip = e.target.value;
                          try {
                            const res = await fetch('/api/data', {
                              method: 'PATCH',
                              headers: {'Content-Type':'application/json'},
                              body: JSON.stringify({table:'angajati', id: m.uuid, data: {tip: nouTip}})
                            });
                            const json = await res.json();
                            if (res.ok) {
                              setEchipa(prev => prev.map(a => a.id===m.id ? {...a, tip: nouTip} : a));
                              addLog(`${m.nume} → rol schimbat la ${nouTip}`);
                            } else {
                              alert(`Nu am putut schimba rolul lui ${m.nume}: ${json.error || 'eroare necunoscută'}`);
                              addLog(`✗ Eroare schimbare rol ${m.nume}: ${json.error}`);
                            }
                          } catch(err) {
                            console.error('Eroare update tip:', err);
                            alert(`Nu am putut contacta serverul pentru ${m.nume}.`);
                          }
                        }}
                        className="bg-[#1c1c1e] border border-white/10 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-zinc-200 outline-none cursor-pointer"
                      >
                        <option value="fix">🔵 La tură (fix)</option>
                        <option value="runner">🟠 Runner</option>
                        <option value="birou">💼 Birou</option>
                      </select>
                    </div>
                    {/* La "fix" fara data de ciclu, arata mereu Liber — cerem data acum */}
                    {areNevoieDeData && (
                      <div className="mt-2.5 pt-2.5 border-t border-amber-500/20 flex items-center gap-2">
                        <span className="text-[10px] text-amber-400 flex-shrink-0">⚠️ Fără dată de ciclu → arată mereu Liber. Alege:</span>
                        <div className="flex-1">
                          <MiniDatePicker
                            value=""
                            onChange={async v => {
                              try {
                                const res = await fetch('/api/data', {
                                  method: 'PATCH',
                                  headers: {'Content-Type':'application/json'},
                                  body: JSON.stringify({table:'angajati', id: m.uuid, data: {data_start_ciclu: v}})
                                });
                                const json = await res.json();
                                if (res.ok) {
                                  setEchipa(prev => prev.map(a => a.id===m.id ? {...a, dataStartCiclu: v} : a));
                                  addLog(`${m.nume} → ciclu Z/N pornit din ${v}`);
                                } else {
                                  alert(`Nu am putut seta data pentru ${m.nume}: ${json.error || 'eroare necunoscută'}`);
                                }
                              } catch(err) {
                                console.error('Eroare update data_start_ciclu:', err);
                                alert(`Nu am putut contacta serverul pentru ${m.nume}.`);
                              }
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
              <div className="px-5 py-4 border-t border-white/[0.08]">
                <p className="text-[10px] text-zinc-600 text-center">Modificările se salvează automat în baza de date</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Popup Absenta Rapida CTA ── */}
        {absentaPopup && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print"
            onClick={e => { if (e.target === e.currentTarget) setAbsentaPopup(null); }}>
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/[0.08]" style={{background:'linear-gradient(135deg,#0a1628,#1a2744)'}}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-black"
                      style={{background:AVATAR_COLORS[displayEchipa.findIndex(m=>m.id===absentaPopup.angajat.id)%5]+'33',
                              color:AVATAR_COLORS[displayEchipa.findIndex(m=>m.id===absentaPopup.angajat.id)%5],
                              border:`1.5px solid ${AVATAR_COLORS[displayEchipa.findIndex(m=>m.id===absentaPopup.angajat.id)%5]}55`}}>
                      {absentaPopup.angajat.nume.substring(0,2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-[15px] text-white">{absentaPopup.angajat.nume}</div>
                      <div className="text-[11px] text-zinc-500">Adaugă absență rapidă</div>
                    </div>
                  </div>
                  <button onClick={()=>setAbsentaPopup(null)} className="w-7 h-7 rounded-lg bg-white/[0.06] text-zinc-400 hover:text-white flex items-center justify-center text-[16px]">×</button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* Tip absenta */}
                <div>
                  <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Tip absență</div>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ['CO', '🏖', 'Concediu\nodihna', 'bg-rose-950/40 border-rose-500/40 text-rose-300'],
                      ['CM', '🏥', 'Concediu\nmedical', 'bg-orange-950/40 border-orange-500/40 text-orange-300'],
                      ['AN', '⛔', 'Absent\nnemotvat', 'bg-red-950/40 border-red-500/40 text-red-300'],
                    ] as const).map(([t, emoji, label, cls]) => (
                      <button key={t} onClick={()=>setAbsentaPopup(p=>{
                          if (!p) return p;
                          if (t === 'CO' && p.dataStart) {
                            const dataEndObj = new Date(parseD(p.dataStart).getTime() + (p.saptamani*7 - 1) * 86400000);
                            return {...p, tip:t, dataSfarsit: fmtDateInput(dataEndObj)};
                          }
                          return {...p, tip:t};
                        })}
                        className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-[11px] font-semibold transition-all ${
                          absentaPopup.tip===t ? cls + ' ring-2 ring-white/20' : 'bg-white/[0.03] border-white/[0.08] text-zinc-500 hover:text-zinc-300'
                        }`}>
                        <span className="text-[18px]">{emoji}</span>
                        <span className="text-center leading-tight whitespace-pre-line">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Perioada */}
                <div>
                  <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Perioadă</div>
                  {absentaPopup.tip === 'CO' ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <div className="text-[10px] text-zinc-600 mb-1">Start concediu</div>
                        <MiniDatePicker value={absentaPopup.dataStart} onChange={v=>setAbsentaPopup(p=>{
                          if (!p) return p;
                          const dataEndObj = new Date(parseD(v).getTime() + (p.saptamani*7 - 1) * 86400000);
                          return {...p, dataStart:v, dataSfarsit: fmtDateInput(dataEndObj)};
                        })}/>
                      </div>
                      <div className="w-32">
                        <div className="text-[10px] text-zinc-600 mb-1">Durată</div>
                        <select value={absentaPopup.saptamani}
                          onChange={e=>setAbsentaPopup(p=>{
                            if (!p) return p;
                            const saptamani = Number(e.target.value) as 1|2;
                            const dataEndObj = p.dataStart ? new Date(parseD(p.dataStart).getTime() + (saptamani*7 - 1) * 86400000) : null;
                            return {...p, saptamani, dataSfarsit: dataEndObj ? fmtDateInput(dataEndObj) : p.dataSfarsit};
                          })}
                          className="w-full bg-[#1c1c1e] border border-white/10 rounded-lg px-2 py-2 text-[12px] text-zinc-200 outline-none focus:border-blue-500/50 cursor-pointer">
                          <option value={1}>1 săptămână</option>
                          <option value={2}>2 săptămâni</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <div className="text-[10px] text-zinc-600 mb-1">De la</div>
                        <MiniDatePicker value={absentaPopup.dataStart} onChange={v=>setAbsentaPopup(p=>p?{...p,dataStart:v}:p)}/>
                      </div>
                      <div className="text-zinc-600 mt-4">→</div>
                      <div className="flex-1">
                        <div className="text-[10px] text-zinc-600 mb-1">Până la</div>
                        <MiniDatePicker value={absentaPopup.dataSfarsit} onChange={v=>setAbsentaPopup(p=>p?{...p,dataSfarsit:v}:p)}/>
                      </div>
                    </div>
                  )}
                </div>

                {/* Runner — doar pentru CTA; PLO foloseste acoperirea din Planul de Criza */}
                {isCTA(absentaPopup.angajat) && (
                <div>
                  <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                    Runner acoperire
                    {(() => {
                      const runneri = toataEchipaCTA.filter(r=>r.tip==='runner');
                      const ocupati = runneri.filter(r=>runnerCicluOverride[r.id]);
                      if (ocupati.length === runneri.length && runneri.length > 0) {
                        return <span className="ml-2 text-red-400 text-[10px] font-normal">⚠ Toți runnerii sunt ocupați!</span>;
                      }
                      return null;
                    })()}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={()=>setAbsentaPopup(p=>p?{...p,runnerId:null}:p)}
                      className={`py-2.5 rounded-xl border text-[11px] font-semibold transition-all ${
                        absentaPopup.runnerId===null ? 'bg-zinc-700/50 border-zinc-500/50 text-zinc-300 ring-2 ring-white/10' : 'bg-white/[0.03] border-white/[0.08] text-zinc-600'
                      }`}>Fără runner</button>
                    {toataEchipaCTA.filter(r=>r.tip==='runner').map(r => {
                      const ocupat = !!runnerCicluOverride[r.id];
                      return (
                        <button key={r.id} onClick={()=>!ocupat && setAbsentaPopup(p=>p?{...p,runnerId:r.id}:p)}
                          disabled={ocupat}
                          className={`py-2.5 rounded-xl border text-[11px] font-semibold transition-all relative ${
                            absentaPopup.runnerId===r.id ? 'bg-amber-950/50 border-amber-500/40 text-amber-300 ring-2 ring-amber-500/20' :
                            ocupat ? 'bg-white/[0.02] border-white/[0.04] text-zinc-700 cursor-not-allowed' :
                            'bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                          }`}>
                          {r.nume.split(' ')[0]}
                          {ocupat && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 flex items-center justify-center text-[7px] text-white font-black">✗</span>}
                          {absentaPopup.runnerId===r.id && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-500 flex items-center justify-center text-[7px] text-white font-black">★</span>}
                        </button>
                      );
                    })}
                  </div>
                  {absentaPopup.runnerId !== null && (
                    <div className="mt-2 text-[10px] text-amber-400/80">
                      ★ Runner sugerat automat — cel cu mai puține ore acumulate
                    </div>
                  )}
                </div>
                )}

                {/* Butoane */}
                <div className="flex gap-3 pt-1">
                  <button onClick={()=>setAbsentaPopup(null)}
                    className="flex-1 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-zinc-400 text-[13px] font-semibold hover:bg-white/[0.08] transition-all">
                    Anulează
                  </button>
                  <button
                    disabled={!absentaPopup.tip || !absentaPopup.dataStart || !absentaPopup.dataSfarsit}
                    onClick={()=>{
                      if (!absentaPopup.tip) return;
                      aplicaAbsentaCTA(
                        absentaPopup.angajat,
                        absentaPopup.tip,
                        absentaPopup.dataStart,
                        absentaPopup.dataSfarsit,
                        absentaPopup.runnerId
                      );
                    }}
                    className="flex-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    ✓ Aplică
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Deplasări runner — text liber, per zi, doar saptamana afisata ── */}
        {deplasarePopup && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print" onClick={()=>setDeplasarePopup(null)}>
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
                <div>
                  <span className="font-bold text-[14px]">Deplasări — {deplasarePopup.angajat.nume}</span>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Doar pentru zilele de Birou din săptămâna afișată — nu suprascrie ture reale (Z/N)</p>
                </div>
                <button onClick={()=>setDeplasarePopup(null)} className="w-7 h-7 flex items-center justify-center bg-white/[0.07] hover:bg-white/10 text-zinc-400 rounded-md flex-shrink-0"><X size={14}/></button>
              </div>
              <div className="p-5 space-y-2 max-h-[70vh] overflow-y-auto">
                {days.map((d,i) => {
                  const dStr = fmtDateInput(d);
                  const tActuala = getTuraW(d, deplasarePopup.angajat);
                  const areOverrideDeplasare = tActuala.type==='B' && tActuala.label!=='B';
                  const eBirouLiber = tActuala.type==='B';
                  const poateEdita = eBirouLiber; // Birou normal SAU deja are o deplasare (tot type='B')
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] text-zinc-400 w-20 flex-shrink-0">{DAY_SHORT[i]} {fmtDate(d)}</span>
                      {poateEdita ? (
                        <input
                          type="text"
                          value={deplasarePopup.texte[dStr] ?? ''}
                          onChange={e => setDeplasarePopup(prev => prev ? { ...prev, texte: { ...prev.texte, [dStr]: e.target.value } } : prev)}
                          placeholder="ex. Craiova"
                          className="flex-1 bg-black/40 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-purple-500/50 transition-all"
                        />
                      ) : (
                        <span className="flex-1 text-[11px] text-zinc-600 italic px-2.5 py-1.5">
                          {tActuala.type==='L' ? 'Liber' : 'tură reală — nu poate fi suprascrisă'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="px-5 py-4 border-t border-white/[0.08] flex gap-3">
                <button onClick={()=>setDeplasarePopup(null)} className="flex-1 bg-white/[0.05] border border-white/[0.08] text-zinc-300 text-[12px] font-semibold py-2 rounded-lg hover:bg-white/10 transition-all">Anulează</button>
                <button onClick={salveazaDeplasari} className="flex-1 bg-purple-900/50 border border-purple-500/40 text-purple-200 text-[12px] font-semibold py-2 rounded-lg hover:bg-purple-800/60 transition-all">Salvează</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Bara flotanta de actiuni in masa ── */}
        {modSelectieMultipla && celuleSelectate.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#2c2c2e] border border-sky-500/40 rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3 no-print">
            <span className="text-[12px] font-bold text-sky-300 whitespace-nowrap">{celuleSelectate.size} selectate</span>
            <div className="w-px h-5 bg-white/10"/>
            {locatieActiva === 'PLO' ? (
              <>
                <button onClick={()=>aplicaInMasa('D')} className="px-3 py-1.5 rounded-lg bg-sky-900/50 border border-sky-500/30 text-sky-300 text-[11px] font-bold hover:bg-sky-800/60 transition-all">Zi</button>
                <button onClick={()=>aplicaInMasa('S')} className="px-3 py-1.5 rounded-lg bg-purple-900/50 border border-purple-500/30 text-purple-300 text-[11px] font-bold hover:bg-purple-800/60 transition-all">Noapte</button>
              </>
            ) : (
              <>
                <button onClick={()=>aplicaInMasa('Z')} className="px-3 py-1.5 rounded-lg bg-orange-900/50 border border-orange-500/30 text-orange-300 text-[11px] font-bold hover:bg-orange-800/60 transition-all">Zi</button>
                <button onClick={()=>aplicaInMasa('N')} className="px-3 py-1.5 rounded-lg bg-indigo-900/50 border border-indigo-500/30 text-indigo-300 text-[11px] font-bold hover:bg-indigo-800/60 transition-all">Noapte</button>
              </>
            )}
            <button onClick={()=>aplicaInMasa('L')} className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold hover:bg-zinc-700 transition-all">Liber</button>
            <div className="w-px h-5 bg-white/10"/>
            <button onClick={stergeInMasa} className="px-3 py-1.5 rounded-lg bg-red-900/40 border border-red-500/30 text-red-300 text-[11px] font-bold hover:bg-red-800/50 transition-all">Șterge override-uri</button>
            <button onClick={()=>setCeluleSelectate(new Set())} className="px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-zinc-400 text-[11px] font-bold hover:bg-white/10 transition-all">Anulează selecția</button>
          </div>
        )}

        {/* ── Modal Notă de predare tură ── */}
        {notaPopup && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print" onClick={()=>setNotaPopup(null)}>
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
                <div>
                  <span className="font-bold text-[14px]">📝 Notă de predare</span>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{notaPopup.angajat.nume} — {fmtDate(parseD(notaPopup.dStr))}</p>
                </div>
                <button onClick={()=>setNotaPopup(null)} className="w-7 h-7 flex items-center justify-center bg-white/[0.07] hover:bg-white/10 text-zinc-400 rounded-md flex-shrink-0"><X size={14}/></button>
              </div>
              <div className="p-5">
                <textarea
                  autoFocus
                  value={notaPopup.text}
                  onChange={e => setNotaPopup(prev => prev ? { ...prev, text: e.target.value } : prev)}
                  placeholder="ex. Clientul X a sunat, verifică mâine. Presiunea la echipamentul Y era scăzută."
                  rows={4}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2.5 text-[13px] text-white outline-none focus:border-amber-500/50 transition-all resize-none"
                />
              </div>
              <div className="px-5 py-4 border-t border-white/[0.08] flex gap-3">
                <button onClick={()=>setNotaPopup(null)} className="flex-1 bg-white/[0.05] border border-white/[0.08] text-zinc-300 text-[12px] font-semibold py-2 rounded-lg hover:bg-white/10 transition-all">Anulează</button>
                <button onClick={()=>salveazaNota(notaPopup.angajat, notaPopup.dStr, notaPopup.text)} className="flex-1 bg-amber-900/50 border border-amber-500/40 text-amber-200 text-[12px] font-semibold py-2 rounded-lg hover:bg-amber-800/60 transition-all">
                  {notaPopup.text.trim() ? 'Salvează' : 'Șterge nota'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Urgente ── */}
        {showUrgente&&(
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print">
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
                <div className="flex items-center gap-2"><AlertTriangle size={14} className="text-rose-400"/><span className="font-bold text-[14px]">Protocol Urgențe</span></div>
                <button onClick={()=>setShowUrgente(false)} className="w-6 h-6 flex items-center justify-center bg-white/[0.07] hover:bg-white/10 text-zinc-400 rounded-md"><X size={14}/></button>
              </div>
              <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
                <div>
                  <label className="text-[10px] text-zinc-500 mb-2 block font-semibold uppercase tracking-wider">Tip absență</label>
                  <div className="grid grid-cols-2 gap-2">
                    {([['CM','Concediu Medical','orange'],['AN','Abs. Nemotivată','red']] as const).map(([tip,label,col])=>(
                      <button key={tip} onClick={()=>setUrgTip(tip)}
                        className={`py-2 rounded-lg text-[11px] font-bold border flex items-center justify-center gap-1.5 transition-all ${urgTip===tip?`bg-${col}-950/50 border-${col}-500/60 text-${col}-200`:'bg-white/[0.04] border-white/[0.07] text-zinc-400 hover:border-white/20'}`}>
                        {tip==='CM'?<HeartPulse size={12}/>:<AlertTriangle size={12}/>} {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 mb-2 block font-semibold uppercase tracking-wider">Angajat</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {echipa.map((m,i)=>(
                      <button key={i} onClick={()=>setUrgTargetIdx(i)}
                        className={`py-1.5 rounded-lg text-[11px] font-medium border transition-all ${urgTargetIdx===i?'bg-sky-900/40 border-sky-500/50 text-sky-300':'bg-white/[0.04] border-white/[0.07] text-zinc-400 hover:border-white/20'}`}>
                        {m.nume}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block font-semibold uppercase tracking-wider">Data start</label>
                  <input type="date" value={urgStart} onChange={e=>setUrgStart(e.target.value)} className={inputCls}/>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1 block font-semibold uppercase tracking-wider">Număr zile (1–30)</label>
                  <div className="flex items-center gap-3">
                    <input type="range" min={1} max={30} value={urgZile} onChange={e=>setUrgZile(Number(e.target.value))} className="flex-1 accent-[#60cdff]"/>
                    <span className="text-[#60cdff] font-black text-lg w-8 text-center">{urgZile}</span>
                  </div>
                  {urgTip==='CM'&&urgZile>7&&(
                    <p className="text-[10px] text-orange-400 mt-1.5 bg-orange-950/30 border border-orange-500/20 rounded-lg px-2 py-1.5">
                      ⚠ CM &gt; 7 zile — suplinitor activat automat.
                    </p>
                  )}
                </div>
                <button onClick={aplicaUrgenta}
                  className={`w-full font-bold text-[12px] py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 ${urgTip==='CM'?'bg-orange-900/40 hover:bg-orange-900/60 border border-orange-500/40 text-orange-200':'bg-red-900/40 hover:bg-red-900/60 border border-red-500/40 text-red-200'}`}>
                  {urgTip==='CM'?<HeartPulse size={13}/>:<AlertTriangle size={13}/>}
                  Aplică {urgTip==='CM'?'CM':'Abs. Nemotivată'} — {echipa[urgTargetIdx]?.nume}
                </button>
                {echipa.some(m=>m.absente.length>0)&&(
                  <div>
                    <label className="text-[10px] text-zinc-500 mb-2 block font-semibold uppercase tracking-wider">Absențe active</label>
                    <div className="space-y-1.5">
                      {echipa.flatMap((m,mi)=>m.absente.map((a,ai)=>(
                        <div key={`${mi}-${ai}`} className={`flex items-center justify-between rounded-lg px-3 py-2 ${a.tip==='CM'?'bg-orange-950/30 border border-orange-500/20':'bg-red-950/30 border border-red-500/20'}`}>
                          <div>
                            <span className={`font-bold text-[12px] ${a.tip==='CM'?'text-orange-300':'text-red-300'}`}>{m.nume}</span>
                            <p className="text-[10px] text-zinc-500">{a.tip} · {a.startDate} · {a.zile}z</p>
                          </div>
                          <button onClick={()=>stergeAbsenta(mi,ai)} className="text-zinc-600 hover:text-red-400 transition-colors text-[14px] leading-none">×</button>
                        </div>
                      )))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Modal Simulare Concedii ── */}
        {showSimulare&&(
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 no-print">
            <div className="bg-[#1c1c1e] border border-purple-500/20 rounded-2xl w-full max-w-5xl max-h-[92vh] shadow-2xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] flex-shrink-0 bg-purple-950/20">
                <div className="flex items-center gap-2">
                  <FlaskConical size={16} className="text-purple-400"/>
                  <span className="font-bold text-[14px]">Simulare Concedii</span>
                  <span className="text-[10px] text-purple-400/70 bg-purple-900/30 px-2 py-0.5 rounded-full">Mod testare — nu afectează calendarul real</span>
                </div>
                <button onClick={()=>setShowSimulare(false)} className="w-7 h-7 flex items-center justify-center bg-white/[0.07] hover:bg-white/10 text-zinc-400 rounded-md"><X size={15}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5">

                {/* Form adaugare concediu simulat */}
                <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl p-4">
                  <p className="text-[11px] font-bold text-purple-300 uppercase tracking-wider mb-3">Adaugă concediu de test</p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[10px] text-zinc-500 mb-1 block">Angajat</label>
                      <select value={simTargetIdx} onChange={e=>setSimTargetIdx(Number(e.target.value))}
                        className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-purple-500/50">
                        {echipa.map((m,i)=>(<option key={i} value={i}>{m.nume}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 mb-1 block">Data start</label>
                      <input type="date" value={simStart} onChange={e=>setSimStart(e.target.value)}
                        className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-purple-500/50"/>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 mb-1 block">
                        Număr zile calendaristice ({simZile})
                        {(() => {
                          // Calculeaza costul real in zile lucratoare din intervalul ales
                          const s = parseD(simStart);
                          const e = new Date(s.getTime() + (simZile - 1) * 86400000);
                          let lucratoare = 0;
                          for (let d = new Date(s); d <= e; d = new Date(d.getTime() + 86400000)) {
                            if (d.getDay() > 0 && d.getDay() < 6 && !isSarbatoare(d)) lucratoare++;
                          }
                          return (
                            <span className="ml-2 text-purple-400 font-bold">
                              = {lucratoare} zile CO
                            </span>
                          );
                        })()}
                      </label>
                      <input type="range" min={1} max={31} value={simZile} onChange={e=>setSimZile(Number(e.target.value))} className="w-full accent-purple-500 mt-2.5"/>
                    </div>
                    <div className="flex items-end">
                      <button onClick={verificaSiAdaugaSim} className="w-full bg-purple-900/40 hover:bg-purple-900/60 border border-purple-500/40 text-purple-300 font-semibold text-[12px] py-2 rounded-lg transition-all flex items-center justify-center gap-1.5">
                        <Plus size={13}/> Adaugă
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-2">Perioada se calculează liber în zile calendaristice (1–31). Zilele lucrătoare (Lu-Vi, fără sărbători) reprezintă costul real din CO — weekendurile din interval nu se scad.</p>
                </div>

                {/* ALERTĂ conformitate cu Plan Criză auto-generat */}
                {simPendingAction === 'add' && simIssues.length > 0 && (
                  <div className="bg-red-950/40 border-2 border-red-500/50 rounded-xl p-4 space-y-3">
                    {/* Header alertă */}
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={18} className="text-red-400 flex-shrink-0"/>
                      <span className="font-bold text-red-300 text-[13px]">ATENȚIE — Probleme de conformitate detectate!</span>
                    </div>

                    {/* Detalii probleme */}
                    <div className="space-y-1">
                      {simIssues.slice(0,5).map((iss,ii)=>(
                        <div key={ii} className="flex items-start gap-2 bg-black/30 rounded-lg px-3 py-1.5">
                          <span className="text-red-400 text-[10px] font-bold flex-shrink-0 mt-0.5">{iss.tip==='PUTINI_OAMENI'?'⚠ PERSONAL INSUFICIENT':'⚠ ORE LIMITĂ'}</span>
                          <span className="text-[10px] text-red-300/80">{iss.detalii}</span>
                        </div>
                      ))}
                      {simIssues.length > 5 && <p className="text-[10px] text-red-400/60 pl-2">...și încă {simIssues.length-5} probleme similare.</p>}
                    </div>

                    {/* Plan Criză auto-generat — afișat direct dacă există personal insuficient */}
                    {planCriza && simIssues.some(i => i.tip === 'PUTINI_OAMENI') && (
                      <div className="bg-orange-950/30 border border-orange-500/30 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={13} className="text-orange-400"/>
                          <span className="text-orange-300 font-bold text-[12px]">Plan Urgență generat automat</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="bg-black/30 rounded-lg py-2">
                            <p className="text-[16px] font-black text-orange-400">{planCriza.zileCuSup}</p>
                            <p className="text-[9px] text-zinc-500">vizite suplinitori</p>
                          </div>
                          <div className="bg-black/30 rounded-lg py-2">
                            <p className="text-[16px] font-black text-zinc-300">{planCriza.zileTotal}</p>
                            <p className="text-[9px] text-zinc-500">zile total criză</p>
                          </div>
                          <div className="bg-black/30 rounded-lg py-2">
                            <p className="text-[13px] font-bold text-emerald-400">{planCriza.dataPlecareSup}</p>
                            <p className="text-[9px] text-zinc-500">criza se termină</p>
                          </div>
                        </div>
                        <p className="text-[9px] text-zinc-600">
                          Un local face S săptămânal (rotativ). Suplinitorii din Constanța vin Duminica (2D+2S). Zero S→D garantat.
                        </p>
                        <button onClick={()=>{
                          confirmaAdaugareSimCuProbleme(false);
                          setTimeout(()=>{ setShowSimulare(false); setShowPlanCriza(true); }, 100);
                        }} className="w-full bg-orange-900/50 border border-orange-500/40 text-orange-200 font-bold text-[12px] py-2 rounded-lg hover:bg-orange-800/60 transition-all flex items-center justify-center gap-2">
                          <AlertTriangle size={12}/> Aplică Plan Urgență în calendar
                        </button>
                        <button onClick={()=>{ setShowPlanCriza(true); }} className="w-full text-[10px] text-orange-400/70 hover:text-orange-300 transition-colors text-center">
                          Vezi detalii plan complet →
                        </button>
                      </div>
                    )}

                    {/* Butoane standard */}
                    <div className="border-t border-red-500/20 pt-3">
                      <p className="text-[11px] text-zinc-400 mb-2">Sau alege o altă acțiune:</p>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={anuleazaAdaugareSim} className="flex-1 bg-zinc-800 border border-zinc-600 text-zinc-300 font-semibold text-[12px] py-2 rounded-lg hover:bg-zinc-700 transition-all">
                          Nu, renunț
                        </button>
                        <button onClick={()=>confirmaAdaugareSimCuProbleme(false)} className="flex-1 bg-zinc-700/60 border border-zinc-600/40 text-zinc-300 font-semibold text-[12px] py-2 rounded-lg hover:bg-zinc-700 transition-all">
                          Adaugă fără plan
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Lista concedii simulate */}
                {simConcedii.length > 0 && (
                  <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Concedii în simulare ({simConcedii.length})</p>
                      <button onClick={reseteazaSimulare} className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors">Resetează tot</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {simConcedii.map(sc=>{
                        const ang=echipa.find(m=>m.id===sc.angajatId);
                        const start=parseD(sc.start);
                        const end=new Date(start.getTime()+(sc.zile-1)*86400000);
                        let lucratoare = 0;
                        for (let d = new Date(start); d <= end; d = new Date(d.getTime()+86400000)) {
                          if (d.getDay()>0 && d.getDay()<6 && !isSarbatoare(d)) lucratoare++;
                        }
                        return (
                          <span key={sc.id} className="flex items-center gap-1.5 bg-purple-950/40 border border-purple-500/25 text-purple-300 text-[10px] px-2.5 py-1 rounded-full">
                            <strong>{ang?.nume}</strong> {fmtDate(start)}–{fmtDate(end)}
                            <span className="text-purple-500">({sc.zile} cal</span>
                            <span className="text-purple-300 font-bold">= {lucratoare} CO)</span>
                            <button onClick={()=>stergeSimConcediu(sc.id)} className="text-purple-500 hover:text-purple-200 ml-0.5 leading-none">×</button>
                          </span>
                        );
                      })}
                    </div>
                    {simSuplinitor && (
                      <div className="mt-2 inline-flex items-center gap-1.5 bg-emerald-950/30 border border-emerald-500/25 text-emerald-300 text-[10px] px-2.5 py-1 rounded-full">
                        <Check size={11}/> Suplinitor activ în simulare
                      </div>
                    )}
                  </div>
                )}

                {/* Vizualizare rotatie simulata */}
                {simConcedii.length > 0 && (
                  <div className="bg-[#2c2c2e] border border-white/[0.07] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
                      <span className="font-semibold text-[12px] text-zinc-300">Previzualizare rotație simulată</span>
                      <div className="flex items-center gap-1.5">
                        <button onClick={()=>setSimWeekOffset(o=>o-1)} className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/[0.08] rounded-md text-zinc-400"><ChevronLeft size={13}/></button>
                        <span className="text-[11px] font-mono text-zinc-400 min-w-[120px] text-center">{fmtDate(simDays[0])} – {fmtDate(simDays[6])}</span>
                        <button onClick={()=>setSimWeekOffset(o=>o+1)} className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/[0.08] rounded-md text-zinc-400"><ChevronRight size={13}/></button>
                      </div>
                    </div>
                    <div className="overflow-x-auto p-3">
                      <table className="w-full border-separate border-spacing-1.5">
                        <thead>
                          <tr>
                            <th className="text-left text-[10px] font-semibold text-zinc-500 uppercase pl-2 pb-1 w-28">Angajat</th>
                            {simDays.map((d,i)=>(
                              <th key={i} className="text-center text-[10px] font-semibold text-zinc-500 uppercase pb-1">{DAY_SHORT[i]}<br/><span className="text-[9px] font-normal opacity-60">{fmtDate(d)}</span></th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(simSuplinitor?[...echipa,SUPLINITOR_OBJ]:echipa).map((m,mi)=>(
                            <tr key={mi}>
                              <td className="pl-2 pr-2 py-1 font-semibold text-[12px] text-zinc-200 whitespace-nowrap">{m.nume}</td>
                              {simDays.map((d,di)=>{
                                const t=getTuraSim(d,m,echipa,simConcedii,simSuplinitor);
                                const style=SHIFT_STYLE[t.type]??SHIFT_STYLE.L;
                                return (<td key={di} className="text-center"><div className={`text-[11px] font-bold py-1.5 rounded-lg ${style}`}>{dispLabel(t.label)}</div></td>);
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer - Aplica in real */}
              <div className="border-t border-white/[0.08] px-5 py-4 flex items-center justify-between bg-black/20 flex-shrink-0">
                <p className="text-[11px] text-zinc-500">
                  {simConcedii.length === 0 ? 'Adaugă cel puțin un concediu de test pentru a vedea rezultatul.' : `${simConcedii.length} concedii pregătite${simSuplinitor?' · suplinitor inclus':''}.`}
                </p>
                {simConcedii.length > 0 && (
                  <div className="bg-purple-950/20 border border-purple-500/20 rounded-xl px-4 py-3 text-[11px]">
                    <p className="text-zinc-400 font-semibold mb-1.5">Rezumat cost simulare:</p>
                    {echipa.map(m => {
                      const concediiM = simConcedii.filter(sc => sc.angajatId === m.id);
                      if (concediiM.length === 0) return null;
                      const totalCal = concediiM.reduce((acc, sc) => acc + sc.zile, 0);
                      let totalCO = 0;
                      concediiM.forEach(sc => {
                        const s = parseD(sc.start);
                        const e = new Date(s.getTime() + (sc.zile - 1) * 86400000);
                        for (let d = new Date(s); d <= e; d = new Date(d.getTime() + 86400000)) {
                          if (d.getDay() > 0 && d.getDay() < 6 && !isSarbatoare(d)) totalCO++;
                        }
                      });
                      const coRamas = m.zileCO - totalCO;
                      return (
                        <div key={m.id} className="flex items-center justify-between py-0.5">
                          <span className="text-zinc-300">{m.nume}</span>
                          <span>
                            <span className="text-zinc-500">{totalCal} zile cal. → </span>
                            <span className="text-purple-300 font-bold">{totalCO} zile CO</span>
                            <span className={`ml-2 font-bold ${coRamas < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                              ({coRamas < 0 ? `depășit cu ${Math.abs(coRamas)}!` : `${coRamas} rămase`})
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={()=>{reseteazaSimulare();setShowSimulare(false);}} className="bg-zinc-800 border border-zinc-600 text-zinc-300 font-semibold text-[12px] px-4 py-2 rounded-lg hover:bg-zinc-700 transition-all">
                    Închide fără salvare
                  </button>
                  <button onClick={aplicaSimulareInReal} disabled={simConcedii.length===0}
                    className={`font-semibold text-[12px] px-4 py-2 rounded-lg transition-all flex items-center gap-1.5 ${simConcedii.length===0?'bg-zinc-800 text-zinc-600 cursor-not-allowed':'bg-emerald-900/40 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60'}`}>
                    <Check size={14}/> Aplică în calendarul real
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

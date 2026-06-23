// RotaFlow v4.0 — Fix S->D complet drag&drop (toate 4 cazuri) — Plan Criza Opt4 + Tranzitie 11Aug + Ore fix
'use client';
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Edit3, ChevronLeft, ChevronRight, FileDown, Calendar, X, AlertTriangle, HeartPulse, ArrowLeftRight, Trophy, ExternalLink, Clock, Printer, FlaskConical, Plus, Check, Scale, FileText } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const SARBATORI_RAW = ['2026-01-01','2026-01-02','2026-01-24','2026-04-19','2026-04-20','2026-05-01','2026-06-01','2026-06-08','2026-08-15','2026-11-30','2026-12-01','2026-12-25','2026-12-26'];
const SARBATORI = SARBATORI_RAW.map(d => new Date(d + 'T00:00:00'));
const isSarbatoare = (d: Date) => SARBATORI.some(s => s.toDateString() === d.toDateString());
const parseD = (s: string) => new Date(s + 'T00:00:00');

// Sloturi de concediu — conform art. 145 Codul Muncii, concediul se calculeaza in zile LUCRATOARE.
// Fiecare slot acopera Luni-Vineri (5 zile lucratoare). Sambata si Duminica din acelasi interval
// sunt marcate CO in calendar (absent fizic) dar NU se scad din zilele de CO ramase.
const SLOTS: Record<string, { n: string; s: string; e: string }[]> = {
  'Primăvară': [
    { n: '06–10 Apr', s: '2026-04-06', e: '2026-04-10' },{ n: '13–17 Apr', s: '2026-04-13', e: '2026-04-17' },
    { n: '20–24 Apr', s: '2026-04-20', e: '2026-04-24' },{ n: '27 Apr–01 Mai', s: '2026-04-27', e: '2026-05-01' },
    { n: '04–08 Mai', s: '2026-05-04', e: '2026-05-08' },
  ],
  'Vară': [
    { n: '06–10 Iul', s: '2026-07-06', e: '2026-07-10' },{ n: '13–17 Iul', s: '2026-07-13', e: '2026-07-17' },
    { n: '20–24 Iul', s: '2026-07-20', e: '2026-07-24' },{ n: '27–31 Iul', s: '2026-07-27', e: '2026-07-31' },
    { n: '03–07 Aug', s: '2026-08-03', e: '2026-08-07' },
  ],
  'Toamnă': [
    { n: '05–09 Oct', s: '2026-10-05', e: '2026-10-09' },{ n: '12–16 Oct', s: '2026-10-12', e: '2026-10-16' },
    { n: '19–23 Oct', s: '2026-10-19', e: '2026-10-23' },{ n: '26–30 Oct', s: '2026-10-26', e: '2026-10-30' },
    { n: '02–06 Noi', s: '2026-11-02', e: '2026-11-06' },
  ],
  'Iarnă': [
    { n: '07–11 Dec', s: '2026-12-07', e: '2026-12-11' },{ n: '14–18 Dec', s: '2026-12-14', e: '2026-12-18' },
    { n: '21–25 Dec', s: '2026-12-21', e: '2026-12-25' },{ n: '28 Dec–01 Ian', s: '2026-12-28', e: '2027-01-01' },
    { n: '04–08 Ian 27', s: '2027-01-04', e: '2027-01-08' },
  ],
};

const AVATAR_COLORS = ['#0078d4','#bf5af2','#4cd964','#ffd60a','#ff6b6b'];
const DAY_SHORT = ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'];
const LS_KEY = 'rotaflow_v1';

interface Concediu { n: string; s: string; e: string; uuid?: string }
interface Absenta { startDate: string; zile: number; tip: 'CM' | 'AN'; uuid?: string }
interface Swap { id: string; aId: number; aData: string; bId: number; bData: string; nota: string }
interface TuraOverride { id: string; angajatId: number; data: string; tura: 'D'|'S'|'L'; expiraLa: string } // expiraLa = data plecarii suplinitorului
interface Angajat { id: number; uuid?: string; nume: string; zileCO: number; concedii: Concediu[]; absente: Absenta[] }
interface LogEntry { ts: string; msg: string }
interface SimConcediu { id: string; angajatId: number; start: string; zile: number }

// ─── Tipuri brute din Supabase ───
interface SbAngajat { id: string; nume: string; pozitie_rotatie: number; zile_co: number; este_sef: boolean; activ: boolean }
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
    .filter(a => !a.este_sef) // sefu nu intra in rotatia normala
    .sort((a, b) => a.pozitie_rotatie - b.pozitie_rotatie)
    .map(a => ({
      id: a.pozitie_rotatie,
      uuid: a.id,
      nume: a.nume,
      zileCO: a.zile_co,
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
async function apiActualizeazaAngajat(id: string, payload: { nume?: string; zile_co?: number }) {
  const res = await fetch('/api/angajati', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...payload }),
  });
  if (!res.ok) throw new Error('Eroare la actualizarea angajatului');
  return res.json();
}

// ─── Helpers ───
function getMonday(d: Date): Date {
  const r = new Date(d); const day = r.getDay();
  r.setDate(r.getDate() + (day === 0 ? -6 : 1 - day)); r.setHours(0,0,0,0); return r;
}
function fmtDate(d: Date) { return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' }); }
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

  // Verificare "punte" - daca data e exact 1 zi intre sfarsitul unui concediu si inceputul altuia
  // (sloturi adiacente, ex: 06-10 Apr + 13-17 Apr -> 11-12 Apr tratat ca CO, fara cost suplimentar)
  return m.concedii.some(c1 => m.concedii.some(c2 => {
    if (c1 === c2) return false;
    const e1 = parseD(c1.e);
    const s2 = parseD(c2.s);
    const gapStart = new Date(e1.getTime() + 86400000);
    const gapEnd = new Date(s2.getTime() - 86400000);
    if (gapStart.getTime() > gapEnd.getTime()) return false;
    // gap poate fi 1-2 zile (Sambata+Duminica intre 2 sloturi consecutive)
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

function getTuraBaza(d: Date, m: Angajat, toataEchipa: Angajat[], suplinitorActiv: boolean, oreAcumulate?: Record<number,number>): { type: string; label: string } {
  const isSup = m.id === 999;
  if (!isSup && inAbsenta(d, m, 'CM')) return { type: 'CM', label: 'CM' };
  if (!isSup && inAbsenta(d, m, 'AN')) return { type: 'AN', label: 'AN' };
  if (!isSup && inCO(d, m)) return { type: 'CO', label: 'CO' };
  if (isSup) return { type: 'L', label: 'L' };

  const activi = toataEchipa.filter(a => !inCO(d,a) && !inAbsenta(d,a,'any'));
  const poz = activi.findIndex(a => a.id === m.id);
  if (poz === -1) return { type: 'L', label: 'L' };

  // Cu 4+ disponibili si ore acumulate disponibile → rotatie bazata pe echitate
  if (activi.length >= 4 && oreAcumulate && Object.keys(oreAcumulate).length > 0) {
    // Sortam activii dupa ore acumulate (cel cu mai putine → pozitie mai mica → mai multa prioritate)
    const activiSortati = [...activi].sort((a,b) => (oreAcumulate[a.id]||0) - (oreAcumulate[b.id]||0));
    const pozEchitate = activiSortati.findIndex(a => a.id === m.id);
    const n = activiSortati.length;
    // Ciclul zilnic: 2D+1S+rest L, rotat zilnic
    const ref = new Date(2026,0,1);
    const dayIdx = Math.floor((d.getTime()-ref.getTime())/86400000);
    const sec = ((dayIdx + pozEchitate) % n + n) % n;
    if (sec === 0 || sec === 1) return { type: 'D', label: 'D' };
    if (sec === 2) return { type: 'S', label: 'S' };
    return { type: 'L', label: 'L' };
  }

  // Fallback: ciclu fix original (cand nu avem date de ore sau < 4 disponibili)
  const ref = new Date(2026,0,1);
  const dayIdx = Math.floor((d.getTime()-ref.getTime())/86400000);
  const n = activi.length;
  const sec = ((dayIdx+poz)%n+n)%n;
  if (sec===0||sec===1) return { type: 'D', label: 'D' };
  if (sec===2) return { type: 'S', label: 'S' };
  return { type: 'L', label: 'L' };
}

function getTura(d: Date, m: Angajat, toataEchipa: Angajat[], suplinitorActiv: boolean, swapuri: Swap[], turaOverride: TuraOverride[] = [], oreAcumulate?: Record<number,number>): { type: string; label: string; swapped?: boolean } {
  const dStr = fmtDateInput(d);

  // CO/CM/AN au prioritate absoluta
  if (m.id !== 999) {
    if (inAbsenta(d, m, 'CM')) return { type: 'CM', label: 'CM' };
    if (inAbsenta(d, m, 'AN')) return { type: 'AN', label: 'AN' };
    if (inCO(d, m)) return { type: 'CO', label: 'CO' };
  }

  // Override de criză
  const override = turaOverride.find(o =>
    o.angajatId === m.id && o.data === dStr && parseD(o.expiraLa) > d
  );
  if (override) return { type: override.tura, label: override.tura, swapped: false };

  const swA = swapuri.find(sw => sw.aId===m.id && sw.aData===dStr);
  const swB = swapuri.find(sw => sw.bId===m.id && sw.bData===dStr);
  if (swA) {
    const b = toataEchipa.find(x => x.id===swA.bId);
    if (b) { const t=getTuraBaza(parseD(swA.bData),b,toataEchipa,suplinitorActiv,oreAcumulate); if (t.type==='D'||t.type==='S') return {...t,label:t.label+'↔',swapped:true}; }
  }
  if (swB) {
    const a = toataEchipa.find(x => x.id===swB.aId);
    if (a) { const t=getTuraBaza(parseD(swB.aData),a,toataEchipa,suplinitorActiv,oreAcumulate); if (t.type==='D'||t.type==='S') return {...t,label:t.label+'↔',swapped:true}; }
  }
  return getTuraBaza(d, m, toataEchipa, suplinitorActiv, oreAcumulate);
}

// Verifica daca un angajat depaseste 48h/saptamana (Art. 114)
function calcOreSaptamana(m: Angajat, weekStart: Date, echipa: Angajat[], suplinitor: boolean, swapuri: Swap[], turaOverride: TuraOverride[] = []): number {
  let ore = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * 86400000);
    const t = getTura(d, m, echipa, suplinitor, swapuri, turaOverride);
    if (t.type === 'D' || t.type === 'S') ore += 8;
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

function genereazaPlanCriza(echipa: Angajat[], dataStartStr: string, concediiSim: SimConcediu[] = [], simIssues: ConformitateIssue[] = [], dataEndStr?: string): PlanCriza | null {
  const dataStart = parseD(dataStartStr);

  // Angajatii locali activi (fara sef, fara cei in CO/CM/AN sau CO simulat)
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

  const plan: PlanCrizaZi[] = [];
  let rotatieSIdx = 0; // index in activiStart pentru cine face S

  let d = new Date(dataStart);
  const saptamaniProcesate = new Set<string>();

  while (d <= dataEnd) {
    const lu = getMonday(d);
    const luStr = fmtDateInput(lu);
    if (saptamaniProcesate.has(luStr)) {
      d = new Date(d.getTime() + 86400000);
      continue;
    }
    saptamaniProcesate.add(luStr);

    // Zilele acestei saptamani in intervalul crizei
    const zileSapt: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const zi = new Date(lu.getTime() + i * 86400000);
      if (zi >= dataStart && zi <= dataEnd) zileSapt.push(zi);
    }

    const zileWE = zileSapt.filter(z => z.getDay() === 0 || z.getDay() === 6);
    const zileLV = zileSapt.filter(z => z.getDay() >= 1 && z.getDay() <= 5);

    // Ziua suplinitorului: DUMINICA exclusiv.
    // Daca nu exista Duminica in intervalul acestei saptamani → suplinitorul nu vine.
    const ziuaSup = zileWE.find(z => z.getDay() === 0) ?? null;
    // Sambata: zi normala de lucru (localii muncesc)
    const ziuaSa = zileWE.find(z => z.getDay() === 6);

    // Cine face S aceasta saptamana
    const omS = activiStart[rotatieSIdx % activiStart.length].id;
    // Cine face S saptamana urmatoare (incepe Duminica)
    const omSUrmator = activiStart[(rotatieSIdx + 1) % activiStart.length].id;
    rotatieSIdx++;

    const omD = activiStart.map(m => m.id).filter(id => id !== omS);
    const omDUrmator = activiStart.map(m => m.id).filter(id => id !== omSUrmator);

    for (const zi of zileSapt) {
      const ture: Record<number | 'SUP', 'D' | 'S' | 'L' | '2D+2S'> = {} as Record<number | 'SUP', 'D' | 'S' | 'L' | '2D+2S'>;
      echipa.forEach(m => { ture[m.id] = 'L'; });
      ture['SUP'] = 'L';

      let ziuaSupFlag = false;

      if (ziuaSup && fmtDateInput(zi) === fmtDateInput(ziuaSup)) {
        // Duminica: suplinitorul vine (2D+2S), toti localii liberi — zi de tranzitie
        ture['SUP'] = '2D+2S';
        ziuaSupFlag = true;
      } else {
        // Zi normala (Lu-Sa): om_S face S, om_D fac D
        ture[omS] = 'S';
        omD.forEach(id => { ture[id] = 'D'; });
      }

      plan.push({ data: fmtDateInput(zi), ture: ture as Record<number | 'SUP', 'D' | 'S' | 'L' | '2D+2S'>, ziuaSef: ziuaSupFlag, omS });
    }

    d = new Date(lu.getTime() + 7 * 86400000);
  }

  return {
    dataStart: dataStartStr,
    dataPlecareSup: fmtDateInput(dataEnd),
    zileTotal: plan.length,
    zileCuSup: plan.filter(p => p.ziuaSef).length,
    plan,
  };
}
function analizeazaConformitate(echipa: Angajat[], simConcedii: SimConcediu[], suplinitorActiv: boolean, startCheck: Date, zileCheck: number, pragMinimActivi = 3, pragOreMax = 48): ConformitateIssue[] {
  const issues: ConformitateIssue[] = [];
  const zileSet = new Set<string>();

  for (let i = 0; i < zileCheck; i++) {
    const d = new Date(startCheck.getTime() + i * 86400000);
    // Excludem angajatii in concediu simulat SAU in CO/CM/AN real
    const activi = echipa.filter(a => !inSimConcediu(d, a.id, simConcedii) && !inCO(d, a) && !inAbsenta(d, a, 'any'));
    const totalActivi = activi.length + (suplinitorActiv ? 1 : 0);
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
  D:  'bg-sky-800/70 text-sky-100 border border-sky-400/50',
  S:  'bg-purple-800/70 text-purple-100 border border-purple-400/50',
  L:  'bg-white/[0.03] text-zinc-600 border border-transparent',
  CO: 'bg-rose-800/60 text-rose-100 border border-rose-400/40',
  CM: 'bg-orange-800/60 text-orange-100 border border-orange-400/50',
  AN: 'bg-red-800/70 text-red-100 border border-red-400/50',
};

// Stiluri pentru print
const PRINT_STYLES = `
@media print {
  body { background: white !important; color: black !important; font-family: Arial, sans-serif; }
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  .print-table { width: 100%; border-collapse: collapse; }
  .print-table th, .print-table td { border: 1px solid #ccc; padding: 6px 10px; text-align: center; font-size: 11px; }
  .print-table th { background: #0078d4; color: white; font-weight: bold; }
  .print-D { background: #dbeafe; color: #1e40af; font-weight: bold; }
  .print-S { background: #f3e8ff; color: #7e22ce; font-weight: bold; }
  .print-L { background: #f9fafb; color: #9ca3af; }
  .print-CO { background: #fef2f2; color: #dc2626; font-weight: bold; }
  .print-CM { background: #fff7ed; color: #ea580c; font-weight: bold; }
  .print-AN { background: #fef2f2; color: #b91c1c; font-weight: bold; }
  .print-header { margin-bottom: 16px; }
  .print-header h1 { font-size: 20px; font-weight: bold; color: #0078d4; }
  .print-header p { font-size: 12px; color: #666; }
  @page { margin: 1.5cm; size: A4 landscape; }
}
`;

export default function RotaFlow() {
  // ─── State — initial gol, populat din Supabase la montare ───
  const [echipa, setEchipaRaw] = useState<Angajat[]>([]);
  const [swapuri, setSwapuriRaw] = useState<Swap[]>([]);
  const [turaOverride, setTuraOverride] = useState<TuraOverride[]>([]);
  const [log, setLogRaw] = useState<LogEntry[]>([]);
  const [suplinitorActiv, setSuplinitorActivRaw] = useState<boolean>(false);
  const [seIncarca, setSeIncarca] = useState(true);
  const [eroareIncarcare, setEroareIncarcare] = useState<string | null>(null);

  const sloturiRef = useRef<Set<string>>(new Set());
  const [sloturiAlocate, setSloturiAlocate] = useState<Set<string>>(new Set());

  const [weekOffset, setWeekOffset] = useState(0);
  const [activeTab, setActiveTab] = useState<'rota'|'luna'|'stats'|'swap'|'log'>('rota');
  const [showCO, setShowCO] = useState(false);
  const [showUrgente, setShowUrgente] = useState(false);
  const [dragSrc, setDragSrc] = useState<{angajatId: number; data: string; tura: string} | null>(null);
  const [dragOver, setDragOver] = useState<{angajatId: number; data: string} | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [showPlanCriza, setShowPlanCriza] = useState(false);
  const [planCriza, setPlanCriza] = useState<PlanCriza | null>(null);
  const [planCrizaStart, setPlanCrizaStart] = useState(fmtDateInput(new Date()));
  const [planCrizaEnd, setPlanCrizaEnd] = useState('');
  const [planCrizaIssues, setPlanCrizaIssues] = useState<ConformitateIssue[]>([]);
  const [planCrizaSimConcedii, setPlanCrizaSimConcedii] = useState<SimConcediu[]>([]);
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

      const logAdaptat: LogEntry[] = sbIstoric.map(l => ({
        ts: new Date(l.created_at).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) + ' ' + new Date(l.created_at).toLocaleTimeString('ro-RO', { hour:'2-digit', minute:'2-digit' }),
        msg: l.mesaj,
      }));
      setLogRaw(logAdaptat);

      setSuplinitorActivRaw(setari?.suplinitor_activ ?? false);

      const sloturiSet = new Set(echipaAdaptata.flatMap(m => m.concedii.map(c => `${c.s}__${c.e}`)));
      sloturiRef.current = sloturiSet;
      setSloturiAlocate(new Set(sloturiSet));
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
    const perioadaEnd = new Date(weekStart.getTime() - 86400000);
    if (perioadaEnd < perioadaStart) return {};
    const ore: Record<number, number> = {};
    echipa.forEach(m => { ore[m.id] = 0; });
    for (let d = new Date(perioadaStart); d <= perioadaEnd; d = new Date(d.getTime()+86400000)) {
      const activiAzi = echipa.filter(m => !inCO(d, m) && !inAbsenta(d, m, 'any'));
      const n = activiAzi.length;
      if (n === 0) continue;
      activiAzi.forEach((m, idx) => {
        const dayIdx = Math.floor((d.getTime() - new Date(2026,0,1).getTime()) / 86400000);
        const sec = ((dayIdx + idx) % n + n) % n;
        if (sec <= 2) ore[m.id] = (ore[m.id]||0) + 8;
      });
    }
    return ore;
  }, [echipa, weekStart]);

  const getTuraW = useCallback((d: Date, m: Angajat) => getTura(d,m,echipa,suplinitorFinal,swapuri,turaOverride,oreAcumulate), [echipa,suplinitorFinal,swapuri,turaOverride,oreAcumulate]);

  // Alerte ore maxime (Art. 114 — max 48h/saptamana)
  const alerteOre = useMemo(() => {
    return echipa.filter(m => calcOreSaptamana(m, weekStart, echipa, suplinitorFinal, swapuri, turaOverride) > 48).map(m => m.nume);
  }, [echipa, weekStart, suplinitorFinal, swapuri]);

  // Detecteaza daca exista override-uri de criza active (planul de criza e aplicat)
  const crizaActiva = useMemo(() => {
    const azi = new Date(); azi.setHours(0,0,0,0);
    return turaOverride.some(o => o.id.startsWith('criza_') && parseD(o.expiraLa) > azi);
  }, [turaOverride]);

  // Alerta personal insuficient — verifica fiecare zi din saptamana afisata daca raman sub 3 activi
  // (acopera CO/CM/AN reale, nu doar in Simulare — sefii vede problema direct in calendarul normal)
  // criticAchiar = chiar si CU suplinitorul activ tot raman sub 3 -> un singur suplinitor nu ajunge
  // ─── Ore acumulate per angajat din Iunie pana la weekStart (pentru echitate rotatie) ───
  // Folosim ciclul FIX pentru calculul retrospectiv (evitam circularitate)
  const alertePersonalInsuficient = useMemo(() => {
    const rezultate: { zi: Date; totalActivi: number; criticChiarCuSuplinitor: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart.getTime() + i * 86400000);
      const activiReali = echipa.filter(a => !inCO(d,a) && !inAbsenta(d,a,'any'));
      const totalActivi = activiReali.length + (suplinitorFinal ? 1 : 0);
      if (totalActivi < 3) {
        rezultate.push({ zi: d, totalActivi, criticChiarCuSuplinitor: suplinitorFinal && totalActivi < 3 });
      }
    }
    return rezultate;
  }, [echipa, weekStart, suplinitorFinal]);

  const calcScor = useCallback((m: Angajat, refDate: Date) => {
    const yr=refDate.getFullYear(), mo=refDate.getMonth();
    const start=new Date(yr,mo,1), end=new Date(yr,mo+1,0);
    let ore=0,zile=0,sarbLucrate=0,zileCM=0,zileAN=0;
    for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
      const t=getTuraW(new Date(d),m);
      if(t.type==='D'||t.type==='S'){ore+=8;zile++;if(isSarbatoare(new Date(d)))sarbLucrate++;}
      else if(t.type==='CM') zileCM++;
      else if(t.type==='AN') zileAN++;
    }
    return {ore,zile,sarbLucrate,zileCM,zileAN,scor:ore+sarbLucrate*16-zileAN*40};
  }, [getTuraW]);

  // ─── Raport Echitate — calcul pe orice interval [start, end] inclusiv ───
  const calcEchitate = useCallback((m: Angajat, start: Date, end: Date) => {
    let ore=0, nopti=0, weekendZile=0, sarbatoriLucrate=0, ziueLucrate=0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      const cur = new Date(d);
      const t = getTuraW(cur, m);
      if (t.type === 'D' || t.type === 'S') {
        ore += 8;
        ziueLucrate++;
        if (t.type === 'S') nopti++;
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
        const ore = calcOreSaptamana(m, wkStart, echipa, suplinitorFinal, swapuri, turaOverride);
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
  const adaugaConcediu = useCallback((pi: number, slot: {n:string;s:string;e:string}) => {
    const key=`${slot.s}__${slot.e}`;
    if(sloturiRef.current.has(key)) return;
    sloturiRef.current.add(key); setSloturiAlocate(new Set(sloturiRef.current));
    const angajatTarget = echipa[pi];
    if (!angajatTarget?.uuid) return;
    const zl=countZileLucratoareReale(slot.s,slot.e,angajatTarget);

    setEchipa(prev=>{
      const next=prev.map((m,i)=>i!==pi?m:{...m,concedii:[...m.concedii,slot],zileCO:Math.max(0,m.zileCO-zl)});
      return next;
    });
    addLog(`CO adăugat: ${angajatTarget.nume} — ${slot.n}${zl<countZileLucratoare(slot.s,slot.e)?' (zile suprapuse excluse din cost)':''}`);

    apiAdaugaConcediu(angajatTarget.uuid, slot.s, slot.e, slot.n, zl).catch(err => {
      console.error('Eroare la salvarea CO in Supabase:', err);
      incarcaTotul(); // re-sincronizam daca a esuat scrierea
    });
  }, [setEchipa, addLog, echipa, incarcaTotul]);

  const stergeConcediu = useCallback((pi: number, ci: number) => {
    const angajatTarget = echipa[pi];
    const c = angajatTarget?.concedii[ci];
    if (!c) return;
    const key=`${c.s}__${c.e}`;
    sloturiRef.current.delete(key); setSloturiAlocate(new Set(sloturiRef.current));

    // Recalculam zilele de restaurat ca si cum acest concediu nu ar mai exista in lista
    // (evita restaurarea unor zile care erau oricum acoperite de CM/AN/alt CO)
    const angajatFaraAcestConcediu: Angajat = { ...angajatTarget, concedii: angajatTarget.concedii.filter((_,k)=>k!==ci) };
    const zl = countZileLucratoareReale(c.s, c.e, angajatFaraAcestConcediu);

    setEchipa(prev=>prev.map((m,i)=>i!==pi?m:{...m,zileCO:m.zileCO+zl,concedii:m.concedii.filter((_,k)=>k!==ci)}));
    addLog(`CO șters: ${angajatTarget.nume} — ${c.n}`);

    if (c.uuid) {
      apiStergeConcediu(c.uuid).catch(err => {
        console.error('Eroare la stergerea CO din Supabase:', err);
        incarcaTotul();
      });
    }
  }, [setEchipa, addLog, echipa, incarcaTotul]);


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
    const turaA = getTuraBaza(parseD(swAData), a, echipa, suplinitorFinal);
    const turaB = getTuraBaza(parseD(swBData), b, echipa, suplinitorFinal);
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
    const oreDest = calcOreSaptamana(destAngajat, weekStart, echipa, suplinitorFinal, swapuri, turaOverride);
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

    const noileOverride: TuraOverride[] = [];
    // expiraLa = ziua DUPA ultima zi de criza (override-urile se aplica inclusiv pe ultima zi)
    const dataUltimaZi = parseD(planCriza.dataPlecareSup);
    const ziuaDupaUltima = new Date(dataUltimaZi.getTime() + 86400000);
    const expiraLa = fmtDateInput(ziuaDupaUltima);

    planCriza.plan.forEach(zi => {
      if (zi.ziuaSef) {
        // Duminica — suplinitorul vine (2D+2S), toti localii liberi
        noileOverride.push({
          id: `criza_SUP_${zi.data}`,
          angajatId: 999,
          data: zi.data,
          tura: 'D',
          expiraLa,
        });
        echipa.forEach(m => {
          noileOverride.push({
            id: `criza_${m.id}_${zi.data}`,
            angajatId: m.id,
            data: zi.data,
            tura: 'L',
            expiraLa,
          });
        });
      } else {
        // Zi normala — aplicam direct turele din plan
        echipa.forEach(m => {
          const turaPlan = zi.ture[m.id] as string | undefined;
          if (!turaPlan) return;
          noileOverride.push({
            id: `criza_${m.id}_${zi.data}`,
            angajatId: m.id,
            data: zi.data,
            tura: turaPlan as 'D'|'S'|'L',
            expiraLa,
          });
        });
      }
    });

    // Override de tranzitie: ziua dupa criza
    // Regula: cei care au muncit in criza primesc libere, cei din CO intra la tura
    const ultimaZiPlan = planCriza.plan.filter(z => !z.ziuaSef).pop();
    if (ultimaZiPlan) {
      const dataTransitie = fmtDateInput(ziuaDupaUltima);
      const expiraTransitie = fmtDateInput(new Date(ziuaDupaUltima.getTime() + 86400000));

      // Calculam ore lucrate in criza pentru fiecare local activ
      const oreInCriza: Record<number, number> = {};
      echipa.forEach(m => {
        oreInCriza[m.id] = planCriza.plan.reduce((acc, zi) => {
          const t = zi.ture[m.id] as string | undefined;
          return acc + (t === 'D' || t === 'S' ? 8 : 0);
        }, 0);
      });

      // Cei care revin din CO in ziua tranzitiei
      const revinDinCO = echipa.filter(m =>
        inCO(parseD(planCriza.dataPlecareSup), m) && !inCO(ziuaDupaUltima, m)
      );

      // Cei care au muncit in criza (activi in criza, nu in CO)
      const auMuncitInCriza = echipa.filter(m =>
        !inCO(parseD(planCriza.dataStart), m) && oreInCriza[m.id] > 0
      );

      // Sortam dupa ore descrescator — cei mai obositi primii la liber
      auMuncitInCriza.sort((a, b) => (oreInCriza[b.id] || 0) - (oreInCriza[a.id] || 0));

      // Avem nevoie de 2D+1S pe ziua tranzitiei
      // Cei din CO intra obligatoriu + cel putin 1 local continua
      const nrNecesar = 3; // 2D+1S = 3 oameni
      const nrRevin = revinDinCO.length;
      const nrLocaliNecesari = Math.max(0, nrNecesar - nrRevin);

      // Cei care iau liber: toti localii obositi minus cei necesari
      // + cel cu S in ultima zi (S->D interzis)
      const auFacutS = auMuncitInCriza.filter(m => {
        const t = ultimaZiPlan.ture[m.id] as string | undefined;
        return t === 'S';
      });

      const liberiTranzitie = new Set<number>();
      // 1. Fortat liber: cel cu S ieri
      auFacutS.forEach(m => liberiTranzitie.add(m.id));

      // 2. Meritat liber: localii obositi (cei cu mai multe ore), pastram doar nrLocaliNecesari
      let localiDisponibili = auMuncitInCriza.filter(m =>
        !liberiTranzitie.has(m.id) && !auFacutS.some(s => s.id === m.id)
      );
      // Pastram primii nrLocaliNecesari, restul iau liber
      localiDisponibili.slice(nrLocaliNecesari).forEach(m => liberiTranzitie.add(m.id));

      // Aplicam override-uri de tranzitie
      // Liberi
      liberiTranzitie.forEach(id => {
        noileOverride.push({
          id: `criza_tranzitie_${id}_${dataTransitie}`,
          angajatId: id,
          data: dataTransitie,
          tura: 'L',
          expiraLa: expiraTransitie,
        });
      });

      // Cei din CO care revin si rotatia normala ii pune pe L → D
      revinDinCO.forEach(m => {
        const tNormala = getTuraBaza(ziuaDupaUltima, m, echipa, false);
        const areOverride = noileOverride.some(o => o.angajatId === m.id && o.data === dataTransitie);
        if (tNormala.type === 'L' && !areOverride) {
          noileOverride.push({
            id: `criza_tranzitie_${m.id}_${dataTransitie}`,
            angajatId: m.id,
            data: dataTransitie,
            tura: 'D',
            expiraLa: expiraTransitie,
          });
        }
      });
    }

    // Override saptamana de compensare: saptamana URMATOARE dupa criza
    // (nu saptamana care contine ziuaDupaUltima — aceea poate overlap cu criza)
    // Reveniții din CO au prioritate la ture (target 40h),
    // cei care au muncit in criza au prioritate la libere (target 32h)
    {
      const luniComp = new Date(getMonday(ziuaDupaUltima).getTime() + 7 * 86400000);
      const sfComp = new Date(luniComp.getTime() + 6 * 86400000);
      const expiraComp = fmtDateInput(new Date(luniComp.getTime() + 7 * 86400000));

      const reveniti = echipa.filter(m =>
        inCO(parseD(planCriza.dataPlecareSup), m) && !inCO(ziuaDupaUltima, m)
      );
      const auMuncit = echipa.filter(m =>
        !inCO(parseD(planCriza.dataStart), m)
      );

      // Target ore: reveniti 40h, obositi 32h
      const targetOre: Record<number, number> = {};
      echipa.forEach(m => {
        targetOre[m.id] = reveniti.some(r => r.id === m.id) ? 40 : 32;
      });

      const oreAcc: Record<number, number> = {};
      const sCnt: Record<number, number> = {};
      const dCnt: Record<number, number> = {};
      echipa.forEach(m => { oreAcc[m.id] = 0; sCnt[m.id] = 0; dCnt[m.id] = 0; });

      // Tura din Duminica DINAINTEA saptamanii de compensare (ziua precedenta lui luniComp)
      const ziDuDinainteSapt = new Date(luniComp.getTime() - 86400000);
      const turaPrevComp: Record<number, string> = {};
      echipa.forEach(m => {
        // Cautam override activ pentru acea zi, altfel rotatie normala
        const ovPrev = noileOverride.find(o =>
          o.angajatId === m.id &&
          o.data === fmtDateInput(ziDuDinainteSapt) &&
          parseD(o.expiraLa) > ziDuDinainteSapt
        );
        turaPrevComp[m.id] = ovPrev?.tura ?? getTuraBaza(ziDuDinainteSapt, m, echipa, false).type;
      });

      for (let i = 0; i < 7; i++) {
        const d = new Date(luniComp.getTime() + i * 86400000);
        // Sarim ziua tranzitiei (deja tratata)
        if (fmtDateInput(d) === fmtDateInput(ziuaDupaUltima)) continue;
        // Sarim zilele in afara intervalului saptamanii
        if (d < luniComp || d > sfComp) continue;

        const dStr = fmtDateInput(d);

        // Disponibili: sub limita de ore si nu in CO
        const potLucra = echipa.filter(m =>
          !inCO(d, m) && !inAbsenta(d, m, 'any') &&
          (oreAcc[m.id] || 0) + 8 <= targetOre[m.id]
        );

        // STEP 1: Alege S - cel cu cele mai putine S-uri (echitate D/S)
        // Revenitul din CO are prioritate MICA la S (el ia mai multe D)
        const candidatiS = potLucra
          .slice()
          .sort((a,b) => (sCnt[a.id]||0)-(sCnt[b.id]||0) || (reveniti.some(r=>r.id===a.id)?1:0)-(reveniti.some(r=>r.id===b.id)?1:0));
        const alesS = candidatiS[0]?.id ?? null;

        // STEP 2: Alege 2xD - nu poate fi cel cu S, nu poate fi cel cu S ieri
        const potDStrict = potLucra.filter(m => m.id !== alesS && turaPrevComp[m.id] !== 'S');
        const potDSort = potDStrict
          .slice()
          .sort((a,b) => (dCnt[a.id]||0)-(dCnt[b.id]||0) || (reveniti.some(r=>r.id===a.id)?0:1)-(reveniti.some(r=>r.id===b.id)?0:1));
        let alesiD = potDSort.slice(0,2).map(m=>m.id);

        // Fallback: daca nu avem 2D (ex: prea multi au facut S ieri)
        if (alesiD.length < 2) {
          const extra = potLucra
            .filter(m => m.id !== alesS && !alesiD.includes(m.id))
            .sort((a,b) => (dCnt[a.id]||0)-(dCnt[b.id]||0));
          alesiD = [...alesiD, ...extra.slice(0, 2-alesiD.length).map(m=>m.id)];
        }

        // Cream override-uri doar unde difera de rotatia normala
        echipa.forEach(m => {
          const turaPlanuita: 'D'|'S'|'L' = alesiD.includes(m.id) ? 'D' : m.id === alesS ? 'S' : 'L';
          const turaNorm = getTuraBaza(d, m, echipa, false);
          if (turaPlanuita !== turaNorm.type) {
            noileOverride.push({
              id: `criza_comp_${m.id}_${dStr}`,
              angajatId: m.id,
              data: dStr,
              tura: turaPlanuita,
              expiraLa: expiraComp,
            });
          }
          turaPrevComp[m.id] = turaPlanuita;
          if (turaPlanuita === 'D') {
            oreAcc[m.id] = (oreAcc[m.id] || 0) + 8;
            dCnt[m.id] = (dCnt[m.id] || 0) + 1;
          } else if (turaPlanuita === 'S') {
            oreAcc[m.id] = (oreAcc[m.id] || 0) + 8;
            sCnt[m.id] = (sCnt[m.id] || 0) + 1;
          }
        });
      }
    }

    setCrizaAplicataInterval({ start: planCriza.dataStart, end: planCriza.dataPlecareSup });
    setTuraOverride(prev => [...prev.filter(o => !o.id.startsWith('criza_')), ...noileOverride]);

    const zileSup = planCriza.plan.filter(zi => zi.ziuaSef).map(zi => fmtDate(parseD(zi.data))).join(', ');
    addLog(`Plan Criză aplicat: ${noileOverride.length} override-uri până la ${expiraLa}. Suplinitori Duminica: ${zileSup}`);
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

      return { ...m, concedii: [...m.concedii, ...noiConcedii], zileCO: Math.max(0, m.zileCO - zileTotale) };
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

    doc.setFontSize(16); doc.setTextColor(0, 120, 212);
    doc.text(faraDiacritice(`RotaFlow — Pontaj ${luna}`), 14, 14);
    doc.setFontSize(9); doc.setTextColor(100,100,100);
    doc.text(faraDiacritice(`Generat: ${fmtTs(new Date())}`), 14, 20);

    // Tabel ture zilnice
    const zileCols = Array.from({length:nrZile},(_,i)=>(i+1).toString());
    const head = [['Angajat', ...zileCols]];
    const body = echipa.map(m => {
      const row: string[] = [faraDiacritice(m.nume)];
      for(let i=0;i<nrZile;i++){
        const d=new Date(yr,mo,i+1);
        const t=getTuraW(d,m);
        const base=t.type.replace('↔','');
        row.push(base==='D'?'D':base==='S'?'S':base==='CO'?'CO':base==='CM'?'CM':base==='AN'?'AN':'L');
      }
      return row;
    });

    autoTable(doc, {
      head, body, startY: 25,
      styles: { fontSize: 7, cellPadding: 2, halign: 'center' },
      headStyles: { fillColor: [0,120,212], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 0: { halign: 'left', cellWidth: 28, fontStyle: 'bold' } },
      didParseCell: (data) => {
        const v = data.cell.raw as string;
        if(v==='D') { data.cell.styles.fillColor=[219,234,254]; data.cell.styles.textColor=[30,64,175]; }
        else if(v==='S') { data.cell.styles.fillColor=[243,232,255]; data.cell.styles.textColor=[126,34,206]; }
        else if(v==='CO') { data.cell.styles.fillColor=[254,242,242]; data.cell.styles.textColor=[185,28,28]; }
        else if(v==='CM') { data.cell.styles.fillColor=[255,247,237]; data.cell.styles.textColor=[194,65,12]; }
        else if(v==='AN') { data.cell.styles.fillColor=[254,226,226]; data.cell.styles.textColor=[153,27,27]; }
      }
    });

    // Tabel statistici
    const statsY = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(11); doc.setTextColor(0,120,212);
    doc.text(faraDiacritice('Statistici lunare'), 14, statsY);
    autoTable(doc, {
      head:[['Angajat','Zile lucrate','Ore lucrate','Sarbatori lucrate','CO ramas','CM','Abs. Nemot.','Scor performanta']],
      body: echipa.map(m=>{
        const s=calcScor(m,refDate);
        return[faraDiacritice(m.nume),s.zile.toString(),`${s.ore}h`,s.sarbLucrate.toString(),m.zileCO.toString(),s.zileCM.toString(),s.zileAN.toString(),`${s.scor}p`];
      }),
      startY: statsY+4, styles:{fontSize:9}, headStyles:{fillColor:[0,120,212]},
    });

    doc.save(`RotaFlow_Pontaj_${luna.replace(' ','_')}.pdf`);
    addLog(`PDF exportat: ${luna}`);
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

  const displayEchipa = useMemo(()=>{
    const azi = new Date(); azi.setHours(0,0,0,0);
    const areOverrideSup = turaOverride.some(o => o.angajatId === 999 && parseD(o.expiraLa) > azi);
    return (suplinitorFinal || areOverrideSup) ? [...echipa, SUPLINITOR_OBJ] : echipa;
  },[echipa, suplinitorFinal, turaOverride]);
  const clasament = useMemo(()=>[...echipa].map(m=>({...m,...calcScor(m,weekStart)})).sort((a,b)=>b.scor-a.scor),[echipa,weekStart,calcScor]);

  // ─── Tabel Ore & Suplimentare ───
  const tabelOre = useMemo(() => {
    const displayEchipaOre = suplinitorFinal ? [...echipa, SUPLINITOR_OBJ] : echipa;
    return displayEchipaOre.map((m, i) => {
      const oreSapt = calcOreSaptamana(m, weekStart, echipa, suplinitorFinal, swapuri, turaOverride);
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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#60cdff] to-[#0078d4] flex items-center justify-center text-[14px] font-black text-white shadow-lg shadow-[#0078d4]/30">R</div>
            <span className="font-bold text-[16px] tracking-tight">RotaFlow</span>
            {modeAvarie && (
              <span className="flex items-center gap-1 bg-orange-950/60 border border-orange-500/40 text-orange-300 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                <AlertTriangle size={9}/> AVARIE
              </span>
            )}
            {alerteOre.length > 0 && (
              <span className="flex items-center gap-1 bg-red-950/60 border border-red-500/40 text-red-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <AlertTriangle size={9}/> {alerteOre.join(', ')} &gt;48h/săpt!
              </span>
            )}
            {alertePersonalInsuficient.length > 0 && (
              <span className="flex items-center gap-1 bg-amber-950/60 border border-amber-500/40 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <AlertTriangle size={9}/> Personal insuficient — {alertePersonalInsuficient.length} {alertePersonalInsuficient.length===1?'zi':'zile'}!
              </span>
            )}
            {crizaActiva && (
              <span onClick={()=>setShowPlanCriza(true)} className="flex items-center gap-1 bg-orange-950/60 border border-orange-500/40 text-orange-300 text-[10px] font-bold px-2 py-0.5 rounded-full cursor-pointer hover:bg-orange-900/50 transition-colors">
                ⚡ Plan Criză activ
              </span>
            )}
          </div>
          <div className="flex gap-1">
            {([['rota','Rotație'],['luna','Calendar'],['stats','Statistici'],['swap','Swap'],['log','Istoric']] as const).map(([t,l])=>(
              <button key={t} onClick={()=>setActiveTab(t)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${activeTab===t?'bg-white/10 text-white':'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-2 relative">
            <button onClick={()=>{ setPdfLunaDate(`${weekStart.getFullYear()}-${String(weekStart.getMonth()+1).padStart(2,'0')}`); setShowPdfPicker(p=>!p); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-900/40 border border-emerald-500/30 text-emerald-300 text-[12px] font-semibold hover:bg-emerald-800/50 transition-all">
              <FileDown size={13}/> PDF
            </button>
            {showPdfPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={()=>setShowPdfPicker(false)}/>
                <div className="absolute top-9 left-0 z-50 bg-[#2c2c2e] border border-white/[0.1] rounded-xl shadow-2xl p-3 w-56" onClick={e=>e.stopPropagation()}>
                <p className="text-[11px] text-zinc-400 font-semibold mb-2">Alege luna pentru PDF:</p>
                <input type="month" value={pdfLunaDate}
                  onChange={e=>setPdfLunaDate(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-[12px] text-white outline-none focus:border-emerald-500/50 transition-all mb-2"/>
                <button onClick={()=>{
                  const [yr, mo] = pdfLunaDate.split('-').map(Number);
                  generatePDF(new Date(yr, mo-1, 1));
                  setShowPdfPicker(false);
                }} className="w-full bg-emerald-900/50 border border-emerald-500/40 text-emerald-300 text-[12px] font-semibold py-1.5 rounded-lg hover:bg-emerald-800/60 transition-all flex items-center justify-center gap-1.5">
                  <FileDown size={12}/> Generează PDF
                </button>
              </div>
              </>
            )}
            <button onClick={()=>window.print()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-300 text-[12px] font-semibold hover:bg-zinc-700 transition-all">
              <Printer size={13}/> Print
            </button>
            <button onClick={()=>setShowCO(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-900/40 border border-sky-500/30 text-sky-300 text-[12px] font-semibold hover:bg-sky-800/50 transition-all">
              <Calendar size={13}/> Concedii
            </button>
            <button onClick={()=>setShowUrgente(true)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition-all ${modeAvarie?'bg-orange-900/50 border-orange-500/50 text-orange-300 animate-pulse':'bg-rose-900/40 border-rose-500/30 text-rose-300 hover:bg-rose-800/50'}`}>
              <AlertTriangle size={13}/> Urgențe
            </button>
            <button onClick={()=>setShowSimulare(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-900/40 border border-purple-500/30 text-purple-300 text-[12px] font-semibold hover:bg-purple-800/50 transition-all">
              <FlaskConical size={13}/> Simulare Concedii
            </button>
            <button onClick={()=>{
              // Detectam automat criza din CO-urile reale
              // Criza = mai putin de 4 angajati activi (necesarul minim fara suplinitor)
              const azi = new Date(); azi.setHours(0,0,0,0);
              let primaZiCriza = '';
              let ultimaZiCriza = '';
              const issuesReale: ConformitateIssue[] = [];

              for (let i = 0; i < 90; i++) {
                const d = new Date(azi.getTime() + i * 86400000);
                const activi = echipa.filter(m => !inCO(d, m) && !inAbsenta(d, m, 'any'));
                if (activi.length < 4) {
                  const dStr = fmtDateInput(d);
                  if (!primaZiCriza) primaZiCriza = dStr;
                  ultimaZiCriza = dStr;
                  issuesReale.push({
                    tip: 'PUTINI_OAMENI',
                    data: dStr,
                    detalii: `${fmtDate(d)}: ${activi.length} activi din ${echipa.length} (necesari minim 4 fără suplinitor)`
                  });
                }
              }

              if (primaZiCriza) {
                setPlanCrizaStart(primaZiCriza);
                setPlanCrizaEnd(ultimaZiCriza);
                setPlanCrizaIssues(issuesReale);
                setPlanCrizaSimConcedii([]);
                const p = genereazaPlanCriza(echipa, primaZiCriza, [], issuesReale, ultimaZiCriza);
                if (p) setPlanCriza(p);
              } else {
                setPlanCrizaStart(fmtDateInput(azi));
                setPlanCrizaEnd('');
                setPlanCrizaIssues([]);
                setPlanCrizaSimConcedii([]);
                setPlanCriza(null);
              }
              setShowPlanCriza(true);
            }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/40 border border-red-500/30 text-red-300 text-[12px] font-semibold hover:bg-red-800/50 transition-all">
              <AlertTriangle size={13}/> Plan Criză
            </button>
          </div>
        </div>

        {/* Print header — vizibil doar la print */}
        <div className="print-only hidden p-6 print-header">
          <h1>RotaFlow — {fmtMonth(lunaStart)}</h1>
          <p>Generat: {fmtTs(new Date())}</p>
        </div>

        <div className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full space-y-5">

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
          {alertePersonalInsuficient.length > 0 && (
            <div className={`border rounded-xl p-4 no-print ${alertePersonalInsuficient.some(a=>a.criticChiarCuSuplinitor)?'bg-red-950/50 border-red-500/50':'bg-amber-950/40 border-amber-500/40'}`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={alertePersonalInsuficient.some(a=>a.criticChiarCuSuplinitor)?'text-red-400 flex-shrink-0 mt-0.5':'text-amber-400 flex-shrink-0 mt-0.5'} size={16}/>
                <div className="flex-1 min-w-0">
                  <p className={alertePersonalInsuficient.some(a=>a.criticChiarCuSuplinitor)?'text-red-300 text-[12px]':'text-amber-300 text-[12px]'}>
                    <span className="font-bold">
                      {alertePersonalInsuficient.some(a=>a.criticChiarCuSuplinitor) ? 'CRITIC — chiar și cu Suplinitorul activ:' : 'Personal insuficient:'}
                    </span>{' '}
                    {alertePersonalInsuficient.map(a=>`${fmtDate(a.zi)} (${a.totalActivi} activi)`).join(', ')} — minim recomandat 3 angajați activi.
                  </p>
                  <button
                    onClick={()=>{
                      // Folosim prima zi cu problema ca data de start a planului de criza
                      const primaZiCriza = fmtDateInput(alertePersonalInsuficient[0].zi);
                      setPlanCrizaStart(primaZiCriza);
                      const p = genereazaPlanCriza(echipa, primaZiCriza);
                      setPlanCriza(p);
                      setShowPlanCriza(true);
                    }}
                    className={`mt-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                      alertePersonalInsuficient.some(a=>a.criticChiarCuSuplinitor)
                        ? 'bg-red-900/50 border border-red-500/40 text-red-200 hover:bg-red-800/60'
                        : 'bg-amber-900/50 border border-amber-500/40 text-amber-200 hover:bg-amber-800/60'
                    }`}>
                    <AlertTriangle size={11}/>
                    Generează Plan de Criză automat →
                  </button>
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
              const oreS=calcOreSaptamana(m,weekStart,echipa,suplinitorFinal,swapuri,turaOverride);
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
              <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[12px] text-zinc-300">Rotație săptămânală</span>
                  <span className="text-[10px] text-zinc-600 bg-white/5 px-2 py-0.5 rounded-full">
                    {modeAvarie?`Avarie · ciclu ${displayEchipa.filter(m=>!days.some(d=>inAbsenta(d,m,'any')||inCO(d,m))).length}`:'Normal · ciclu 5'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={()=>setWeekOffset(o=>o-1)} className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/[0.08] rounded-md transition-all text-zinc-400"><ChevronLeft size={13}/></button>
                  <span className="text-[11px] font-mono text-zinc-400 min-w-[120px] text-center">{fmtDate(days[0])} – {fmtDate(days[6])}</span>
                  <button onClick={()=>setWeekOffset(o=>o+1)} className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/[0.08] rounded-md transition-all text-zinc-400"><ChevronRight size={13}/></button>
                </div>
              </div>
              <div className="overflow-x-auto p-4">
                <table className="w-full border-separate border-spacing-2">
                  <thead>
                    <tr>
                      <th className="text-left text-[12px] font-semibold text-zinc-400 uppercase tracking-wider pl-3 pb-2 w-44">Angajat</th>
                      {days.map((d,i)=>(
                        <th key={i} className={`text-center text-[12px] font-semibold uppercase tracking-wider pb-2 ${isSarbatoare(d)?'text-amber-400':'text-zinc-400'}`}>
                          {DAY_SHORT[i]}<br/><span className="text-[11px] font-normal opacity-60">{fmtDate(d)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayEchipa.map((m,mi)=>{
                      const oreS=calcOreSaptamana(m,weekStart,echipa,suplinitorFinal,swapuri,turaOverride);
                      return (
                        <tr key={mi}>
                          <td className="pl-3 pr-4 py-1.5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                                style={{background:AVATAR_COLORS[mi%5]+'22',color:AVATAR_COLORS[mi%5],border:`1.5px solid ${AVATAR_COLORS[mi%5]}55`}}>
                                {m.nume.substring(0,2).toUpperCase()}
                              </div>
                              <div>
                                <span className="font-semibold text-[14px] whitespace-nowrap text-zinc-100">{m.nume}</span>
                                {oreS>0&&<span className={`ml-2 text-[10px] ${oreS>48?'text-red-400 font-bold':'text-zinc-600'}`}>{oreS}h</span>}
                              </div>
                            </div>
                          </td>
                          {days.map((d,di)=>{
                            const t=getTuraW(d,m);
                            const sarb=isSarbatoare(d);
                            const baseType=t.type.replace('↔','');
                            const style=SHIFT_STYLE[baseType]??SHIFT_STYLE.L;
                            const dStr=fmtDateInput(d);
                            const isDragSrc=dragSrc?.angajatId===m.id&&dragSrc?.data===dStr;
                            const isDragOver=dragOver?.angajatId===m.id&&dragOver?.data===dStr;
                            const isDraggable=!['CO','CM','AN'].includes(baseType);
                            return (
                              <td key={di} className="text-center">
                                <div
                                  draggable={isDraggable}
                                  onDragStart={isDraggable ? ()=>setDragSrc({angajatId:m.id,data:dStr,tura:baseType}) : undefined}
                                  onDragEnd={()=>{setDragSrc(null);setDragOver(null);}}
                                  onDragOver={e=>{e.preventDefault();setDragOver({angajatId:m.id,data:dStr});}}
                                  onDragLeave={()=>setDragOver(null)}
                                  onDrop={e=>{
                                    e.preventDefault();
                                    if(dragSrc && dragSrc.data===dStr && dragSrc.angajatId!==m.id){
                                      aplicaDragDrop(dragSrc, m.id);
                                    }
                                    setDragOver(null);
                                  }}
                                  className={`relative text-[13px] font-black py-3 px-2 rounded-xl transition-all
                                    ${style}
                                    ${t.swapped?'ring-2 ring-amber-400/60':''}
                                    ${isDragSrc?'opacity-40 scale-95':''}
                                    ${isDragOver&&dragSrc&&dragSrc.data===dStr&&dragSrc.angajatId!==m.id?'ring-2 ring-white/60 scale-105':''}
                                    ${isDraggable&&!isDragSrc?'cursor-grab active:cursor-grabbing':'cursor-default'}
                                  `}>
                                  {t.label}
                                  {sarb&&!['L','CO','CM','AN'].includes(baseType)&&<span className="absolute -top-1.5 -right-1 text-amber-400 text-[10px]">★</span>}
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
                {[['sky','Dimineață'],['purple','Seară'],['zinc','Liber'],['rose','CO'],['orange','CM'],['red','Abs. Nemot.']].map(([c,l])=>(
                  <div key={l} className="flex items-center gap-2 text-[12px] text-zinc-400">
                    <div className={`w-3 h-3 rounded-md bg-${c}-900/70 border border-${c}-500/30`}/>{l}
                  </div>
                ))}
                <div className="flex items-center gap-2 text-[12px] text-zinc-400"><span className="text-amber-400/80 text-[11px]">↔</span> Swap</div>
                <div className="flex items-center gap-2 text-[12px] text-zinc-400"><span className="text-amber-400">★</span> Sărbătoare</div>
                <div className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-600">
                  <span>✥</span> Trage o celulă pe alta pentru a schimba turele
                </div>
              </div>
              {dragError && (
                <div className="mx-4 mb-3 flex items-center gap-2 bg-red-950/60 border border-red-500/40 text-red-300 text-[12px] font-semibold px-4 py-2 rounded-xl animate-pulse">
                  <AlertTriangle size={14}/> {dragError}
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
                <table className="w-full border-separate border-spacing-1 print-table">
                  <thead>
                    <tr>
                      <th className="text-left text-[11px] font-semibold text-zinc-500 uppercase pl-2 pb-1 w-32">Angajat</th>
                      {zileLuna.map((d,i)=>(
                        <th key={i} className={`text-center text-[10px] font-semibold pb-1 min-w-[32px] ${isSarbatoare(d)?'text-amber-400':d.getDay()===0||d.getDay()===6?'text-zinc-500':'text-zinc-400'}`}>
                          {d.getDate()}<br/>
                          <span className="text-[8px] font-normal opacity-60">{DAY_SHORT[(d.getDay()+6)%7]}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {echipa.map((m,mi)=>(
                      <tr key={mi}>
                        <td className="pl-2 pr-2 py-1">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                              style={{background:AVATAR_COLORS[mi%5]+'22',color:AVATAR_COLORS[mi%5],border:`1px solid ${AVATAR_COLORS[mi%5]}44`}}>
                              {m.nume.substring(0,2).toUpperCase()}
                            </div>
                            <span className="font-semibold text-[12px] whitespace-nowrap">{m.nume}</span>
                          </div>
                        </td>
                        {zileLuna.map((d,di)=>{
                          const t=getTuraW(d,m);
                          const sarb=isSarbatoare(d);
                          const baseType=t.type.replace('↔','');
                          const style=SHIFT_STYLE[baseType]??SHIFT_STYLE.L;
                          return (
                            <td key={di} className="text-center">
                              <div className={`relative text-[10px] font-black py-1.5 rounded-lg ${style} ${sarb&&!['L','CO','CM','AN'].includes(baseType)?'ring-1 ring-amber-400/50':''} print-${baseType}`}>
                                {t.label}
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
                  {echipa.map((m,i)=>{
                    const st=calcScor(m,weekStart);
                    return (
                      <div key={i} className="bg-black/20 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{background:AVATAR_COLORS[i%5]+'22',color:AVATAR_COLORS[i%5],border:`1px solid ${AVATAR_COLORS[i%5]}44`}}>
                            {m.nume.substring(0,2).toUpperCase()}
                          </div>
                          <span className="font-semibold text-[13px]">{m.nume}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                          {[{v:`${st.ore}h`,l:'Ore',c:'text-[#60cdff]'},{v:st.zile,l:'Zile',c:'text-[#60cdff]'},{v:st.sarbLucrate,l:'Sărb.',c:'text-amber-400'}].map(({v,l,c})=>(
                            <div key={l} className="bg-black/30 rounded-lg py-1.5 text-center">
                              <div className={`text-[13px] font-bold ${c}`}>{v}</div>
                              <div className="text-[9px] text-zinc-500 mt-0.5">{l}</div>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {[{v:st.zileCM,l:'CM',c:'text-orange-400'},{v:st.zileAN,l:'Abs.N.',c:'text-red-400'},{v:m.zileCO,l:'CO răm.',c:'text-zinc-300'}].map(({v,l,c})=>(
                            <div key={l} className="bg-black/30 rounded-lg py-1.5 text-center">
                              <div className={`text-[13px] font-bold ${c}`}>{v}</div>
                              <div className="text-[9px] text-zinc-500 mt-0.5">{l}</div>
                            </div>
                          ))}
                        </div>
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
                    const turaLabel=angajat?((t)=>t.label==='D'?'Dimineață':t.label==='S'?'Seară':t.label)(getTuraBaza(parseD(side.data),angajat,echipa,suplinitorFinal)):'—';
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
                    const turaA=getTuraBaza(parseD(swAData),a,echipa,suplinitorFinal);
                    const turaB=getTuraBaza(parseD(swBData),b,echipa,suplinitorFinal);
                    const problemaA = turaA.type!=='D'&&turaA.type!=='S';
                    const problemaB = turaB.type!=='D'&&turaB.type!=='S';
                    if (!problemaA && !problemaB) return null;
                    return (
                      <p className="text-[10px] text-red-400 mb-2">
                        {problemaA && `${a.nume} nu are tură de lucru pe ${fmtDate(parseD(swAData))} (${turaA.label}). `}
                        {problemaB && `${b.nume} nu are tură de lucru pe ${fmtDate(parseD(swBData))} (${turaB.label}). `}
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

        {/* ── Modal CO ── */}
        {showCO&&(
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 no-print">
            <div className="bg-[#2c2c2e] border border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] flex-shrink-0">
                <span className="font-bold text-[14px]">Planificare Concedii</span>
                <button onClick={()=>setShowCO(false)} className="w-6 h-6 flex items-center justify-center bg-white/[0.07] hover:bg-rose-900/50 text-zinc-400 hover:text-rose-300 rounded-md transition-all"><X size={14}/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {echipa.map((m,i)=>(
                  <div key={i}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-[13px]" style={{color:AVATAR_COLORS[i%5]}}>{m.nume}</span>
                      <span className="text-[11px] text-zinc-500">{m.zileCO} zile rămase</span>
                    </div>
                    {m.concedii.length>0&&(
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {m.concedii.map((c,ci)=>(
                          <span key={ci} className="flex items-center gap-1 bg-rose-950/40 border border-rose-500/25 text-rose-400 text-[10px] px-2 py-0.5 rounded-full">
                            {c.n}<button onClick={()=>stergeConcediu(i,ci)} className="ml-1 leading-none hover:text-rose-200">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="space-y-3">
                      {Object.entries(SLOTS).map(([sezon,sloturi])=>(
                        <div key={sezon}>
                          <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider mb-1.5">{sezon}</p>
                          <div className="grid grid-cols-3 gap-1.5">
                            {sloturi.map((sl,si)=>{
                              const key=`${sl.s}__${sl.e}`, luat=sloturiAlocate.has(key);
                              return (
                                <button key={si} disabled={luat} onClick={()=>adaugaConcediu(i,sl)}
                                  className={`text-left px-2.5 py-1.5 text-[10px] border rounded-lg transition-all select-none ${luat?'bg-white/[0.02] border-white/[0.04] text-zinc-700 cursor-not-allowed line-through':'bg-white/[0.04] border-white/[0.07] text-zinc-400 hover:bg-sky-900/30 hover:border-sky-500/40 hover:text-sky-300 active:scale-95'}`}>
                                  {sl.n}{luat?' ✓':''}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
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

              {/* Selector perioadă criză */}
              <div className="px-6 py-4 border-b border-white/[0.07] space-y-3">
                {planCrizaIssues.length > 0 && planCrizaStart && planCrizaEnd ? (
                  <div className="bg-red-950/40 border border-red-500/30 rounded-lg px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2 text-[11px] text-red-300 font-semibold">
                      <AlertTriangle size={12}/>
                      <span>Perioadă cu probleme detectată automat — {fmtDate(parseD(planCrizaStart))} → {fmtDate(parseD(planCrizaEnd))}</span>
                    </div>
                    <div className="space-y-0.5 max-h-24 overflow-y-auto">
                      {planCrizaIssues.slice(0,5).map((iss,i) => (
                        <p key={i} className="text-[10px] text-red-400/80 pl-4">· {iss.detalii}</p>
                      ))}
                      {planCrizaIssues.length > 5 && <p className="text-[10px] text-red-500/60 pl-4">...și încă {planCrizaIssues.length-5} zile similare</p>}
                    </div>
                    <p className="text-[10px] text-zinc-500 pl-4">Poți ajusta manual datele de mai jos.</p>
                  </div>
                ) : null}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-zinc-400 whitespace-nowrap font-semibold">Start:</label>
                    <input type="date" value={planCrizaStart}
                      onChange={e => { setPlanCrizaStart(e.target.value); setPlanCriza(null); }}
                      className="bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-[12px] text-white outline-none focus:border-red-500/50 transition-all"/>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-zinc-400 whitespace-nowrap font-semibold">End:</label>
                    <input type="date" value={planCrizaEnd}
                      onChange={e => { setPlanCrizaEnd(e.target.value); setPlanCriza(null); }}
                      min={planCrizaStart}
                      className="bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-[12px] text-white outline-none focus:border-red-500/50 transition-all"/>
                  </div>
                  <button onClick={()=>{
                    const p = genereazaPlanCriza(echipa, planCrizaStart, planCrizaSimConcedii, planCrizaIssues, planCrizaEnd || undefined);
                    if(p) setPlanCriza(p);
                  }} className="bg-red-900/40 border border-red-500/30 text-red-300 text-[12px] font-semibold px-4 py-1.5 rounded-lg hover:bg-red-800/50 transition-all flex items-center gap-1.5">
                    <AlertTriangle size={12}/> Generează plan
                  </button>
                </div>
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
                      Un angajat face S toată săptămâna (rotativ săptămânal). Sâmbăta = zi normală de lucru (2D+1S cu localii). Duminica = suplinitorii vin din Constanța (2D+2S), localii liberi — zi de tranziție. Luni noul om pe S începe tura. Zero S→D garantat matematic.
                    </p>

                    {/* Tabel plan zilnic */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-zinc-500 border-b border-white/[0.07]">
                            <th className="text-left py-2 font-medium">Data</th>
                            {echipa.map(m=>(
                              <th key={m.id} className="text-center py-2 font-medium">{m.nume.split(' ')[0]}</th>
                            ))}
                            <th className="text-center py-2 font-medium text-orange-400">SUP</th>
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
                                  const t = zi.ture[m.id] || 'L';
                                  return (
                                    <td key={m.id} className="text-center py-1.5">
                                      <span className={`inline-block w-6 h-6 rounded text-[10px] font-bold leading-6 ${t==='D'?'bg-blue-900/50 text-blue-300':t==='S'?'bg-purple-900/50 text-purple-300':'text-zinc-700'}`}>
                                        {t}
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
                                return (<td key={di} className="text-center"><div className={`text-[11px] font-bold py-1.5 rounded-lg ${style}`}>{t.label}</div></td>);
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

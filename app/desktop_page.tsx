'use client';
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Edit3, ChevronLeft, ChevronRight, FileDown, Calendar, X, AlertTriangle, HeartPulse, ArrowLeftRight, Trophy, ExternalLink, Clock, Printer, FlaskConical, Plus, Check, Cloud } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const SARBATORI_RAW = ['2026-01-01','2026-01-02','2026-01-24','2026-04-19','2026-04-20','2026-05-01','2026-06-01','2026-06-08','2026-08-15','2026-11-30','2026-12-01','2026-12-25','2026-12-26'];
const SARBATORI = SARBATORI_RAW.map(d => new Date(d + 'T00:00:00'));
const isSarbatoare = (d: Date) => SARBATORI.some(s => s.toDateString() === d.toDateString());
const parseD = (s: string) => new Date(s + 'T00:00:00');

const SLOTS: Record<string, { n: string; s: string; e: string }[]> = {
  'Primăvară': [
    { n: '06–11 Apr', s: '2026-04-06', e: '2026-04-11' },{ n: '13–18 Apr', s: '2026-04-13', e: '2026-04-18' },
    { n: '20–25 Apr', s: '2026-04-20', e: '2026-04-25' },{ n: '27 Apr–02 Mai', s: '2026-04-27', e: '2026-05-02' },
    { n: '04–09 Mai', s: '2026-05-04', e: '2026-05-09' },
  ],
  'Vară': [
    { n: '06–11 Iul', s: '2026-07-06', e: '2026-07-11' },{ n: '13–18 Iul', s: '2026-07-13', e: '2026-07-18' },
    { n: '20–25 Iul', s: '2026-07-20', e: '2026-07-25' },{ n: '27 Iul–01 Aug', s: '2026-07-27', e: '2026-08-01' },
    { n: '03–08 Aug', s: '2026-08-03', e: '2026-08-08' },
  ],
  'Toamnă': [
    { n: '05–10 Oct', s: '2026-10-05', e: '2026-10-10' },{ n: '12–17 Oct', s: '2026-10-12', e: '2026-10-17' },
    { n: '19–24 Oct', s: '2026-10-19', e: '2026-10-24' },{ n: '26–31 Oct', s: '2026-10-26', e: '2026-10-31' },
    { n: '02–07 Noi', s: '2026-11-02', e: '2026-11-07' },
  ],
  'Iarnă': [
    { n: '07–12 Dec', s: '2026-12-07', e: '2026-12-12' },{ n: '14–19 Dec', s: '2026-12-14', e: '2026-12-19' },
    { n: '21–26 Dec', s: '2026-12-21', e: '2026-12-26' },{ n: '28 Dec–02 Ian', s: '2026-12-28', e: '2027-01-02' },
    { n: '04–09 Ian 27', s: '2027-01-04', e: '2027-01-09' },
  ],
};

const AVATAR_COLORS = ['#0078d4','#bf5af2','#4cd964','#ffd60a','#ff6b6b'];
const DAY_SHORT = ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'];
const LS_KEY = 'rotaflow_v1';

interface Concediu { n: string; s: string; e: string; uuid?: string }
interface Absenta { startDate: string; zile: number; tip: 'CM' | 'AN'; uuid?: string }
interface Swap { id: string; aId: number; aData: string; bId: number; bData: string; nota: string }
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
function fmtMonth(d: Date) { return d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' }); }
function fmtDateInput(d: Date) { return d.toISOString().split('T')[0]; }
function fmtTs(d: Date) {
  return d.toLocaleDateString('ro-RO',{day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' +
    d.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'});
}

function inCO(d: Date, m: Angajat): boolean {
  // Verificare directa - data e in interiorul unui concediu existent
  if (m.concedii.some(c => { const s=parseD(c.s),e=parseD(c.e); e.setHours(23,59,59); return d>=s&&d<=e; })) return true;

  // Verificare "punte" - daca data e exact 1 zi intre sfarsitul unui concediu si inceputul altuia
  // (sloturi adiacente, ex: 06-11 Apr + 13-18 Apr -> 12 Apr e tratat ca CO, fara cost suplimentar)
  return m.concedii.some(c1 => m.concedii.some(c2 => {
    if (c1 === c2) return false;
    const e1 = parseD(c1.e);
    const s2 = parseD(c2.s);
    const gapStart = new Date(e1.getTime() + 86400000);
    const gapEnd = new Date(s2.getTime() - 86400000);
    if (gapStart.getTime() !== gapEnd.getTime()) return false; // gap trebuie sa fie exact 1 zi
    return d.toDateString() === gapStart.toDateString();
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

const SUPLINITOR_OBJ: Angajat = { id: 999, nume: 'Suplinitor', zileCO: 0, concedii: [], absente: [] };

function getTuraBaza(d: Date, m: Angajat, toataEchipa: Angajat[], suplinitorActiv: boolean): { type: string; label: string } {
  const isSup = m.id === 999;
  if (!isSup && inAbsenta(d, m, 'CM')) return { type: 'CM', label: 'CM' };
  if (!isSup && inAbsenta(d, m, 'AN')) return { type: 'AN', label: 'AN' };
  if (!isSup && inCO(d, m)) return { type: 'CO', label: 'CO' };
  const activi = toataEchipa.filter(a => !inCO(d,a) && !inAbsenta(d,a,'any'));
  if (suplinitorActiv) activi.push(SUPLINITOR_OBJ);
  const poz = activi.findIndex(a => a.id === m.id);
  if (poz === -1) return { type: 'L', label: 'L' };
  const ref = new Date(2026,0,1);
  const dayIdx = Math.floor((d.getTime()-ref.getTime())/86400000);
  const n = activi.length;
  const sec = ((dayIdx+poz)%n+n)%n;
  if (sec===0||sec===1) return { type: 'D', label: 'D' };
  if (sec===2) return { type: 'S', label: 'S' };
  return { type: 'L', label: 'L' };
}

function getTura(d: Date, m: Angajat, toataEchipa: Angajat[], suplinitorActiv: boolean, swapuri: Swap[]): { type: string; label: string; swapped?: boolean } {
  const dStr = fmtDateInput(d);
  const swA = swapuri.find(sw => sw.aId===m.id && sw.aData===dStr);
  const swB = swapuri.find(sw => sw.bId===m.id && sw.bData===dStr);
  if (swA) {
    const b = toataEchipa.find(x => x.id===swA.bId);
    if (b) { const t=getTuraBaza(parseD(swA.bData),b,toataEchipa,suplinitorActiv); return {...t,label:t.label+'↔',swapped:true}; }
  }
  if (swB) {
    const a = toataEchipa.find(x => x.id===swB.aId);
    if (a) { const t=getTuraBaza(parseD(swB.aData),a,toataEchipa,suplinitorActiv); return {...t,label:t.label+'↔',swapped:true}; }
  }
  return getTuraBaza(d, m, toataEchipa, suplinitorActiv);
}

// Verifica daca un angajat depaseste 48h/saptamana (Art. 114)
function calcOreSaptamana(m: Angajat, weekStart: Date, echipa: Angajat[], suplinitor: boolean, swapuri: Swap[]): number {
  let ore = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * 86400000);
    const t = getTura(d, m, echipa, suplinitor, swapuri);
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

// Tura pentru simulare — foloseste simConcedii in loc de m.concedii, ignora CM/AN reale
function getTuraSim(d: Date, m: Angajat, toataEchipa: Angajat[], simConcedii: SimConcediu[], suplinitorActiv: boolean): { type: string; label: string } {
  const isSup = m.id === 999;
  if (!isSup && inSimConcediu(d, m.id, simConcedii)) return { type: 'CO', label: 'CO' };
  const activi = toataEchipa.filter(a => !inSimConcediu(d, a.id, simConcedii));
  if (suplinitorActiv) activi.push(SUPLINITOR_OBJ);
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
function analizeazaConformitate(echipa: Angajat[], simConcedii: SimConcediu[], suplinitorActiv: boolean, startCheck: Date, zileCheck: number, pragMinimActivi = 3, pragOreMax = 48): ConformitateIssue[] {
  const issues: ConformitateIssue[] = [];
  const zileSet = new Set<string>();

  for (let i = 0; i < zileCheck; i++) {
    const d = new Date(startCheck.getTime() + i * 86400000);
    const activi = echipa.filter(a => !inSimConcediu(d, a.id, simConcedii));
    const totalActivi = activi.length + (suplinitorActiv ? 1 : 0);
    if (totalActivi < pragMinimActivi) {
      const key = fmtDateInput(d);
      if (!zileSet.has('PUTINI_'+key)) {
        zileSet.add('PUTINI_'+key);
        issues.push({ tip: 'PUTINI_OAMENI', data: key, detalii: `${fmtDate(d)}: doar ${totalActivi} angajați activi (minim recomandat: ${pragMinimActivi})` });
      }
    }
  }

  // Verifica ore saptamanale pentru fiecare angajat, pe ferestre de 7 zile in intervalul verificat
  echipa.forEach(m => {
    for (let i = 0; i < zileCheck; i += 7) {
      const wkStart = new Date(startCheck.getTime() + i * 86400000);
      let ore = 0;
      for (let j = 0; j < 7; j++) {
        const d = new Date(wkStart.getTime() + j * 86400000);
        const t = getTuraSim(d, m, echipa, simConcedii, suplinitorActiv);
        if (t.type === 'D' || t.type === 'S') ore += 8;
      }
      if (ore > pragOreMax) {
        issues.push({ tip: 'ORE_MAXIME', data: fmtDateInput(wkStart), detalii: `${m.nume}: ${ore}h în săptămâna din ${fmtDate(wkStart)} (limită legală: ${pragOreMax}h)` });
      }
    }
  });

  return issues;
}


const SHIFT_STYLE: Record<string, string> = {
  D:  'bg-sky-950/50 text-sky-300 border border-sky-500/30',
  S:  'bg-purple-950/50 text-purple-300 border border-purple-500/30',
  L:  'bg-white/[0.03] text-zinc-600 border border-transparent',
  CO: 'bg-rose-950/40 text-rose-400 border border-rose-500/25',
  CM: 'bg-orange-950/50 text-orange-300 border border-orange-500/40',
  AN: 'bg-red-950/60 text-red-300 border border-red-500/40',
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

  const suplinitorAutoActiv = useMemo(() => echipa.some(m => m.absente.some(a => a.tip==='CM'&&a.zile>7)), [echipa]);
  const suplinitorFinal = suplinitorActiv || suplinitorAutoActiv;
  const modeAvarie = useMemo(() => echipa.some(m => days.some(d => inAbsenta(d,m,'CM'))), [echipa,days]);

  const getTuraW = useCallback((d: Date, m: Angajat) => getTura(d,m,echipa,suplinitorFinal,swapuri), [echipa,suplinitorFinal,swapuri]);

  // Alerte ore maxime (Art. 114 — max 48h/saptamana)
  const alerteOre = useMemo(() => {
    return echipa.filter(m => calcOreSaptamana(m, weekStart, echipa, suplinitorFinal, swapuri) > 48).map(m => m.nume);
  }, [echipa, weekStart, suplinitorFinal, swapuri]);

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

  // ─── Handlers ───
  const adaugaConcediu = useCallback((pi: number, slot: {n:string;s:string;e:string}) => {
    const key=`${slot.s}__${slot.e}`;
    if(sloturiRef.current.has(key)) return;
    sloturiRef.current.add(key); setSloturiAlocate(new Set(sloturiRef.current));
    const zl=countZileLucratoare(slot.s,slot.e);
    const angajatTarget = echipa[pi];
    if (!angajatTarget?.uuid) return;

    setEchipa(prev=>{
      const next=prev.map((m,i)=>i!==pi?m:{...m,concedii:[...m.concedii,slot],zileCO:Math.max(0,m.zileCO-zl)});
      return next;
    });
    addLog(`CO adăugat: ${angajatTarget.nume} — ${slot.n}`);

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
    const zl=countZileLucratoare(c.s,c.e);

    setEchipa(prev=>prev.map((m,i)=>i!==pi?m:{...m,zileCO:Math.min(24,m.zileCO+zl),concedii:m.concedii.filter((_,k)=>k!==ci)}));
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

    setEchipa(prev=>prev.map((m,i)=>i!==urgTargetIdx?m:{...m,absente:[...m.absente,{startDate:urgStart,zile:urgZile,tip:urgTip}]}));
    addLog(`${urgTip} adăugat: ${angajatTarget.nume} — ${urgStart} · ${urgZile}z`);
    setShowUrgente(false);

    apiAdaugaAbsenta(angajatTarget.uuid, urgTip, urgStart, urgZile).catch(err => {
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
    if(swAId===swBId&&swAData===swBData) return;
    const nou: Swap = {id:Date.now().toString(),aId:swAId,aData:swAData,bId:swBId,bData:swBData,nota:swNota};
    setSwapuri(prev=>[...prev,nou]);
    const a=echipa.find(m=>m.id===swAId), b=echipa.find(m=>m.id===swBId);
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
      // Sunt probleme — afisam alerta, nu adaugam inca
      setSimIssues(issues);
      setSimPendingAction('add');
      setSimPendingPayload(nou);
    } else {
      // Fara probleme — adaugam direct
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

  // Aplica rezultatul simularii in calendarul real — converteste SimConcediu in Concediu pe fiecare angajat
  const aplicaSimulareInReal = () => {
    if (simConcedii.length === 0) return;

    const operatiiApi: Promise<unknown>[] = [];

    setEchipa(prev => prev.map(m => {
      const concediiAngajat = simConcedii.filter(sc => sc.angajatId === m.id);
      if (concediiAngajat.length === 0) return m;
      const noiConcedii: Concediu[] = concediiAngajat.map(sc => {
        const start = parseD(sc.start);
        const end = new Date(start.getTime() + (sc.zile - 1) * 86400000);
        return { n: `${fmtDate(start)}–${fmtDate(end)}`, s: sc.start, e: fmtDateInput(end) };
      });
      const zileTotale = concediiAngajat.reduce((acc, sc) => acc + countZileLucratoare(sc.start, fmtDateInput(new Date(parseD(sc.start).getTime() + (sc.zile-1)*86400000))), 0);

      if (m.uuid) {
        concediiAngajat.forEach(sc => {
          const start = parseD(sc.start);
          const end = new Date(start.getTime() + (sc.zile - 1) * 86400000);
          const nume_slot = `${fmtDate(start)}–${fmtDate(end)}`;
          const zl = countZileLucratoare(sc.start, fmtDateInput(end));
          operatiiApi.push(apiAdaugaConcediu(m.uuid!, sc.start, fmtDateInput(end), nume_slot, zl));
        });
      }

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
  const generatePDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    const luna = fmtMonth(lunaStart);
    const yr = lunaStart.getFullYear(), mo = lunaStart.getMonth();
    const nrZile = new Date(yr, mo+1, 0).getDate();

    doc.setFontSize(16); doc.setTextColor(0, 120, 212);
    doc.text(`RotaFlow — Pontaj ${luna}`, 14, 14);
    doc.setFontSize(9); doc.setTextColor(100,100,100);
    doc.text(`Generat: ${fmtTs(new Date())}`, 14, 20);

    // Tabel ture zilnice
    const zileCols = Array.from({length:nrZile},(_,i)=>(i+1).toString());
    const head = [['Angajat', ...zileCols]];
    const body = echipa.map(m => {
      const row: string[] = [m.nume];
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
    doc.text('Statistici lunare', 14, statsY);
    autoTable(doc, {
      head:[['Angajat','Zile lucrate','Ore lucrate','Sărbători lucrate','CO rămas','CM','Abs. Nemot.','Scor performanță']],
      body: echipa.map(m=>{
        const s=calcScor(m,lunaStart);
        return[m.nume,s.zile.toString(),`${s.ore}h`,s.sarbLucrate.toString(),m.zileCO.toString(),s.zileCM.toString(),s.zileAN.toString(),`${s.scor}p`];
      }),
      startY: statsY+4, styles:{fontSize:9}, headStyles:{fillColor:[0,120,212]},
    });

    doc.save(`RotaFlow_Pontaj_${luna.replace(' ','_')}.pdf`);
    addLog(`PDF exportat: ${luna}`);
  };

  // ── Sincronizare cu baza de date ──
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncOk, setSyncOk] = useState(false);

  const sincronizeazaDB = async () => {
    setSyncLoading(true); setSyncOk(false);
    try {
      await fetch('/api/sync-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overrides: [],
          notificare: {
            titlu: 'Program actualizat',
            mesaj: `Programul a fost modificat pentru săptămâna ${weekStart.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' })}. Verifică turele tale în aplicație.`,
            tip: 'program',
          }
        }),
      });
      addLog(`✓ Notificare trimisă către angajați`);
      setSyncOk(true);
      setTimeout(() => setSyncOk(false), 3000);
    } catch (e) {
      addLog('✗ Eroare la sincronizare');
    }
    setSyncLoading(false);
  };

  const displayEchipa = useMemo(()=>suplinitorFinal?[...echipa,SUPLINITOR_OBJ]:echipa,[echipa,suplinitorFinal]);
  const clasament = useMemo(()=>[...echipa].map(m=>({...m,...calcScor(m,weekStart)})).sort((a,b)=>b.scor-a.scor),[echipa,weekStart,calcScor]);

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
          </div>
          <div className="flex gap-1">
            {([['rota','Rotație'],['luna','Calendar'],['stats','Statistici'],['swap','Swap'],['log','Istoric']] as const).map(([t,l])=>(
              <button key={t} onClick={()=>setActiveTab(t)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${activeTab===t?'bg-white/10 text-white':'text-zinc-400 hover:text-white hover:bg-white/[0.06]'}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={generatePDF} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-900/40 border border-emerald-500/30 text-emerald-300 text-[12px] font-semibold hover:bg-emerald-800/50 transition-all">
              <FileDown size={13}/> PDF
            </button>
            <button onClick={()=>window.print()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-300 text-[12px] font-semibold hover:bg-zinc-700 transition-all">
              <Printer size={13}/> Print
            </button>
            <button onClick={sincronizeazaDB} disabled={syncLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition-all
                ${syncOk ? 'bg-green-900/50 border-green-500/40 text-green-300' : 'bg-blue-900/40 border-blue-500/30 text-blue-300 hover:bg-blue-800/50'}
                disabled:opacity-50`}>
              {syncLoading
                ? <><span className="w-3 h-3 border border-blue-400/40 border-t-blue-300 rounded-full animate-spin"/><span>Sincronizare...</span></>
                : syncOk
                  ? <><Check size={13}/> Sincronizat!</>
                  : <><Cloud size={13}/> Sincronizează DB</>
              }
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

          {/* Cards echipa */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {echipa.map((m,i)=>{
              const st=calcScor(m,weekStart);
              const pct=Math.round((1-m.zileCO/24)*100);
              const col=AVATAR_COLORS[i%5];
              const hasCM=m.absente.some(a=>a.tip==='CM');
              const hasAN=m.absente.some(a=>a.tip==='AN');
              const oreS=calcOreSaptamana(m,weekStart,echipa,suplinitorFinal,swapuri);
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
                      const oreS=calcOreSaptamana(m,weekStart,echipa,suplinitorFinal,swapuri);
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
                            return (
                              <td key={di} className="text-center">
                                <div className={`relative text-[13px] font-black py-3 px-2 rounded-xl ${style} ${t.swapped?'ring-2 ring-amber-400/60':''}`}>
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
              <div className="px-4 py-3 border-t border-white/[0.05] flex gap-5 flex-wrap">
                {[['sky','Dimineață'],['purple','Seară'],['zinc','Liber'],['rose','CO'],['orange','CM'],['red','Abs. Nemot.']].map(([c,l])=>(
                  <div key={l} className="flex items-center gap-2 text-[12px] text-zinc-400">
                    <div className={`w-3 h-3 rounded-md bg-${c}-900/70 border border-${c}-500/30`}/>{l}
                  </div>
                ))}
                <div className="flex items-center gap-2 text-[12px] text-zinc-400"><span className="text-amber-400/80 text-[11px]">↔</span> Swap</div>
                <div className="flex items-center gap-2 text-[12px] text-zinc-400"><span className="text-amber-400">★</span> Sărbătoare</div>
              </div>
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
                  <button onClick={adaugaSwap} className="w-full bg-sky-900/30 hover:bg-sky-900/50 border border-sky-500/30 text-sky-300 font-semibold text-[12px] py-2.5 rounded-lg transition-all flex items-center justify-center gap-2">
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
                <button onClick={()=>setLogRaw([])} className="text-[11px] text-zinc-600 hover:text-red-400 transition-colors">Șterge tot</button>
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
                      <label className="text-[10px] text-zinc-500 mb-1 block">Număr zile ({simZile})</label>
                      <input type="range" min={1} max={31} value={simZile} onChange={e=>setSimZile(Number(e.target.value))} className="w-full accent-purple-500 mt-2.5"/>
                    </div>
                    <div className="flex items-end">
                      <button onClick={verificaSiAdaugaSim} className="w-full bg-purple-900/40 hover:bg-purple-900/60 border border-purple-500/40 text-purple-300 font-semibold text-[12px] py-2 rounded-lg transition-all flex items-center justify-center gap-1.5">
                        <Plus size={13}/> Adaugă
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-2">Perioada se calculează liber, de la 1 până la 31 de zile — fără restricția sloturilor fixe de 6 zile.</p>
                </div>

                {/* ALERTĂ conformitate cu confirmare */}
                {simPendingAction === 'add' && simIssues.length > 0 && (
                  <div className="bg-red-950/40 border-2 border-red-500/50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={18} className="text-red-400 flex-shrink-0"/>
                      <span className="font-bold text-red-300 text-[13px]">ATENȚIE — Probleme de conformitate detectate!</span>
                    </div>
                    <div className="space-y-1.5">
                      {simIssues.map((iss,ii)=>(
                        <div key={ii} className="flex items-start gap-2 bg-black/30 rounded-lg px-3 py-2">
                          <span className="text-red-400 text-[11px] font-bold flex-shrink-0">{iss.tip==='PUTINI_OAMENI'?'⚠ NU AI SUFICIENȚI OAMENI!':'⚠ ORE PESTE LIMITĂ!'}</span>
                        </div>
                      ))}
                      {simIssues.slice(0,5).map((iss,ii)=>(
                        <p key={'d'+ii} className="text-[11px] text-red-300/80 pl-2">· {iss.detalii}</p>
                      ))}
                      {simIssues.length > 5 && <p className="text-[10px] text-red-400/60 pl-2">...și încă {simIssues.length-5} probleme similare.</p>}
                    </div>
                    <div className="border-t border-red-500/20 pt-3">
                      <p className="text-[12px] text-white font-semibold mb-2">Continui oricum?</p>
                      <div className="flex gap-2">
                        <button onClick={anuleazaAdaugareSim} className="flex-1 bg-zinc-800 border border-zinc-600 text-zinc-300 font-semibold text-[12px] py-2 rounded-lg hover:bg-zinc-700 transition-all">
                          Nu, renunț
                        </button>
                        <button onClick={()=>confirmaAdaugareSimCuProbleme(false)} className="flex-1 bg-red-900/40 border border-red-500/40 text-red-300 font-semibold text-[12px] py-2 rounded-lg hover:bg-red-900/60 transition-all">
                          Da, continui fără suplinitor
                        </button>
                        <button onClick={()=>confirmaAdaugareSimCuProbleme(true)} className="flex-1 bg-emerald-900/40 border border-emerald-500/40 text-emerald-300 font-semibold text-[12px] py-2 rounded-lg hover:bg-emerald-900/60 transition-all flex items-center justify-center gap-1.5">
                          <Plus size={13}/> Da, adaugă suplinitor
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
                        return (
                          <span key={sc.id} className="flex items-center gap-1.5 bg-purple-950/40 border border-purple-500/25 text-purple-300 text-[10px] px-2.5 py-1 rounded-full">
                            <strong>{ang?.nume}</strong> {fmtDate(start)}–{fmtDate(end)} ({sc.zile}z)
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

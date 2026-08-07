'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [parola, setParola] = useState('');
  const [eroare, setEroare] = useState('');
  const [trimitand, setTrimitand] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrimitand(true);
    setEroare('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parola }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEroare(data.error || 'Parolă greșită');
        setTrimitand(false);
        return;
      }
      router.replace(params.get('next') || '/');
      router.refresh();
    } catch {
      setEroare('Nu am putut contacta serverul. Încearcă din nou.');
      setTrimitand(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a1f] flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-[#2c2c2e] border border-white/10 rounded-2xl p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-sky-900/40 border border-sky-500/30 flex items-center justify-center mx-auto mb-3">
            <span className="text-[20px]">🔒</span>
          </div>
          <h1 className="text-[16px] font-bold text-zinc-100">RotaFlow</h1>
          <p className="text-[12px] text-zinc-500 mt-1">Introdu parola pentru acces</p>
        </div>

        <input
          type="password"
          autoFocus
          value={parola}
          onChange={e => setParola(e.target.value)}
          placeholder="Parolă"
          className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-4 py-2.5 text-[13px] text-white outline-none focus:border-sky-500/50 transition-all mb-3"
        />

        {eroare && <p className="text-[12px] text-rose-400 mb-3">{eroare}</p>}

        <button
          type="submit"
          disabled={trimitand || !parola}
          className="w-full bg-sky-900/50 border border-sky-500/40 text-sky-200 text-[13px] font-semibold py-2.5 rounded-lg hover:bg-sky-800/60 transition-all disabled:opacity-40"
        >
          {trimitand ? 'Se verifică...' : 'Intră'}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

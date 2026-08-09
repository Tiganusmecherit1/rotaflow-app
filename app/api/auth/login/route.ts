import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { parola } = await request.json();
  const parolaAsteptata = process.env.APP_PASSWORD;

  if (!parolaAsteptata) {
    return NextResponse.json({ error: 'APP_PASSWORD nu e configurata pe server (.env.local)' }, { status: 500 });
  }

  if (parola !== parolaAsteptata) {
    return NextResponse.json({ error: 'Parolă greșită' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('rotaflow_pass', parolaAsteptata, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 zile
    path: '/',
  });
  return res;
}

import { NextRequest, NextResponse } from 'next/server';

// Gate simplu cu parola — protejeaza toata aplicatia (nu exista alta
// autentificare, toate rutele API folosesc cheia service_role direct).
// Nu e criptografie avansata, dar inchide accesul liber pe care il avea
// aplicatia inainte (oricine ajungea la localhost:3000 avea acces total).
//
// Next.js 16 a inlocuit middleware.ts cu proxy.ts (nu doar redenumit —
// vechiul sistem avea o vulnerabilitate cunoscuta, CVE-2025-29927, unde
// autentificarea din middleware putea fi ocolita sub sarcina mare).
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Lasam libere: pagina de login, API-ul de login, si fisierele statice Next.js
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/logout') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get('rotaflow_pass')?.value;
  const parolaAsteptata = process.env.APP_PASSWORD;

  // Daca nu e setata deloc parola in .env.local, lasam aplicatia deschisa
  // (ca sa nu blocam accidental pe cineva care nu a facut inca acest pas)
  // dar afisam un avertisment in consola serverului.
  if (!parolaAsteptata) {
    console.warn('⚠️  APP_PASSWORD nu e setata in .env.local — aplicatia ruleaza FARA protectie cu parola.');
    return NextResponse.next();
  }

  if (cookie !== parolaAsteptata) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

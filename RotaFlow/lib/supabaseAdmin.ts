import { createClient } from '@supabase/supabase-js';

// ATENȚIE: Acest fișier rulează DOAR pe server (API routes), niciodată în browser.
// Cheia service_role are acces complet la baza de date, ocolind RLS.
// Nu importa acest fișier în componente client ('use client')!

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

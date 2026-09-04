import { createClient } from '@supabase/supabase-js';

// Fallbacks de placeholder para que el build no falle si las variables
// aún no existen; en runtime real siempre vienen de .env.local / Vercel.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabase = createClient(url, key);

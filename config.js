// ─── Supabase Configuration ──────────────────────────────────────────────────
// Sign-in, saving routes, and sharing all require Supabase.
//
// Setup (free):
//   1. Create a project at https://supabase.com
//   2. Settings → API → copy "Project URL" and "anon/public" key
//   3. Paste them below
//   4. In the Supabase SQL Editor run the contents of supabase-schema.sql

const SUPABASE_CONFIG = {
  url:     'YOUR_SUPABASE_URL',          // e.g. https://abcdefgh.supabase.co
  anonKey: 'YOUR_SUPABASE_ANON_KEY',     // starts with eyJhbGci…
};

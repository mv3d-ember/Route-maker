// ─── Supabase Configuration ──────────────────────────────────────────────────
// Sign-in, saving routes, and sharing all require Supabase.
//
// Setup (free):
//   1. Create a project at https://supabase.com
//   2. Settings → API → copy "Project URL" and "anon/public" key
//   3. Paste them below
//   4. In the Supabase SQL Editor run the contents of supabase-schema.sql

const SUPABASE_CONFIG = {
  url:     'https://cexomvxyxlqngzrjuwsj.supabase.co',          // e.g. https://abcdefgh.supabase.co
  anonKey: 'sb_publishable_WPJHu1v_JZbDqyU4hbcD2A_gpo4x7tg',     // starts with eyJhbGci…
};

// Admin email — only this account can view maintenance.html
const ADMIN_EMAIL = 'your@email.com';

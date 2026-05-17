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
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleG9tdnh5eGxxbmd6cmp1d3NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTQ1NDUsImV4cCI6MjA5NDU5MDU0NX0.kYo2B1GvppH9LuQTa9Wwx0sXTCS2uMs6lXT1XkxCT9A',     // starts with eyJhbGci…
};

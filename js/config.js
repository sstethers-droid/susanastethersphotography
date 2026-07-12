/* ==========================================================================
   Public site configuration.

   These two values are PUBLIC by design. Supabase's anon key is meant to be
   shipped in the browser — it is not a secret. What actually protects the
   data is Row Level Security (see supabase/schema.sql): the anon role is
   granted INSERT on `inquiries` and nothing else. It cannot read, update,
   or delete a single row.

   Never put the SERVICE ROLE key here. That one bypasses RLS entirely and
   would hand anyone who views source full access to every client inquiry.
   ========================================================================== */

window.SITE_CONFIG = {
  // Fill these in after creating the Supabase project.
  // e.g. 'https://abcdefghijk.supabase.co'
  SUPABASE_URL: '',

  // The "anon" / "publishable" key from Supabase → Project Settings → API Keys
  SUPABASE_ANON_KEY: '',

  // Fallback while Supabase isn't wired up yet: the form opens the visitor's
  // email client instead of silently failing.
  FALLBACK_EMAIL: 'hello@susanastethersphotography.com'
};

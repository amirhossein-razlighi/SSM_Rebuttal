// Supabase configuration.
// The publishable ("anon") key is designed to be exposed in frontend code.
// Row Level Security on the `responses` table restricts this key to INSERT only
// (no read/update/delete), so participant data stays private.
//
// To run the site in LOCAL mode (download JSON instead of saving), blank these out.
window.SSM_CONFIG = {
  SUPABASE_URL: "https://wnefzcgxsluzovmgnxkh.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_0Swa_0QzFX19xt5sv0j2OQ_moYzRZgo",
};

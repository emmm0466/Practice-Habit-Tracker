
const SUPABASE_URL = "https://qvrqgoazdzwxognmflnh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_iJ4mSmt05LW5ZFfGNRCBPQ_lU7CRYvj";

window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

console.log("Supabase connected!");

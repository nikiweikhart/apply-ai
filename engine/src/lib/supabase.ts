import { createClient } from "@supabase/supabase-js";
import { env } from "./env.ts";

/**
 * Verbindung zur Datenbank. Nutzt den service_role-Schluessel, der die
 * Zugriffssperre umgeht - deshalb darf dieser Schluessel niemals in die
 * Website oder ins oeffentliche Netz gelangen, nur in den Motor.
 */
export const db = createClient(env.supabaseUrl, env.supabaseKey, {
  auth: { persistSession: false },
});

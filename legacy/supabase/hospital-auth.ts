import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
let client: ReturnType<typeof createClient<Database>> | undefined;
/** Staff sign-in is independent of the doctor's browser session. */
export function hospitalAuth() {
  if (client) return client;
  const url = import.meta.env["VITE_SUPABASE_URL"];
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Hospital authentication is not configured.");
  client = createClient<Database>(url, key, {
    auth: {
      storageKey: "msl-hospital-staff",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_publishable_") && headers.get("Authorization") === `Bearer ${key}`)
          headers.delete("Authorization");
        return fetch(input, { ...init, headers });
      },
    },
  });
  return client;
}

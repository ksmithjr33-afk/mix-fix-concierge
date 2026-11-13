import { createClient } from "@supabase/supabase-js";
import { timedFetch } from "@/lib/timing";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// timedFetch only counts and times each call for lib/timing.ts.
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, { global: { fetch: timedFetch } });

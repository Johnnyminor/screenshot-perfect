import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createCurrentsRequest } from "@/lib/currents-request.server";

/** Exercise the real transport while keeping parser tests independent of the database. */
export const testCurrentsRequest = createCurrentsRequest(
  {
    rpc: async (name: string) => ({
      data: name === "reserve_currents_request" ? crypto.randomUUID() : true,
      error: null,
    }),
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  } as unknown as SupabaseClient<Database>,
  "preview",
);

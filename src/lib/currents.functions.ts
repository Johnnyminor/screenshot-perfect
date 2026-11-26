import { createCurrentsRequest } from "./currents-request.server";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchCurrentsLatestNews } from "./currents.server";

/** Fetch on demand; existing scheduled ingestion and stored stories are unchanged. */
export const getCurrentsNews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: member, error } = await context.supabase.rpc("is_team_member");
    if (error || !member) throw new Error("Adgang kræver en invitation til redaktionen.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return fetchCurrentsLatestNews(
      process.env["CURRENTS_API_KEY"],
      createCurrentsRequest(supabaseAdmin, "preview"),
    );
  });

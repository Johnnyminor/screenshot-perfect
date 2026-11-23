import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runIngest } = await import("@/lib/ingest.server");
        try {
          const result = await runIngest(supabaseAdmin, { trigger: "schedule" });
          return Response.json(
            { success: result.failed === 0, ...result },
            { status: result.failed ? 207 : 200 },
          );
        } catch (error) {
          console.error("Scheduled collection failed", error);
          return Response.json(
            { success: false, error: "Indsamlingen fejlede. Se kørselsloggen." },
            { status: 500 },
          );
        }
      },
    },
  },
});

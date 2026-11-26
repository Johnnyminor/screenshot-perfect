import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("collection_health");
        const health = data as {
          schedule_missing: boolean;
          source_failures: number;
          sources_stale: number;
          jobs_overdue: number;
          run_failed: boolean;
        } | null;
        const healthy =
          !error &&
          health &&
          !health.schedule_missing &&
          !health.source_failures &&
          !health.sources_stale &&
          !health.jobs_overdue &&
          !health.run_failed;
        return Response.json(
          { healthy: !!healthy, health: error ? null : health },
          {
            status: healthy ? 200 : 503,
            headers: { "Cache-Control": "no-store" },
          },
        );
      },
    },
  },
});

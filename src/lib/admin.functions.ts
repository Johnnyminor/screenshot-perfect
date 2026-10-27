import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** "Kør nu": any signed-in editor may trigger ingestion (no admin role in v1). */
export const runIngestNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { feedIds?: string[] }) =>
    z.object({ feedIds: z.array(z.string().uuid()).max(200).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runIngest } = await import("./ingest.server");
    return runIngest(supabaseAdmin, { feedIds: data.feedIds });
  });

/** Look up a Danish company's CVR by name via cvrapi.dk. Result is shown for confirmation, never auto-saved. */
export const lookupCvr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) => z.object({ name: z.string().min(2).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const res = await fetch(`https://cvrapi.dk/api?search=${encodeURIComponent(data.name)}&country=dk`, {
      headers: { "User-Agent": "LexNyhedsmonitor - intern redaktion lex.dk" },
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => null)) as
      | { vat?: number; name?: string; address?: string; city?: string; error?: string }
      | null;
    if (!res.ok || !body || body.error || !body.vat) {
      return { found: false as const, message: body?.error ?? `Ingen match (HTTP ${res.status})` };
    }
    return { found: true as const, cvr: String(body.vat), name: body.name ?? "", address: [body.address, body.city].filter(Boolean).join(", ") };
  });

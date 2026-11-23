import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Only approved team members may invoke service-role collection. */
export const runIngestNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { feedIds?: string[] | undefined }) =>
    z.object({ feedIds: z.array(z.string().uuid()).max(200).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: member, error } = await context.supabase.rpc("is_team_member");
    if (error || !member) throw new Error("Adgang kræver en invitation til redaktionen.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runIngest } = await import("./ingest.server");
    return runIngest(supabaseAdmin, { feedIds: data.feedIds });
  });

export const rematchArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: member, error } = await context.supabase.rpc("is_team_member");
    if (error || !member) throw new Error("Adgang kræver en invitation til redaktionen.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runIngest } = await import("./ingest.server");
    return runIngest(supabaseAdmin, { mode: "rematch" });
  });

/** Look up a Danish company's CVR by name via cvrapi.dk. Result is shown for confirmation, never auto-saved. */
export const lookupCvr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) =>
    z.object({ name: z.string().min(2).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: member, error } = await context.supabase.rpc("is_team_member");
    if (error || !member) throw new Error("Adgang kræver en invitation til redaktionen.");
    const res = await fetch(
      `https://cvrapi.dk/api?search=${encodeURIComponent(data.name)}&country=dk`,
      {
        headers: { "User-Agent": "LexNyhedsmonitor - intern redaktion lex.dk" },
        signal: AbortSignal.timeout(10000),
      },
    );
    const body = (await res.json().catch(() => null)) as {
      vat?: number;
      name?: string;
      address?: string;
      city?: string;
      error?: string;
    } | null;
    if (!res.ok || !body || body.error || !body.vat) {
      return { found: false as const, message: body?.error ?? `Ingen match (HTTP ${res.status})` };
    }
    return {
      found: true as const,
      cvr: String(body.vat),
      name: body.name ?? "",
      address: [body.address, body.city].filter(Boolean).join(", "),
    };
  });

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export class CurrentsQuotaError extends Error {
  constructor() {
    super("Dagens fælles Currents-grænse er nået.");
  }
}
export type CurrentsRequest = (url: string, key: string) => Promise<Response>;

/** A reservation is consumed once, including uncertain network outcomes. No retries. */
export function createCurrentsRequest(
  admin: SupabaseClient<Database>,
  purpose: "preview" | "ingest" | "evaluation",
  reservation?: string,
): CurrentsRequest {
  return async (raw, key) => {
    const url = new URL(raw);
    if (
      !key ||
      url.origin !== "https://api.currentsapi.services" ||
      !["/v1/search", "/v1/latest-news"].includes(url.pathname) ||
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((k) => /key|token|auth/i.test(k))
    ) {
      throw new Error("Ugyldig Currents-konfiguration.");
    }
    const claim = reservation
      ? { data: reservation, error: null }
      : await admin.rpc("reserve_currents_request", { p_purpose: purpose });
    if (claim.error) throw new Error("Currents kunne ikke reserveres. Kontrollér udbyderstatus.");
    if (!claim.data) throw new CurrentsQuotaError();
    const id = claim.data;
    const started = await admin.rpc("start_currents_request", { p_id: id });
    if (started.error || !started.data)
      throw new Error("Currents-forespørgslen er allerede brugt.");
    let response: Response;
    try {
      response = await fetch(url.href, {
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          "User-Agent": "LexNyhedsmonitor/1.0 (+https://lex.dk)",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      await admin
        .from("currents_requests")
        .update({ status: "uncertain", finished_at: new Date().toISOString() })
        .eq("id", id);
      throw new Error("Currents kunne ikke kontaktes.");
    }
    const header = (name: string) => {
      const value = response.headers.get(name);
      return value !== null && /^\d+$/.test(value) && Number(value) <= 2147483647
        ? Number(value)
        : null;
    };
    const recorded = await admin
      .from("currents_requests")
      .update({
        status: "response",
        finished_at: new Date().toISOString(),
        http_status: response.status,
        provider_limit: header("x-ratelimit-limit"),
        provider_remaining: header("x-ratelimit-remaining"),
      })
      .eq("id", id);
    if (recorded.error) {
      await response.body?.cancel();
      throw new Error("Currents-svaret kunne ikke registreres.");
    }
    return response;
  };
}

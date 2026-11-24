import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { checked } from "./ingest.server";
import { evaluationSpec, type EvaluationSpec } from "./currents-evaluation";
import { newsSchema } from "./currents.server";
import { parseCurrents } from "./currents-search.server";
import { readSourceBody, retryAfterAt } from "./source-http.server";
import { buildMatches, canonicalizeUrl } from "./triage";

/** One audited HTTP attempt. Never retries, follows redirects or returns credentials/provider error bodies. */
export async function evaluateCurrentsRequest(spec: EvaluationSpec, key: string) {
  const valid = evaluationSpec.parse(spec);
  const url = new URL("https://api.currentsapi.services/v1/search");
  for (const [name, value] of Object.entries(valid))
    if (value !== undefined) url.searchParams.set(name, String(value));
  url.searchParams.set("page_size", "20");
  let response: Response;
  try {
    response = await fetch(url.href, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": "LexNyhedsmonitor/1.0 (+https://lex.dk)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return {
      http_status: 0,
      articles: [],
      error: "Currents kunne ikke kontaktes.",
      provider_info: {},
    };
  }
  const numberHeader = (name: string) => {
    const value = response.headers.get(name);
    return value !== null && /^\d+$/.test(value) ? Number(value) : null;
  };
  const retry = retryAfterAt(response.headers.get("retry-after"));
  const provider_info = {
    limit: numberHeader("x-ratelimit-limit"),
    remaining: numberHeader("x-ratelimit-remaining"),
    retry_at: retry ? new Date(retry).toISOString() : null,
    returned: 0,
    invalid_records: 0,
    invalid_fields: [] as string[],
  };
  if (!response.ok) {
    await response.body?.cancel();
    return {
      http_status: response.status,
      articles: [],
      error: `Currents HTTP ${response.status}`,
      provider_info,
    };
  }
  try {
    const data = JSON.parse(await readSourceBody(response));
    if (data?.status !== "ok" || !Array.isArray(data.news)) throw new Error("Invalid envelope");
    provider_info.returned = data.news.length;
    const records: unknown[] = data.news;
    const articles = records.flatMap((record: unknown, index: number) => {
      const parsed = newsSchema.safeParse({ status: "ok", news: [record] });
      if (!parsed.success) {
        provider_info.invalid_records++;
        provider_info.invalid_fields.push(
          ...parsed.error.issues.slice(0, 3).map((issue) => `${index}:${issue.path.join(".")}`),
        );
        return [];
      }
      try {
        const raw = parsed.data.news[0]!;
        const item = parseCurrents({
          status: "ok",
          news: [{ ...raw, url: canonicalizeUrl(raw.url) }],
        })[0]!;
        return [
          {
            title: item.headline,
            description: item.summary,
            url: item.link,
            publisher: item.publisher,
            published: item.publishedAt!.toISOString(),
            language: raw.language,
            provider_id: raw.id,
          },
        ];
      } catch {
        provider_info.invalid_records++;
        provider_info.invalid_fields.push(`${index}:article URL or date`);
        return [];
      }
    });
    if (provider_info.returned > 0 && !articles.length) throw new Error("No valid records");
    return { http_status: response.status, articles, error: null, provider_info };
  } catch {
    return {
      http_status: response.status,
      articles: [],
      error: "Currents returnerede et ugyldigt nyhedssvar.",
      provider_info,
    };
  }
}

export async function runEvaluationBatch(
  admin: SupabaseClient<Database>,
  ids: string[],
  key: string | undefined,
) {
  if (!key) throw new Error("Currents API-nøglen er ikke konfigureret.");
  const states = await checked(
    admin.from("provider_health").select("*").eq("hostname", "api.currentsapi.services"),
  );
  const blocked = states?.find(
    (state) => state.blocked_until && Date.parse(state.blocked_until) > Date.now(),
  );
  if (blocked)
    return { results: [], stopped: `Currents holder pause til ${blocked.blocked_until}.` };
  const companies = await checked(admin.from("companies").select("*").eq("active", true));
  const results: { id: string; status: string }[] = [];
  for (const id of ids) {
    const claim = (await checked(admin.rpc("claim_currents_evaluation", { p_id: id }))) as {
      outcome: string;
      request?: { params: unknown };
    };
    if (claim.outcome === "quota")
      return { results, stopped: "Dagens forespørgselsgrænse er nået." };
    if (claim.outcome !== "claimed") continue;
    const started = Date.now();
    let result;
    try {
      result = await evaluateCurrentsRequest(evaluationSpec.parse(claim.request!.params), key);
    } catch {
      result = {
        http_status: 0,
        articles: [],
        error: "Ugyldig testkonfiguration.",
        provider_info: {},
      };
    }
    const articles = result.articles.map((article) => ({
      ...article,
      matched_company_ids: buildMatches(
        companies ?? [],
        [],
        {
          headline: article.title,
          summary: article.description,
          published_at: article.published,
        },
        0.6,
      ).map((match) => match.company_id),
    }));
    const status = result.error ? "failed" : "completed";
    await checked(
      admin
        .from("currents_evaluation_requests")
        .update({
          status,
          http_status: result.http_status,
          duration_ms: Date.now() - started,
          finished_at: new Date().toISOString(),
          articles: articles as Json,
          error: result.error,
          provider_info: result.provider_info,
        })
        .eq("id", id),
    );
    results.push({ id, status });
    if ([401, 403, 429].includes(result.http_status)) {
      const info = result.provider_info as { retry_at?: string | null };
      const until =
        info.retry_at ??
        new Date(Date.now() + (result.http_status === 429 ? 120000 : 86400000)).toISOString();
      await checked(
        admin.from("provider_health").upsert({
          hostname: "api.currentsapi.services",
          blocked_until: until,
          last_error: result.error,
          last_status: result.http_status,
          updated_at: new Date().toISOString(),
        }),
      );
      return {
        results,
        stopped: `Currents HTTP ${result.http_status}; flere tests er sat på pause.`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { results, stopped: null };
}

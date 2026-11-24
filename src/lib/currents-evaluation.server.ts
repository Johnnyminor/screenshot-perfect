import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { checked } from "./ingest.server";
import { evaluationSpec, type EvaluationSpec } from "./currents-evaluation";
import { newsSchema } from "./currents.server";
import { parseCurrents } from "./currents-search.server";
import { readSourceBody } from "./source-http.server";
import { buildMatches } from "./triage";

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
    return { http_status: 0, articles: [], error: "Currents kunne ikke kontaktes." };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return {
      http_status: response.status,
      articles: [],
      error: `Currents HTTP ${response.status}`,
    };
  }
  try {
    const data = JSON.parse(await readSourceBody(response));
    const parsed = newsSchema.parse(data);
    const articles = parseCurrents(data).map((item, index) => ({
      title: item.headline,
      description: item.summary,
      url: item.link,
      publisher: item.publisher,
      published: item.publishedAt!.toISOString(),
      language: parsed.news[index]!.language,
      provider_id: parsed.news[index]!.id,
    }));
    return { http_status: response.status, articles, error: null };
  } catch {
    return {
      http_status: response.status,
      articles: [],
      error: "Currents returnerede et ugyldigt nyhedssvar.",
    };
  }
}

export async function runEvaluationBatch(
  admin: SupabaseClient<Database>,
  ids: string[],
  key: string | undefined,
) {
  if (!key) throw new Error("Currents API-nøglen er ikke konfigureret.");
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
      result = { http_status: 0, articles: [], error: "Ugyldig testkonfiguration." };
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
        })
        .eq("id", id),
    );
    results.push({ id, status });
    if ([401, 403, 429].includes(result.http_status))
      return {
        results,
        stopped: `Currents HTTP ${result.http_status}; flere tests er sat på pause.`,
      };
  }
  return { results, stopped: null };
}

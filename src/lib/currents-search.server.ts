import type { CurrentsRequest } from "./currents-request.server";
import { newsSchema } from "./currents.server";
import { sourceSchema, publicSourceUrl } from "./source-config";
import { readSourceBody, SourceHttpError, retryAfterAt } from "./source-http.server";
import { stripHtml } from "./triage";
import type { ParsedItem } from "./source-parsers";

export function parseCurrents(value: unknown): ParsedItem[] {
  const parsed = newsSchema.safeParse(value);
  if (!parsed.success) throw new Error("Currents returnerede et ugyldigt nyhedssvar.");
  return parsed.data.news.map((article) => {
    const link = publicSourceUrl(article.url);
    const publishedAt = new Date(article.published);
    if (!Number.isFinite(publishedAt.getTime()) || !article.title.trim())
      throw new Error("Currents-artiklen mangler gyldig titel eller dato.");
    return {
      headline: stripHtml(article.title),
      summary: stripHtml(article.description).slice(0, 1000),
      link: link.href,
      publishedAt,
      publisher: link.hostname.replace(/^www\./, ""),
    };
  });
}

/** Manual pilot: one page, no automatic retries, fixed destination and no credential redirects. */
export async function fetchCurrentsSearch(
  raw: string,
  key: string,
  request: CurrentsRequest,
  now = Date.now(),
) {
  sourceSchema.parse({
    name: "Currents",
    publisher: "Currents",
    connector: "currents",
    source_weight: 0.6,
    url: raw,
  });
  const configured = new URL(raw);
  const url = new URL("https://api.currentsapi.services/v1/search");
  url.searchParams.set("query", configured.searchParams.get("query")!);
  url.searchParams.set("language", configured.searchParams.get("language")!);
  url.searchParams.set("start_date", new Date(now - 7 * 86400000).toISOString());
  url.searchParams.set("end_date", new Date(now).toISOString());
  url.searchParams.set("page_size", "20");
  url.searchParams.set("page_number", "1");
  const response = await request(url.href, key);
  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceHttpError(
      "api.currentsapi.services",
      response.status,
      false,
      retryAfterAt(response.headers.get("retry-after")),
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(await readSourceBody(response));
  } catch {
    throw new Error("Currents returnerede et ugyldigt nyhedssvar.");
  }
  return parseCurrents(value);
}

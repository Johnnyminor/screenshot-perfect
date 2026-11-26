import { testCurrentsRequest } from "@/test/currents-transport";
// @vitest-environment node
import { afterEach, it, expect, vi } from "vitest";
import { planEvaluation, evaluationSpec, type EvaluationRow } from "./currents-evaluation";
import { evaluateCurrentsRequest } from "./currents-evaluation.server";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("retains valid articles from a mixed page and reports rejected records explicitly", async () => {
  const article = {
    id: "valid",
    title: "Clinical trial result",
    description: "Trial",
    url: "http://publisher.example/article",
    published: new Date().toISOString(),
    language: "en",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        status: "ok",
        news: [article, { ...article, id: "invalid", published: "unknown" }],
      }),
    ),
  );
  const result = await evaluateCurrentsRequest(
    {
      query: '"Trial"',
      language: "en",
      start_date: new Date(Date.now() - 86400000).toISOString(),
      end_date: new Date().toISOString(),
      page_number: 1,
    },
    "secret",
    testCurrentsRequest,
  );
  expect(result.error).toBeNull();
  expect(result.articles).toHaveLength(1);
  expect(result.articles[0]?.url).toBe("https://publisher.example/article");
  expect(result.provider_info).toMatchObject({ returned: 2, invalid_records: 1 });
});
it("plans exactly the authorized phase sizes with stable base time windows", () => {
  const companies = Array.from({ length: 72 }, (_, i) => ({
    id: String(i),
    name: `Company ${i}`,
    aliases: [`Alias ${i}`],
    case_sensitive_aliases: [],
    is_danish: i < 22,
  }));
  const base = planEvaluation("base", companies, [], [], []);
  expect(base).toHaveLength(144);
  expect(new Set(base.map((r) => r.company_id)).size).toBe(72);
  const rows: EvaluationRow[] = base.map((r, i) => ({
    id: String(i),
    study_id: "study",
    phase: "base",
    ordinal: i + 1,
    company_id: r.company_id,
    params: r.params,
    status: "completed",
    articles: i < 40 ? [] : Array.from({ length: 20 }, () => ({ title: "Trial" })),
    http_status: 200,
    started_at: null,
    finished_at: null,
    duration_ms: 1,
    error: null,
  }));
  expect(planEvaluation("refinement", companies, rows, [], [])).toHaveLength(16);
  expect(planEvaluation("refinement", companies, rows, [], [])[0]!.params.query).toContain("Alias");
  expect(
    planEvaluation("publisher", companies, rows, ["a.dk", "b.dk", "c.dk", "d.com", "e.com"], []),
  ).toHaveLength(10);
  const pages = planEvaluation("pagination", companies, rows, [], []);
  expect(pages).toHaveLength(10);
  expect(pages.every((p) => p.params.page_number === 2)).toBe(true);
  expect(planEvaluation("repeat", companies, rows, [], ["0", "1", "2", "3", "4"])).toHaveLength(10);
  expect(() => planEvaluation("repeat", companies, [], [], [])).toThrow();
});
it("validates query controls, dates and domains before making a request", () => {
  const end = new Date().toISOString(),
    start = new Date(Date.now() - 7 * 86400000).toISOString();
  const good = {
    query: '"Ambu"',
    language: "da",
    start_date: start,
    end_date: end,
    page_number: 1,
    domain: "medwatch.dk",
  };
  expect(evaluationSpec.safeParse(good).success).toBe(true);
  expect(evaluationSpec.safeParse({ ...good, domain: "https://evil.example/" }).success).toBe(
    false,
  );
  expect(evaluationSpec.safeParse({ ...good, apiKey: "secret" }).success).toBe(false);
  expect(evaluationSpec.safeParse({ ...good, page_number: 200 }).success).toBe(false);
  expect(
    evaluationSpec.safeParse({
      ...good,
      start_date: new Date(Date.now() - 10 * 86400000).toISOString(),
    }).success,
  ).toBe(false);
});
it("makes a single fixed-destination request with header-only credentials and sanitized HTTP errors", async () => {
  const request = vi.fn(async () => new Response("secret reflected by provider", { status: 429 }));
  vi.stubGlobal("fetch", request);
  const result = await evaluateCurrentsRequest(
    {
      query: '"Ambu"',
      language: "da",
      start_date: new Date(Date.now() - 86400000).toISOString(),
      end_date: new Date().toISOString(),
      page_number: 2,
      domain: "medwatch.dk",
    },
    "secret",
    testCurrentsRequest,
  );
  expect(result).toMatchObject({ http_status: 429, articles: [], error: "Currents HTTP 429" });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(request).toHaveBeenCalledTimes(1);
  const [url, options] = request.mock.calls[0]! as unknown as [string, RequestInit];
  expect(new URL(url).hostname).toBe("api.currentsapi.services");
  expect(url).not.toContain("secret");
  expect(options).toMatchObject({
    redirect: "manual",
    headers: { Authorization: "Bearer secret" },
  });
});

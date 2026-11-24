import { z } from "zod";
export const evaluationPhases = [
  "base",
  "refinement",
  "publisher",
  "pagination",
  "repeat",
] as const;
export type EvaluationPhase = (typeof evaluationPhases)[number];
export const evaluationSpec = z
  .object({
    query: z.string().trim().min(1).max(2500),
    language: z.enum(["da", "en"]),
    start_date: z.string().datetime(),
    end_date: z.string().datetime(),
    page_number: z.number().int().min(1).max(5).default(1),
    domain: z
      .string()
      .regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/)
      .optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const start = Date.parse(p.start_date),
      end = Date.parse(p.end_date);
    if (
      end <= start ||
      end - start > 7 * 86400000 ||
      start < Date.now() - 30 * 86400000 ||
      end > Date.now() + 60000
    )
      ctx.addIssue({
        code: "custom",
        message: "Søgningen kræver højst syv dage inden for de seneste 30 dage.",
      });
  });
export type EvaluationSpec = z.infer<typeof evaluationSpec>;
export type EvaluationCompany = {
  id: string;
  name: string;
  aliases: string[];
  case_sensitive_aliases: string[];
  is_danish: boolean;
};
export type EvaluationRow = {
  id: string;
  study_id: string;
  phase: string;
  ordinal: number;
  company_id: string | null;
  params: unknown;
  status: string;
  articles: unknown;
  http_status: number | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
};
export type EvaluationPlan = { company_id: string | null; params: EvaluationSpec };
const quote = (name: string) => `"${name.replace(/"/g, "")}"`;
export function planEvaluation(
  phase: EvaluationPhase,
  companies: EvaluationCompany[],
  rows: EvaluationRow[],
  domains: string[],
  pilotIds: string[],
  now = Date.now(),
): EvaluationPlan[] {
  const base = rows.filter((r) => r.phase === "base").sort((a, b) => a.ordinal - b.ordinal);
  const end = base.length
    ? evaluationSpec.parse(base[0]!.params).end_date
    : new Date(now).toISOString();
  const start = new Date(Date.parse(end) - 7 * 86400000).toISOString();
  const spec = (query: string, language: "da" | "en"): EvaluationSpec => ({
    query,
    language,
    start_date: start,
    end_date: end,
    page_number: 1,
  });
  const sorted = [...companies].sort((a, b) => a.name.localeCompare(b.name, "en"));
  if (phase === "base")
    return sorted.flatMap((c) =>
      (["da", "en"] as const).map((language) => ({
        company_id: c.id,
        params: spec(quote(c.name), language),
      })),
    );
  if (
    base.length !== companies.length * 2 ||
    base.some((r) => r.status === "pending" || r.status === "running")
  )
    throw new Error("Afslut grundtesten først.");
  const count = (r: EvaluationRow) => (Array.isArray(r.articles) ? r.articles.length : 0);
  const company = (r: EvaluationRow) => companies.find((c) => c.id === r.company_id)!;
  if (phase === "refinement") {
    const empty = base
      .filter((r) => r.status === "completed" && count(r) === 0)
      .sort(
        (a, b) =>
          Number(company(b).is_danish) - Number(company(a).is_danish) ||
          company(a).name.localeCompare(company(b).name),
      );
    const aliasOrder = [...empty].sort(
      (a, b) => Number(company(b).aliases.length > 0) - Number(company(a).aliases.length > 0),
    );
    const failed = base.filter((r) => r.status === "failed");
    const aliases = [...failed, ...aliasOrder].slice(0, 8).map((r) => {
      const c = company(r);
      const names = [
        ...new Set([c.name, ...c.aliases, ...c.case_sensitive_aliases.filter((a) => a.length > 3)]),
      ];
      return {
        company_id: c.id,
        params: { ...evaluationSpec.parse(r.params), query: names.map(quote).join(" OR ") },
      };
    });
    const older = empty.slice(0, 8).map((r) => ({
      company_id: r.company_id,
      params: {
        ...evaluationSpec.parse(r.params),
        start_date: new Date(Date.parse(end) - 21 * 86400000).toISOString(),
        end_date: new Date(Date.parse(end) - 14 * 86400000).toISOString(),
      },
    }));
    return [...aliases, ...older];
  }
  if (phase === "publisher") {
    const query = sorted
      .filter((c) => c.is_danish)
      .map((c) => quote(c.name))
      .join(" OR ");
    return domains.slice(0, 5).flatMap((domain) =>
      (["da", "en"] as const).map((language) => ({
        company_id: null,
        params: { ...spec(query, language), domain },
      })),
    );
  }
  if (phase === "pagination")
    return [...base]
      .filter((r) => r.status === "completed")
      .sort((a, b) => count(b) - count(a) || a.ordinal - b.ordinal)
      .slice(0, 10)
      .map((r) => ({
        company_id: r.company_id,
        params: { ...evaluationSpec.parse(r.params), page_number: 2 },
      }));
  const repeat = base.filter((r) => pilotIds.includes(r.company_id ?? ""));
  return repeat.slice(0, 10).map((r) => ({
    company_id: r.company_id,
    params: {
      ...evaluationSpec.parse(r.params),
      start_date: new Date(now - 7 * 86400000).toISOString(),
      end_date: new Date(now).toISOString(),
    },
  }));
}

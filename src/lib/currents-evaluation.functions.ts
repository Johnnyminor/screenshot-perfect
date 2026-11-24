import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { planEvaluation, evaluationPhases, type EvaluationRow } from "./currents-evaluation";
import { checked } from "./ingest.server";

export const planCurrentsEvaluation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ study_id: z.string().uuid(), phase: z.enum(evaluationPhases) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: member, error } = await context.supabase.rpc("is_team_member");
    if (error || !member) throw new Error("Adgang kræver en invitation til redaktionen.");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [companies, rows, publishers, feeds] = await Promise.all([
      checked(admin.from("companies").select("*").eq("active", true)),
      checked(admin.from("currents_evaluation_requests").select("*").eq("study_id", data.study_id)),
      checked(admin.from("currents_evaluation_publishers").select("*").order("domain")),
      checked(admin.from("feeds").select("company_id").eq("connector", "currents")),
    ]);
    if ((companies ?? []).length !== 72)
      throw new Error("Testplanen kræver de aftalte 72 aktive virksomheder.");
    const plan = planEvaluation(
      data.phase,
      companies ?? [],
      rows as EvaluationRow[],
      (publishers ?? []).map((p) => p.domain),
      [...new Set((feeds ?? []).map((f) => f.company_id).filter((id): id is string => !!id))],
    );
    const limit = data.phase === "base" ? 144 : data.phase === "refinement" ? 16 : 10;
    if (plan.length !== limit)
      throw new Error(`Testfasen gav ${plan.length} søgninger; forventede ${limit}.`);
    const records = plan.map((p, index) => ({
      study_id: data.study_id,
      phase: data.phase,
      ordinal: index + 1,
      company_id: p.company_id,
      params: p.params,
    }));
    await checked(
      admin
        .from("currents_evaluation_requests")
        .upsert(records, { onConflict: "study_id,phase,ordinal", ignoreDuplicates: true }),
    );
    return { planned: plan.length };
  });

export const runCurrentsEvaluation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(10) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: member, error } = await context.supabase.rpc("is_team_member");
    if (error || !member) throw new Error("Adgang kræver en invitation til redaktionen.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runEvaluationBatch } = await import("./currents-evaluation.server");
    return runEvaluationBatch(supabaseAdmin, data.ids, process.env["CURRENTS_API_KEY"]);
  });

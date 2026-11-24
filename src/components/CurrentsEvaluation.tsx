import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { must } from "@/lib/queries";
import { evaluationPhases, type EvaluationPhase } from "@/lib/currents-evaluation";
import { planCurrentsEvaluation, runCurrentsEvaluation } from "@/lib/currents-evaluation.functions";
import { Button } from "./ui/button";

const labels: Record<EvaluationPhase, string> = {
  base: "Grundtest (144)",
  refinement: "Aliaser og ældre periode (16)",
  publisher: "Udgivere (10)",
  pagination: "Flere sider (10)",
  repeat: "Gentagelse (10)",
};
export function CurrentsEvaluation() {
  const rows = useQuery({
    queryKey: ["currents-evaluation"],
    queryFn: () =>
      must(
        supabase
          .from("currents_evaluation_requests")
          .select("*")
          .order("created_at")
          .order("ordinal")
          .limit(500),
      ),
    refetchInterval: 30000,
  });
  const plan = useServerFn(planCurrentsEvaluation),
    run = useServerFn(runCurrentsEvaluation);
  const [study, setStudy] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const stop = useRef(false);
  const studyId = study ?? rows.data?.at(-1)?.study_id;
  const current = (rows.data ?? []).filter((r) => r.study_id === studyId);
  const completed = current.filter((r) => r.status === "completed").length;
  const failed = current.filter((r) => r.status === "failed").length;
  async function create(phase: EvaluationPhase) {
    setBusy(true);
    setMessage("");
    try {
      const id = studyId ?? crypto.randomUUID();
      setStudy(id);
      await plan({ data: { study_id: id, phase } });
      await rows.refetch();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Planlægning fejlede.");
    } finally {
      setBusy(false);
    }
  }
  async function collect() {
    setBusy(true);
    setMessage("");
    stop.current = false;
    try {
      for (;;) {
        const latest = await rows.refetch();
        const pending = (latest.data ?? [])
          .filter((r) => r.study_id === studyId && r.status === "pending")
          .sort(
            (a, b) =>
              evaluationPhases.indexOf(a.phase as EvaluationPhase) -
                evaluationPhases.indexOf(b.phase as EvaluationPhase) || a.ordinal - b.ordinal,
          );
        if (stop.current || !pending.length) break;
        const result = await run({ data: { ids: pending.slice(0, 10).map((r) => r.id) } });
        await rows.refetch();
        if (result.stopped) {
          setMessage(result.stopped);
          break;
        }
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Testen blev afbrudt.");
    } finally {
      setBusy(false);
      await rows.refetch();
    }
  }
  return (
    <section className="space-y-3 rounded-sm border bg-card p-4">
      <h2 className="text-xl">Currents dækningstest</h2>
      <p className="text-sm">
        Manuel undersøgelse med højst 190 søgninger. Resultater gemmes separat fra nyhedsarkivet.
        Hver søgning prøves én gang; fejl tæller ikke som tomme resultater.
      </p>
      {rows.error && <p role="alert">Testloggen kunne ikke hentes.</p>}
      <p aria-live="polite">
        {completed} gennemført · {failed} fejl ·{" "}
        {current.filter((r) => r.status === "pending").length} afventer ·{" "}
        {current.filter((r) => r.status === "running").length} kører
      </p>
      <div className="flex flex-wrap gap-2">
        {evaluationPhases.map((phase) => (
          <Button
            key={phase}
            variant="outline"
            disabled={busy || rows.isPending || current.some((r) => r.phase === phase)}
            onClick={() => void create(phase)}
          >
            Planlæg {labels[phase]}
          </Button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          disabled={busy || !current.some((r) => r.status === "pending")}
          onClick={() => void collect()}
        >
          Kør planlagte tests
        </Button>
        <Button
          variant="outline"
          disabled={!busy}
          onClick={() => {
            stop.current = true;
            setMessage("Stopper efter den igangværende batch.");
          }}
        >
          Stop efter batch
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

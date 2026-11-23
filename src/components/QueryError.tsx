import { Button } from "@/components/ui/button";

export function QueryError({ error, retry }: { error: Error | null; retry: () => unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-sm border border-destructive p-3 text-sm text-destructive">
      <p>Data kunne ikke hentes: {error.message}</p>
      <Button className="mt-2" size="sm" variant="outline" onClick={() => retry()}>
        Prøv igen
      </Button>
    </div>
  );
}

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Feed ingestion runs in `src/lib/ingest.server.ts`, triggered by a managed 15-min HTTP schedule hitting `/api/public/ingest` (cron-auth) and by the `runIngestNow` server fn; no Supabase Edge Functions, because the stack is TanStack Start on Workers.
- Pure matching/dedup/scoring logic lives in `src/lib/triage.ts` with tests in `triage.test.ts`; keep it I/O-free so rules stay testable.
- Feeds and companies are DB rows, never hardcoded; a trigger on `companies` maintains one Google News feed per active company.
- Frontend reads/writes via the browser client under RLS; signed-in pages live under `src/routes/_authenticated/` (client-only gate).
- Code, tables and comments in English; UI labels in Danish.

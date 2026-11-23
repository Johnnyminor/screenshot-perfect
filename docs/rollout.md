# Proof-of-concept rollout

## What is ready in this checkout

The dashboard reads real, non-seed records from Supabase under RLS. It has date/source filters, paginated company/topic columns, server-side relevance ranking, a searchable archive, collection-health indicators, and a downloadable source inventory on **Kilder**.

Collection accepts RSS/Atom, ClinicalTrials.gov JSON, and PubMed ESearch/EFetch. Sources and search expressions remain database rows. The new migration adds FDA recalls/safety announcements, a clinical-trial sponsor search, and a PubMed company-affiliation search. Genmab announcements are registered as a paused candidate: the publisher returned HTTP 403 to the identified application collector. The searches initially cover Genmab, Novo Nordisk and Zealand Pharma; edit their source URLs to change scope. The FDA feed is agency-wide, not exclusively medical devices. PubMed abstracts and affiliations are excerpts, not full papers. Original-source links remain attached to every record.

The application is not a clinical alerting system. Relevance scores describe source weight, text matching and recency; they do not establish factual accuracy or clinical significance.

## Database rollout — before publishing the new application

Use the existing Lovable/database migration workflow, or a trusted SQL session. Do not reapply the initial migration to an existing database: it contains tables and synthetic seed stories. Apply these new migrations in order:

1. [Collection reliability](../drizzle/migrations/0001_collection_reliability.sql).
2. [Team membership](../drizzle/migrations/0002_team_access.sql).
3. [Dashboard queries](../drizzle/migrations/0003_dashboard_queries.sql).
4. [Explicit membership policies](../drizzle/migrations/0004_explicit_membership_policies.sql).

If migrations 0001–0003 are already applied, apply only 0004. It updates legacy permissive rules to check team membership explicitly, while retaining the restrictive membership gate. Do not rerun existing migrations.

The membership migration intentionally approves nobody automatically. Before publishing, review the existing authentication accounts and grant access to the actual editors. Invite/create accounts through Supabase Auth first. Run the following with an operator connection, replacing the example email:

```sql
INSERT INTO public.app_members (user_id)
SELECT id FROM auth.users WHERE lower(email) = lower('approved.editor@example.com')
ON CONFLICT DO NOTHING;

SELECT u.email, m.created_at
FROM public.app_members m JOIN auth.users u ON u.id=m.user_id;
```

Do not approve every account indiscriminately. Disable public signups in the Auth provider as well; RLS denies unapproved users even if provider signup remains enabled. Configure the published app URL and allowed authentication redirects. Removing an editor's membership revokes shared-data access and service-function access.

The new app depends on these migrations. Publishing it first will cause schema/RPC errors and prevent membership checks. The membership migration also restricts access from an older app immediately, so coordinate the rollout and membership grants.

## Runtime configuration

| Variable                        | Location                     | Purpose                                               |
| ------------------------------- | ---------------------------- | ----------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Build environment            | Public browser database endpoint                      |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Build environment            | Public browser key; all data access remains under RLS |
| `SUPABASE_URL`                  | Server secret/environment    | Server database endpoint                              |
| `SUPABASE_PUBLISHABLE_KEY`      | Server environment           | Verify editor authentication                          |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server secret only           | Collection transactions; never use a `VITE_` prefix   |
| `LOVABLE_CRON_SECRET`           | Server and scheduler secrets | Authenticate scheduled HTTP requests                  |
| `LOVABLE_CRON_SECRET_PREVIOUS`  | Optional server secret       | Overlapping secret rotation                           |

Use HTTPS source URLs. The collector rejects embedded credentials, special ports, IP literals, local hostnames, unsafe redirects, malformed feeds and responses larger than 5 MB. Source administrators are trusted: hostname validation is not DNS-level network isolation. Configure network egress restrictions if editors will be allowed to add untrusted sources in a broader deployment.

## Hosting and scheduled collection

For the presentation, keep the existing Lovable publishing workflow and Supabase database. The current build uses the existing Nitro Cloudflare adapter. Do not add a second Vite deployment adapter alongside it.

For independent hosting, `npm run build` produces the Cloudflare configuration at `.output/server/wrangler.json` and a Nitro deployment manifest. Configure Cloudflare account/project access and secrets, then use the generated deployment output through the installed Nitro deployment workflow (`npx nitro deploy --prebuilt`). The normal Git branch must remain usable by Lovable; do not rewrite pushed history. Hosting deployment is a separate operation from database migrations.

Configure the managed HTTP scheduler to send:

```text
Schedule: */15 * * * *
Method: POST
URL: https://YOUR-PUBLISHED-APP/api/public/ingest
Authorization: Bearer <LOVABLE_CRON_SECRET>
```

The schedule is external to this repository and is not created by building the app. Store its credential in the scheduler's secret store. Give the scheduler enough HTTP execution time for a collection run; collection is still synchronous. The collector has a 10-minute cooperative runtime budget and 15-second source-request timeouts; platform termination can interrupt it earlier. For larger workloads, use a queue/durable job per source rather than increasing one HTTP request indefinitely. That infrastructure is not provisioned here.

The endpoint responds with 200 for a fully successful collection, 207 when individual feeds failed, and 500 for run-level failures. Treat 207 and a JSON `success: false` as degraded collection in scheduler monitoring. A global database lease prevents overlapping manual, rematch and scheduled runs. After a terminated worker, the next collection can mark a lease abandoned after 20 minutes.

The status strip reports the last observed scheduled run. It only shows a healthy schedule after a fully successful scheduled run within 45 minutes. A recent manual run does not prove the schedule works.

## Presentation rehearsal

Google News requests are serialized with at least 1.2 seconds between requests. HTTP 429 responses are retried at most twice; numeric and dated `Retry-After` headers are honored up to 30 seconds. Longer cooldowns remain visible as source failures and are left for the next scheduled run. Publisher HTTP 403 blocks are not bypassed or retried aggressively.

1. Sign in with an approved account. Confirm an unapproved account cannot read shared tables or invoke ingestion.
2. Open **Kilder**, export all sources, and review the actual active list. Include Google News when evaluating coverage.
3. Run one primary source, inspect its per-source log, and open a saved original-source link.
4. Run all active sources and inspect failures. FiercePharma returned 403 during the initial review; repair its URL/access or pause it explicitly. Do not bypass publisher access controls.
5. Configure company/topic columns. Confirm real stories appear, test stories remain hidden, and relevance/date sorting and source/date filters work.
6. Change an alias or topic keyword, then use **Genberegn arkivets match** on **Kilder**. Ordinary collection also rematches the non-seed archive, including stories from feeds returning 304.
7. Wait for at least two scheduled runs. Check their timestamps and trigger labels in the run history. A build or manual collection alone is not scheduler verification.
8. Demonstrate marking a story read/used, copying a citation, and finding an unmatched story in the archive.

## Live rollout verification — 23 November 2026

Migrations 0001–0004 were applied through the project's SQL editor. The existing editor account was added to `app_members` in the same transaction as the first three migrations. The public Auth settings API confirms `disable_signup: true`.

The authenticated preview was checked against the live database: company/topic columns, source/date filters, and archive pagination work. FDA recalls collected 20 records, ClinicalTrials.gov collected 75, and PubMed collected 105, with zero errors in those individual runs. The subsequent full collection completed with 73 successful sources, five Google News HTTP 429 failures, two publisher HTTP 403 failures, and nine additional records. The Google pacing/retry fix was added after that full run.

The existing `ingest-feeds` job remains active on its 15-minute schedule, with recent workflow executions marked successful. A scheduled collection recorded by the updated application still needs verification after publication. Workflow success alone does not establish application-level collection success.

After migration 0004, SQL confirms zero unconditional shared-table allow expressions. Lovable's critical database finding cleared on recheck. One non-critical warning remains about approved editors controlling outbound source URLs; source administrators must remain trusted, as explained above. No warning was ignored in the security interface.

Publishing and post-publication schedule verification remain separate steps.

## Remaining coverage choices

Primary company feeds beyond Genmab, licensed Danish specialist reporting, Nasdaq-wide disclosures, Danish device-safety notices and reimbursement/assessment sources still require validated URLs/access agreements and selection. Do not treat Google News as guaranteed coverage of those sources. Additional public RSS sources can be added immediately through **Kilder**; other APIs need an explicit connector.

## Validation

`npm test` includes isolated PostgreSQL migration/RLS/transaction tests using PGlite. It does not connect to the live database. `npx tsc --noEmit` checks application types; `npm run build` validates the Cloudflare deployment build. Local regression tests do not establish live scheduler health or publisher accessibility from the deployed worker.

To run the optional public-endpoint checks in PowerShell, set `$env:VERIFY_PUBLIC_SOURCES='1'`, then run `npm test -- src/test/public-sources.test.ts`. This reads the new source URLs from the migration, fetches public publisher/API responses, and validates the parsers. It never writes to the application database. Remove the environment variable after the check.

Connector references: [ClinicalTrials.gov API](https://clinicaltrials.gov/data-api/api), [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/), [Cloudflare TanStack Start hosting](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/). The project already has a Nitro adapter, so use its generated output instead of following instructions to add a second adapter.

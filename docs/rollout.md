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

The schedule is external to this repository and is not created by building the app. Store its credential in the scheduler's secret store. Give the scheduler enough HTTP execution time for a collection run; collection is still synchronous. The collector has a 5-minute cooperative runtime budget and 15-second source-request timeouts; platform termination can interrupt it earlier. For larger workloads, use a queue/durable job per source rather than increasing one HTTP request indefinitely. That infrastructure is not provisioned here.

The endpoint responds with 200 for a fully successful collection, 207 when individual feeds failed, and 500 for run-level failures. Treat 207 and a JSON `success: false` as degraded collection in scheduler monitoring. A global database lease prevents overlapping manual, rematch and scheduled runs. After a terminated worker, the next collection can mark a lease abandoned after 20 minutes.

The status strip reports the last observed scheduled run. It only shows a healthy schedule after a fully successful scheduled run within 45 minutes. A recent manual run does not prove the schedule works.

## Presentation rehearsal

Google News is supplementary and has no availability guarantee. At most six Google feeds are checked per scheduled run, three seconds apart, with a three-hour per-feed cadence. Primary RSS sources run every 15 minutes; PubMed and ClinicalTrials.gov run hourly. Manual single-source runs bypass cadence but respect provider cooldowns.

Migration 0005 persists provider health. HTTP 403 pauses a provider for a day. Google throttling starts a one-hour cooldown, doubling on consecutive failures up to a day; other transient failures start at 15 minutes. Longer Retry-After values are respected. Explicit automated-request blocks stop retries immediately. Deferred feeds are counted separately and displayed on Kilder. Direct sources continue while Google is paused.

NCBI requests are serialized at one per second. PubMed skips article-detail downloads for stored PMIDs. Optional server-only secrets NCBI_API_KEY and NCBI_TOOL_EMAIL identify the application. Never use VITE prefixes or store credentials in feed URLs. Follow the [NCBI usage guidance](https://eutilities.github.io/site/API_Key/usageandkey/) if shared-host throttling persists.

1. Sign in with an approved account. Confirm an unapproved account cannot read shared tables or invoke ingestion.
2. Open **Kilder**, export all sources, and review the actual active list. Include Google News when evaluating coverage.
3. Run one primary source, inspect its per-source log, and open a saved original-source link.
4. Run planned collection and inspect failures and deferrals. FiercePharma returned 403 during the initial review; repair its URL/access or pause it explicitly. Do not bypass publisher access controls.
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


## Google collection recovery - 23 November 2026

The last inspected old scheduled run recorded 5 successful sources, 72 Google HTTP 503 failures, one NCBI HTTP 429 and two publisher HTTP 403 failures. A local Google request returned valid RSS, followed by HTTP 429 automated-request protection. This indicates intermittent provider throttling rather than a universal query/parser failure. The worker response must be checked independently.

Migration 0005 was applied live: 72 Google feeds have a 180-minute cadence, two API feeds 60 minutes, and seven static RSS feeds 15 minutes. Tests cover persistent cooldowns, primary collection during a Google pause, six-feed Google limits, cached PubMed records, redirects and provider-health access control. Cooldowns prevent repeated blocked requests but cannot force provider acceptance. Guaranteed broader coverage requires validated direct sources or a licensed news API and connector.


### Recovery deployment verification

Commit 24a38a1 was published successfully. A live manual planned-collection run at 16:06 Copenhagen time finished in 44 seconds: 6 sources succeeded, 3 failed, 71 were deferred, and 400 archived stories were rematched. PubMed succeeded with 106 known records and no new records. The deployed worker confirmed Google HTTP 503 with explicit automated-request rejection; only one Google feed failed before the remaining 71 were deferred. The persistent Google pause expires no earlier than 17:06; repeated failure extends it. FiercePharma and GlobeNewswire returned 403 and were paused for a day. No provider access controls were bypassed.

The existing 15-minute schedule was preserved. This live manual test verifies the deployed collection pipeline, not a completed scheduled run on the new version. The next scheduled run remains to be observed. Google coverage is still unavailable during its provider pause.


## First-party company RSS - 24 November 2026

Migration 0006 adds four active hourly RSS sources, linked by company_id to existing companies: Nordic Bioscience, Union Therapeutics, BioPorto and Ferrosan Medical Devices. The approved outbound-domain list includes only those four additional publisher domains. Ingestion and archive rematching use explicit static-feed ownership when a headline does not name its company; exclusion terms still veto the match. Google search feeds do not confer ownership.

All four feeds passed a live application-parser smoke check using the collector User-Agent. At discovery, Nordic Bioscience's latest entry was 13 November 2026, UNION's 31 October 2025, BioPorto's 23 April 2026, and Ferrosan's 30 April 2026. The normal 30-day filter remains in force; a successful check with zero new stories is expected for the latter three. A feed is not evidence of complete corporate news coverage: BioPorto's investor announcement page contains newer announcements than its general RSS feed.

### Announcement-page investigation

| Company | Finding and next implementation route |
| --- | --- |
| ALK | Official RSS directory https://ir.alk.net/rss links /rss/news-releases.xml; collector receives 403. Seek supported access; do not activate as working. |
| Ambu | Official https://www.ambu.com/corporate-info/investors/news-from-ambu loads; release selection uses hash routes. Investigate the page's data source before writing a connector. |
| Bavarian Nordic | https://www.bavarian-nordic.com/investor/investor.aspx exposes dated announcements with company-hosted detail links. Strong candidate for a bounded HTML connector. |
| BioPorto | https://bioporto.com/investor-relations/announcements/ has current release titles/dates, backed by GlobeNewswire links/embedded news archive. Do not assume its old general RSS covers investor news. |
| Coloplast | Official investor page returned 403 with collector identification; no usable RSS confirmed. |
| Demant | Company-announcements page loads but release list is absent from static extracted HTML. Investigate its data widget. |
| Ferring | Official homepage returned 403; no working feed confirmed. |
| Novonesis | Company-announcements page loads but no RSS was declared in inspected HTML. Investigate its data source. |
| Radiometer | Official homepage links /en/about-radiometer/news; no RSS was declared. Inspect this news listing for a bounded connector. |
| Xellia | Homepage loads; no news RSS declared (LinkedIn feed URLs are social links, not RSS). Inspect its news section. |

No HTML/API connector or email subscription is created by this migration. These are investigation results, not validated replacement coverage. Any connector must keep bounded requests, approved redirects, explicit failures, original dates and provenance in the existing ingestion pipeline.


### First-party deployment verification

Commit 52dad61 was published on 24 November 2026. The four source rows specified by migration 0006 were inserted through the signed-in application database API under team RLS after publishing. The migration remains idempotent if replayed. Each row is active, uses RSS, polls hourly, and links to its existing company; no company or Google feed was duplicated.

The live 13:50:38 Copenhagen manual run completed: 8 sources OK, 0 failed, 71 deferred, 5 new records, and 412 archive records rematched. Nordic Bioscience returned 10 feed entries and stored 4 recent new stories. BioPorto returned 6, UNION 10 and Ferrosan 10 entries, with zero recent new stories as expected. All four received successful checkpoints and next-poll times. Local verification passed 72 regression tests, five live feed/configuration checks, TypeScript, focused lint and production build.

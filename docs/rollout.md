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


## Currents manual pilot

Migration 0007 extends source connector validation, adds a service-only atomic request-budget function (40 claims per UTC day), and seeds ten paused query sources: ALK, Ambu, Bavarian Nordic, Coloplast and Demant, in Danish and English. Feed URLs contain only query/language; credentials come from server secret CURRENTS_API_KEY and use Authorization headers. The helper never follows redirects, returns sanitized errors, and performs no automatic HTTP retries.

The scheduled collector and ordinary planned runs exclude Currents. Activate the ten pilot rows after deployment, then use Kilder's manual Currents button. Each run searches the preceding seven days, first page only, up to 20 records per source. A full page is logged as potentially incomplete. Empty results are successful checks, not proof of complete coverage. API-search company associations are configuration only: they never confer first-party ownership or force matches. Original publisher domains are stored on articles; item_sources retains Currents provenance. Existing stories are deduplicated without replacing richer source content.

The UI shows daily claims. This is the manual ingestion pilot budget, not a measure of all requests against the account: other consumers, including the existing on-demand latest-news helper, may consume additional provider quota. GDELT fallback is not enabled; its summary endpoint is HTML, while DOC artlist JSON remains a separate candidate requiring access and parsing validation.


### Currents pilot live verification - 24 November 2026

Migration 0007 was applied transactionally, then commit f6d946f was published. Ten paused sources were verified and activated through team-authorized database access. The manual 14:39:17 Copenhagen run completed successfully: 10 searches OK, 0 errors, 0 deferrals, 15 newly stored stories. Daily budget usage was 10/40. Results by configured search language: 10 Danish, 5 English. Results by company: ALK 1, Ambu 0, Bavarian Nordic 5, Coloplast 1, Demant 8. All 15 persisted records retained their original publisher domains and company matches after archive rematching. Publishers included borsen.dk, globenewswire.com, investing.com and seekingalpha.com. This verifies sampled metadata/search coverage, not completeness or full-text access. Ambu's empty result remains a coverage gap. GDELT remains unconfigured.

Local verification: 95 regression tests passed (seven optional network checks skipped), TypeScript, focused ESLint and production build passed. The scheduled pipeline does not query Currents; manual requests still obey the persistent provider budget. An API search does not imply first-party company ownership.


## Company identity matching

Migration 0008 adds company-owned ambiguous_terms, context_terms and excluded_name_phrases arrays. These rules remain database configuration and are editable under Virksomheder. Name phrases belonging to another entity are masked before matching, rather than vetoing all other company mentions in the story. Only configured ambiguous names require at least one supporting context term; other full names/aliases retain their previous behavior. A trailing * on a context term permits word-prefix matching. Existing exclude_terms still veto the whole story, and explicitly linked first-party feed ownership remains separate.

Initial rules target observed Bayer football, Governor Abbott, B. Braun basketball, maritime Evotec, insufficient-context Baxter, and fictional Gilead matches. Positive regressions retain pharmaceutical, device, regulatory/supply, agricultural Roundup and financial stories with explicit corporate identities. These rules intentionally prefer leaving uncertain short-name records unmatched over asserting company coverage without evidence. They cannot establish factual identity from every short headline.

Deploy migration 0008 before the updated company editor, publish the matching code, then use Kilder's archive-rematch action. This recomputes stored associations without deleting the underlying stories or consuming Currents requests. Misleading stories may remain visible as unmatched records in Arkiv; they should no longer appear as company news. Local tests cover the same SQL rule configuration used in production.


### Identity matching live verification - 24 November 2026

Migration 0008 was applied to the live database and commit a23c059 was published. The live company editor exposes the saved rules. The 15:11:18 Copenhagen archive-rematch run completed with zero errors and recomputed 428 real stories. No publisher/API ingestion was invoked.

A before/after audit of all non-test company associations fell from 297 to 270. Exactly 27 prior associations were removed: 20 Bayer Leverkusen football, three Governor Abbott, one B. Braun Sheffield Sharks basketball, one fictional Gilead, one maritime/unsupported Evotec and one insufficient-context Baxter record. Genuine Bayer associations remained 6, Abbott 2, Baxter 1 and Gilead 4. Nordic Bioscience remained at 4, and all 15 Currents pilot records retained their company matches (ALK 1, Bavarian Nordic 5, Coloplast 1, Demant 8). No other pre-existing company associations were lost in the comparison. Underlying stories remain in the archive; matching conservatively leaves uncertain identities unassigned.

Validation: 120 tests passed, seven optional network tests skipped; TypeScript, focused lint and production build passed. The tests load the actual migration rules and exercise negative and positive headlines, punctuation/case variants, whole-story editorial exclusions, independent valid mentions alongside namesakes, and first-party ownership.


## Currents 190-request evaluation

The authorized 24 November study completed all 190 requests (144 baseline, 16 recovery/refinement, 10 publisher, 10 pagination and 10 later repeats). There were 188 successful searches and two initial failures; follow-up refinements returned usable results for both affected companies. The final provider header confirmed 49 requests remaining of 250. The application counter is 200 including the earlier ten pilot requests. Migration 0009 raises the application allowance only on 24 November 2026; it automatically returns to 40/day afterward. Migration 0010 records provider quota metadata.

Results remain in the team-only evaluation log, separately from production stories. See the [full 72-company report](./currents-evaluation-2026-11-24.md) and [structured audit](./currents-evaluation-2026-11-24.json). The report includes publisher gaps, 100 manually reviewed metadata samples, source/date checks, canonical duplicate checks and a subscription recommendation. The evaluation controls remain manual and do not alter the ingestion schedule. Final regression suite: 127 passed, seven optional network checks skipped.

## Direct collection, recovery and editorial rehearsal — 25 November 2026

Migrations 0011 and 0012 were applied together in a transaction, without changing 0000 or the existing `ingest-feeds` job. The Bavarian Nordic source was initially paused, then enabled after publishing the adapter and dashboard. Company identity, source URL, owner and hourly polling cadence remain database configuration. Currents remains manual; today's pilot allowance is 40 and these checks consumed no Currents requests.

### Direct announcements

The approved adapter reads Bavarian Nordic's server-rendered [announcement list](https://www.bavarian-nordic.com/investor/news/news.aspx), validates and upgrades its own HTTP announcement links to HTTPS, and fetches summaries from the company's article pages. It accepts only that listing and company-hosted detail URLs, retains the original dates with day precision, and collects within the existing 30-day window. No Google, GlobeNewswire, API key, proxy or browser scraping service is involved. A changed listing/detail structure fails explicitly. More than 20 recent announcements also fails explicitly until pagination is extended; this is a bounded adapter rather than a general web crawler.

Live run `836b8e7e-6985-4b35-9361-3ead6ee2864a` at 10:22:06–10:22:42 Copenhagen completed: one source OK, zero failures, seven new announcements, 447 real stories rematched. Every new announcement has its original company URL, publisher, dated metadata, provenance row and Bavarian Nordic association. Repeating collection checked seven announcements with zero new records or errors. Exact-URL replay is deduplicated; an equivalent release under a different publisher URL can still be a separate archive record. Filter by the direct source for the presentation.

### Abandoned runs and PubMed

The 24 November 09:00 scheduled run was marked abandoned by lease recovery at 09:30. Its only saved log entry was `Collection lease expired`. A second run at 25 November 10:00 was still marked running beyond its five-minute budget and was recovered automatically when the manual collection began at 10:22:06. It likewise retained no source or stage log. The manual recovery completed successfully. No source checkpoint or new article from the second run was found in the available records. This does not establish whether the original failure was a platform interruption, a database/network issue or another termination: no response body or platform exception survived in those records.

Lovable's managed Jobs screen showed the existing job active every 15 minutes and labeled both the 10:00 and 10:15 workflow executions Succeeded. That label does not establish that application collection finished. The application now checkpoints its stage, counters and completed-source log before source work and between batches/archive pages. An expired lease therefore preserves already-written progress. A live checkpoint was observed after the new source succeeded and 200 archive stories had been rematched. The 20-minute database lease and five-minute execution budget are unchanged.

PubMed history showed HTTP 429 rate limits, including 25 November 04:30 Copenhagen, followed by successful checks at 05:00, 06:15, 07:30 and 08:45. The 24 November 12:30 invalid-XML error was followed by a successful 13:45 check. The original invalid response was not retained, so a truncated payload versus another malformed HTTP-200 response cannot be distinguished retrospectively. A fresh public EFetch response validated as XML. The collector now retries an invalid EFetch payload once through the same paced transport and records only validation location/code and response length, not raw content, request URLs or credentials. Repeated invalid data still fails the source; cache validators are not advanced on failure.

The isolated live PubMed recovery run `7190bb67-29a8-4144-991a-e3eac382aecd` at 10:23:01–10:23:40 Copenhagen completed: 105 records checked, zero new records, zero errors, 447 real stories rematched. Existing PMID caching avoids unnecessary detail downloads. This confirms current recovery, not elimination of future provider rate limits. Optional server-side NCBI credentials remain supported; lack of a key is not evidence that the API requires one.

### Dashboard coverage

The header independently reports a recent scheduled application start, that run's completion/error/overdue state, and automatic source freshness/errors. An in-progress or partial run no longer implies the scheduler stopped. A running job exceeding six minutes is flagged; all-deferred runs do not imply successful source coverage. Freshness follows each source's cadence. The ten manually operated Currents searches are counted separately.

Kilder now separates direct/API source freshness from Google News and names missing/stale/error sources. The company table contains all 72 active companies, real-story counts over seven and 30 days, latest known publication and direct-source status. It runs under membership RLS and excludes seeds and estimated publication dates. Immediately after deployment, 57/72 companies lacked stories published in the preceding seven days; direct/API sources were 7/13 fresh without errors and Google News 0/72. These are time-stamped archive observations, not a completeness or identity guarantee; quiet companies may have no recent announcements. Cross-publisher copies may count as separate records.

### Presentation rehearsal

Use the signed-in Overblik view, add/select the Bavarian Nordic column, choose **Seneste måned**, then select **Bavarian Nordic direkte meddelelser** under Kilde. The seven real company announcements appear; the default seven-day window deliberately excludes the older vaccine stories.

Recommended sequence:

1. Open Kilder and distinguish the scheduler's activity from actual source coverage. Expand the 72-company table to show concrete gaps rather than promising complete monitoring.
2. In Overblik, open the [UK vaccine contract announcement](https://www.bavarian-nordic.com/investor/news/news.aspx?news=7621), dated 2 November. Confirm publisher, original URL, source summary and company match. Describe it as the company's announcement, not independent verification.
3. Use the [global mpox stockpile announcement](https://www.bavarian-nordic.com/investor/news/news.aspx?news=7620), dated 27 October, as a second relevant story. The 23 November buyback release demonstrates freshness, but is a weaker pharma editorial example.
4. Mark a story read, copy its citation, and demonstrate the Lex-reference form. Registering use requires a valid HTTPS Lex article address; the success message appears only after the database confirms the write. Actual use should be registered only after editorial use, not merely because a story is relevant.
5. Reject an unsuitable item, then show that it remains traceable in Arkiv with **Kun uden match** switched off. This distinction preserves evidence without treating a rejection as deletion.

Observed rehearsal evidence: a temporary Nordic Bioscience column returned no stories for seven days and four for 30 days, correctly showing the date-window effect. Its pancreatic-cancer research story opened at the first-party URL with HTTP 200, read status persisted, and copying produced the success notification. A Bavarian story's temporary used status and Lex reference persisted; rejection also persisted, and the rejected story remained visible in Arkiv. On the published new workflow, the direct UK-contract story could not be saved as used without a reference, then persisted a temporary valid-reference association with the confirmed success notification. These were rehearsal actions, not claims of an actual Lex publication. All three temporary action rows were removed and absence verified, restoring their original states. The temporary Nordic column was removed; the added Bavarian Nordic column remains available for the demonstration, with the relative order of existing columns preserved.

Validation: production build and TypeScript passed; focused lint has no errors (the pre-existing ItemCard fast-refresh export warning remains). The full suite passed 137 tests with seven optional network checks skipped; the subsequent overflow regression also passed. Membership isolation for the coverage aggregate, seed exclusion, persisted checkpoints, malformed-PubMed retry, URL validation, original citation metadata and scheduler/coverage separation are covered.

### Final scheduled recovery confirmation

After publication of the final refinements (commit 29e3ab0), the existing scheduler's 10:30:02–10:30:32 Copenhagen run completed automatically: eight sources OK, zero errors, 71 deferred, zero new stories. The dashboard correctly showed both the completed scheduled run and the continuing coverage gap. Direct/API freshness recovered to 11/13; Google News remained 0/72. The company table still showed 57/72 without seven-day stories. FiercePharma and GlobeNewswire remained on their existing denied-provider cooldowns; no bypass, extra scheduler or paid API request was introduced. Manual and scheduled recovery are confirmed, while the historical termination cause remains unproven and instrumented for future diagnosis.

## Company browsing in Overblik — 25 November 2026

At the user's request, all 72 Google News company flags were disabled and the FiercePharma and GlobeNewswire feeds paused. All 74 feed rows, URLs, errors and collected stories were retained. Verification found no unrelated source activation changes. Routine company edits respect the saved Google News flags.

Migration 0013 adds `dashboard_company_updates`, a security-invoker aggregate under existing membership RLS. It returns one count and latest publication per database company, including zero-count companies, using the same date/source/opinion/dismissal filters as dashboard stories. Seeds are excluded. The picker obtains counts in one database request rather than making a request for every company. No publisher/API collection, quota consumption or scheduler change is involved.

Overblik now supports name/alias search, alphabetical/latest-publication/story-count ordering, and a company-list filter for companies with collected stories. Choosing any company opens a temporary stream; its time/relevance and opinion settings remain local. **Tilbage til mine kolonner** restores the user's saved layout. Selecting an empty company remains explicit even if list filters later exclude it. Empty streams explain the archive limitation and link to source coverage. Counts refresh after editorial dismissals or opinion changes as well as periodically.

Live verification of commit 136d91b: the picker offered all 72 companies, plus the saved-column view. Searching the Novozymes alias found Novonesis. Novonesis showed zero non-test matched stories even across the full archive, and its empty temporary stream correctly retained its identity. Selecting Bavarian Nordic, 30 days and the direct announcement source produced seven counted stories and seven article cards. Filtering to companies with stories reduced that source-specific list to Bavarian Nordic. Returning restored all eight saved columns. A complete before/after comparison verified every saved column field unchanged; all 74 paused feeds remained paused.

Validation: 143 tests passed with seven optional network checks skipped, TypeScript and production build passed. Database tests exercise member/outsider access, zero-story companies, seed exclusion, date/source filtering, opinion filtering and per-user dismissals. UI tests exercise alias search, company selection, chronological/count sorting and preservation of an empty selection. Follow-up presentation polish uses date-only latest-publication labels (some direct sources have only day precision), Danish singular/plural story labels and filter-aware empty-state guidance.

### Only stories also applies to saved columns

The **Kun med historier** checkbox now belongs to the dashboard, so its state survives switching between a temporary company stream and **Mine faste kolonner**. In the saved view, a column is hidden only after its actual story query confirms there are no visible rows and no further result page. The decision therefore respects that column's own date, source, relevance, opinion and dismissal filters. Topic columns follow the same rule. Loading, failed queries and further pagination remain visible. Turning the checkbox off restores all saved columns; no layout or story records are deleted or changed. Counts that are still loading do not cause companies to be removed from the picker.

Focused regressions cover hiding/restoring empty saved companies, retaining the checkbox on return from a temporary stream, reacting to date/source changes, preserving error visibility and leaving saved settings untouched.

Live verification of c7e15c2: with the current seven-day/all-source filters, the eight saved columns reduced to four non-empty streams. Novonesis, Eli Lilly, Johnson & Johnson and the empty acquisition topic were hidden. Unchecking restored all eight; checking again and returning from a temporary Bavarian Nordic stream retained the filter and kept Novonesis hidden. All eight saved database column records were byte-for-byte unchanged in the before/after comparison. The six focused tests, TypeScript, lint and production build passed. The checkbox was left enabled in the live dashboard.

## Reference preservation, Google defaults and priority company expansion

Migrations 0014–0016 were applied to the live database. Application commits b8e17c9 and 5ee5693 were published; c46f0ca records the subsequent database-only announcement identifier correction. Existing source flags and the managed 15-minute schedule were preserved. No Currents requests were made.

### Editorial references and Google defaults

Status changes now omit unspecified reference/note fields. A database trigger also retains those fields when an older browser sends NULL during an update. Existing references can still be replaced with another valid reference. Read/unread state therefore no longer erases the Lex association or note. The used marker and **Åbn Lex-artikel** link remain visible whenever a saved reference exists, independently of read status. The reference form follows asynchronously loaded action data until the editor starts typing a draft.

Live verification used a temporary action on the Bavarian Nordic UK-contract story: legacy-style NULL updates to read and unread retained both the reference and note; the published read button also retained them and kept the used marker/link visible. The temporary test row was removed, with absence verified. No real editorial-use record was overwritten.

Both the database and new-company form default Google News to false. The published new-company draft was checked and cancelled without saving: Google News was off. Existing company flags remain unchanged, and explicitly opting in remains possible. Company-page wording now explains the opt-in behavior rather than promising an automatic feed.

### Direct sources added

| Company | Public source and collection method | Verified stored releases |
|---|---|---:|
| Novonesis | [Official announcement page](https://www.novonesis.com/en/investors/company-announcements) embeds [Euroland's public company widget](https://tools.eurolandir.com/tools/pressreleases/?companycode=dk-nzmb&v=r2024&lang=en-gb). Collect its read-only data endpoint and individual release pages. | 10 |
| Ambu | [Official news page](https://www.ambu.com/corporate-info/investors/news-from-ambu) uses the public company news endpoint. Collect dated text and preserve its documented hash-routed item permalinks. | 9 |
| ALK-Abelló | [Official press page](https://www.alk.net/press) supplies dated headline metadata and original publisher links. | 5 |

The adapters retain company/source identity in database rows and use the existing announcements connector and hourly polling cadence. Public data POSTs are bounded reads to approved destinations; redirects are rejected. Restricted Ambu entries are excluded. Dates that lack a documented timezone are retained at day precision. Ambu's specific item fragment is preserved by canonicalization so different releases do not collapse into the same page URL. Other URL fragments continue to be removed.

ALK's blocked RSS host is not used. Its company press page remains accessible; the collector does not fetch blocked external full text or fabricate summaries. Some Novonesis releases publish their content as PDF attachments, so their HTML summary may only point to the PDF. These adapters provide company-announcement coverage, not independent reporting or a complete historical archive. Zealand Pharma and the tested Lundbeck RSS endpoint returned HTTP 403 from the collector environment; neither was enabled and no protection was bypassed.

### Live collection and recurring-headline correction

The initial 11:47:20–11:47:50 Copenhagen run completed with six sources OK, zero failures and 19 new records. Source results were ALK 5 seen/5 new, Ambu 8/8 and Novonesis 10/6. The Novonesis discrepancy revealed that the existing storage RPC merged older weekly buyback releases into the recent record based on identical headlines. Migration 0016 restricts that headline fallback for announcement sources: distinct canonical release identifiers must remain separate. Replay of the same identifier remains deduplicated.

The 11:51:53–11:52:23 Novonesis recovery run completed successfully and restored all four missing releases, giving ten distinct stored announcements. Provenance and company associations were verified for all new sources. Subsequent scheduled runs succeeded for all three; Ambu independently picked up a ninth release while work was paused. On resuming at 15:42, stored provenance totals were Novonesis 10, Ambu 9 and ALK 5. Novonesis's current 30-day fetch had fallen to seven entries because three older releases aged out; previously collected records remain in the archive. The 15:43:06 repeat Ambu run completed with one source OK, no errors and zero new records, confirming stable replay.

The complete suite passed 156 tests, with seven optional network tests skipped. TypeScript and the production build passed during implementation. Regression coverage includes legacy NULL status updates, note/reference retention, Google opt-in defaults, distinct recurring announcement identifiers, replay deduplication, Ambu item permalinks, restricted-entry exclusion, strict date/response validation and bounded data POSTs. Older-source intermittent PubMed rate limits and a BioPorto timeout were observed during the interruption; these do not represent failures of the new company adapters.

Follow-up: BioPorto's 15:44:30–15:44:55 manual retry succeeded with an unchanged feed and no new records, clearing its timeout error. All existing Google flags remained disabled, all 74 intentionally paused feeds remained paused, and no temporary editorial action remained. The final Novonesis dashboard check used the full archive and direct-source filter to show ten separate article cards. Fourteen automatic sources and ten manual Currents searches are now active; first-party company sources increased from five to eight.

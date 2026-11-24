# Currents coverage evaluation 24 November 2026

Currents is useful as a supplementary source of English company reporting and selected Danish coverage, but the evidence does not justify paying solely to close the Danish specialist-publisher gaps. The tests found useful Børsen and GlobeNewswire records, while MedWatch, Dagens Medicin and FiercePharma returned no results for the scoped publisher probes. Higher paid quotas do not establish that those missing results would become available.

The full authorized budget was executed: **190 requests, 188 successful responses and two initial failures**. The provider's final rate-limit header confirmed **49 requests remaining out of 250**. The application counter reached 200 including the ten earlier pilot requests; the provider count also includes the user's other earlier request. The temporary application limit is 200 on 24 November only, then returns to 40/day.

The [structured audit](./currents-evaluation-2026-11-24.json) contains the 72-company table, all 190 request records with query/time/status metadata, returned title/link records, 100 reviewed samples and the link checks. Credentials and article bodies are not included. Evaluation results are stored separately from the dashboard news archive.

## Scope and execution

The baseline used each of the 72 active database company names as an exact quoted query in Danish and English. Its rolling seven-day window was **17 November 2026 14:31:19 UTC to 24 November 2026 14:31:19 UTC**, first page only, at most 20 records. The baseline made 144 attempts, yielding 142 successful responses.

One English Novartis request received HTTP 429. The runner stopped, preserved its results, and resumed after a pause with slower pacing. Later headers confirmed the 250/day allowance still had quota. The precise provider burst threshold was not established. One English Novo Nordisk response failed our initial strict validation; the original cause could not be established from the saved response metadata. Subsequent processing validates records individually and records rejected-record diagnostics.

The 16-request refinement allowance was adapted to cover the two affected searches, six alias searches and eight older-window searches. Novartis's exact-query recovery returned 20 records. Novo Nordisk's broader name-and-alias query returned 20; this is not an exact replacement for the failed baseline query. No later response contained rejected records. The older window was **3–10 November 2026**, seven days within the free plan's history allowance.

| Phase | Requests | Successful | Failed | Returned records |
|---|---:|---:|---:|---:|
| All-company baseline | 144 | 142 | 2 | 442 |
| Recovery, aliases and older window | 16 | 16 | 0 | 53 |
| Publisher probes | 10 | 10 | 0 | 22 |
| Second pages | 10 | 10 | 0 | 89 |
| Later repeat | 10 | 10 | 0 | 16 |
| **Total** | **190** | **188** | **2** | **622** |

Across all phases there were 548 distinct returned URLs before application-style canonical comparison. These are URLs, not distinct editorial events. Baseline results contained 442 records and 416 distinct URLs after the canonical comparison. Median successful request processing was 587 ms; the longest was 1,659 ms. These timings exclude deliberate pacing and are not an uptime guarantee.

## Coverage results

The baseline returned at least one record for **56 companies**, with no recent-window result for **16**. English searches returned 425 records across 53 companies. Danish searches returned only 17 records across eight companies. Older-window refinements additionally demonstrated Ambu and Ascendis coverage; that does not establish current-week coverage.

The table distinguishes raw results from name matching. **Neither is a curated coverage guarantee.** The current matcher still accepts some unrelated uses of Olympus, CSL, Philips and Radiometer. At least one intended-company sample was identified for 51 companies in the baseline metadata review; that includes financial/corporate reporting, not only clinical or medtech developments.

- **20*** means the page cap was reached, not that only 20 articles exist.
- **E** means a failed baseline response, not zero coverage. Follow-up counts are shown separately.
- **Name-matched URLs** are unique baseline URLs accepted by the current name/context matcher. They are not manually approved story counts and exclude the two recovery queries.
- A zero means no record in this exact bounded search, not proof that the company published no news.

| # | Company | Danish raw | English raw | Name-matched URLs | Assessment and extra tests |
|---:|---|---:|---:|---:|---|
| 1 | 3Shape | 0 | 2 | 2 | Intended-company sample identified; counts are not a completeness measure. |
| 2 | Abbott | 0 | 20* | 4 | 4 of 20 baseline URLs passed name/context matching; second page was politics/entertainment noise. |
| 3 | AbbVie | 0 | 15 | 12 | Intended-company sample identified; counts are not a completeness measure. |
| 4 | Alcon | 0 | 1 | 0 | Only entertainment result; no healthcare-company item verified. |
| 5 | ALK-Abelló | 0 | 1 | 1 | Intended-company sample identified; counts are not a completeness measure. |
| 6 | Ambu | 0 | 0 | 0 | Recent window empty. Older DA window returned 7 URLs, including revised-title duplicates; known 23 Nov buyback release was not retrieved. |
| 7 | Amgen | 0 | 5 | 5 | Intended-company sample identified; counts are not a completeness measure. |
| 8 | Ascendis Pharma | 0 | 0 | 0 | Recent window empty; older EN window returned 3 company-related URLs. |
| 9 | Astellas | 0 | 1 | 1 | Intended-company sample identified; counts are not a completeness measure. |
| 10 | AstraZeneca | 0 | 11 | 9 | Intended-company sample identified; counts are not a completeness measure. |
| 11 | B. Braun | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 12 | Bavarian Nordic | 3 | 2 | 5 | Intended-company sample identified; counts are not a completeness measure. |
| 13 | Baxter International | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 14 | Bayer | 0 | 20* | 19 | Intended-company sample identified; counts are not a completeness measure. |
| 15 | Becton Dickinson | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 16 | Biogen | 0 | 13 | 13 | Intended-company sample identified; counts are not a completeness measure. |
| 17 | BioPorto | 1 | 2 | 3 | Intended-company sample identified; counts are not a completeness measure. |
| 18 | Boehringer Ingelheim | 0 | 1 | 1 | Intended-company sample identified; counts are not a completeness measure. |
| 19 | Boston Scientific | 0 | 8 | 7 | Intended-company sample identified; counts are not a completeness measure. |
| 20 | Bristol Myers Squibb | 0 | 19 | 18 | Intended-company sample identified; counts are not a completeness measure. |
| 21 | Coloplast | 1 | 0 | 1 | Recent DA story found; older EN window added 3 company-related URLs. |
| 22 | CSL | 0 | 9 | 8 | Mixed identities: 2 reviewed CSL Ltd finance records; other CSL entities/acronyms dominate. |
| 23 | Daiichi Sankyo | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 24 | Danaher | 0 | 5 | 5 | Intended-company sample identified; counts are not a completeness measure. |
| 25 | Demant | 6 | 2 | 8 | Intended-company sample identified; counts are not a completeness measure. |
| 26 | Eisai | 0 | 3 | 2 | Intended-company sample identified; counts are not a completeness measure. |
| 27 | Eli Lilly | 0 | 20* | 20 | Intended-company sample identified; counts are not a completeness measure. |
| 28 | EssilorLuxottica | 0 | 19 | 19 | Intended-company sample identified; counts are not a completeness measure. |
| 29 | Evotec | 0 | 3 | 1 | Biotech company result confirmed; the context filter also rejected a clearly relevant IND/partner headline. |
| 30 | Ferring Pharmaceuticals | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 31 | Ferrosan Medical Devices | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 32 | Fresenius | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 33 | GE HealthCare | 0 | 2 | 2 | Intended-company sample identified; counts are not a completeness measure. |
| 34 | Genmab | 2 | 3 | 5 | Intended-company sample identified; counts are not a completeness measure. |
| 35 | Gilead Sciences | 0 | 6 | 5 | Intended-company sample identified; counts are not a completeness measure. |
| 36 | GN Store Nord | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 37 | GSK | 0 | 18 | 16 | Intended-company sample identified; counts are not a completeness measure. |
| 38 | H. Lundbeck | 0 | 1 | 1 | Intended-company sample identified; counts are not a completeness measure. |
| 39 | Haleon | 0 | 2 | 2 | Intended-company sample identified; counts are not a completeness measure. |
| 40 | Intuitive Surgical | 0 | 1 | 1 | Intended-company sample identified; counts are not a completeness measure. |
| 41 | Johnson & Johnson | 0 | 16 | 14 | Intended-company sample identified; counts are not a completeness measure. |
| 42 | LEO Pharma | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 43 | Medtronic | 0 | 16 | 15 | Intended-company sample identified; counts are not a completeness measure. |
| 44 | Merck & Co | 0 | 6 | 6 | Intended-company sample identified; counts are not a completeness measure. |
| 45 | Mindray | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 46 | Moderna | 0 | 10 | 9 | Intended-company sample identified; counts are not a completeness measure. |
| 47 | Nordic Bioscience | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 48 | Novartis | 1 | E; 20 recovered | 1 | Initial EN request hit 429; exact-query refinement returned 20 records. |
| 49 | Novo Nordisk | 2 | E; 20 broader | 2 | Initial EN response failed validation; broader name/alias refinement returned 20 records. |
| 50 | Novonesis | 1 | 1 | 2 | Intended-company sample identified; counts are not a completeness measure. |
| 51 | Olympus | 0 | 20* | 20 | All 20 baseline records reviewed were off-topic. Page 2 returned a company job advert, not news. |
| 52 | Organon | 0 | 3 | 3 | Intended-company sample identified; counts are not a completeness measure. |
| 53 | Otsuka | 0 | 1 | 0 | Health-policy hit; intended-company identity unconfirmed in the preview. |
| 54 | Pfizer | 0 | 19 | 16 | Intended-company sample identified; counts are not a completeness measure. |
| 55 | Philips | 0 | 20* | 20 | Medical releases and corporate finance are mixed with consumer deals and unrelated identities. |
| 56 | Radiometer | 0 | 2 | 1 | Instrument/astronomy uses; no healthcare-company news verified. |
| 57 | Regeneron | 0 | 18 | 17 | Intended-company sample identified; counts are not a completeness measure. |
| 58 | Roche | 0 | 20* | 17 | Intended-company sample identified; counts are not a completeness measure. |
| 59 | Sanofi | 0 | 20* | 20 | Intended-company sample identified; counts are not a completeness measure. |
| 60 | Siemens Healthineers | 0 | 3 | 3 | Intended-company sample identified; counts are not a completeness measure. |
| 61 | Solventum | 0 | 2 | 2 | Intended-company sample identified; counts are not a completeness measure. |
| 62 | Straumann | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 63 | Stryker | 0 | 6 | 5 | Intended-company sample identified; counts are not a completeness measure. |
| 64 | Takeda | 0 | 3 | 2 | Intended-company sample identified; counts are not a completeness measure. |
| 65 | Thermo Fisher Scientific | 0 | 1 | 1 | Intended-company sample identified; counts are not a completeness measure. |
| 66 | UCB | 0 | 1 | 0 | Mathematics acronym; no pharmaceutical-company result verified. |
| 67 | Union Therapeutics | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 68 | Vertex Pharmaceuticals | 0 | 10 | 10 | Intended-company sample identified; counts are not a completeness measure. |
| 69 | Viatris | 0 | 5 | 5 | Intended-company sample identified; counts are not a completeness measure. |
| 70 | Xellia Pharmaceuticals | 0 | 0 | 0 | No result in this seven-day window; absence of news is not established. |
| 71 | Zealand Pharma | 0 | 1 | 1 | Intended-company sample identified; counts are not a completeness measure. |
| 72 | Zimmer Biomet | 0 | 6 | 6 | Intended-company sample identified; counts are not a completeness measure. |

The 16 companies without recent-window hits were Ambu, Ascendis Pharma, B. Braun, Baxter International, Becton Dickinson, Daiichi Sankyo, Ferring Pharmaceuticals, Ferrosan Medical Devices, Fresenius, GN Store Nord, LEO Pharma, Mindray, Nordic Bioscience, Straumann, Union Therapeutics and Xellia Pharmaceuticals. Ambu subsequently returned seven older Danish URLs, Ascendis three older English URLs, and Coloplast three older English URLs. Some Ambu records are revised titles/URLs of the same underlying event, so seven URLs must not be presented as seven independent announcements.

Alias expansion did not produce new results for the tested ALK, Ascendis, Ferring and Ferrosan searches. It did not establish that those publishers or companies are absent from Currents' complete index.

## Priority publishers

Each publisher was tested twice, once per language, using a quoted OR query over the 22 companies marked Danish-linked in the database and the baseline seven-day window. This is a Danish-interest probe, not a complete scan of each publisher. The configured Danish-linked flag includes Evotec; it is not a claim about legal domicile.

| Publisher domain | Danish records | English records | Finding |
|---|---:|---:|---|
| medwatch.dk | 0 | 0 | No result observed; availability unconfirmed |
| dagensmedicin.dk | 0 | 0 | No result observed; availability unconfirmed |
| borsen.dk | 11 | 0 | Observed in these probes |
| fiercepharma.com | 0 | 0 | No result observed; availability unconfirmed |
| globenewswire.com | 3 | 8 | Observed in these probes |

**No coverage was observed from medwatch.dk, dagensmedicin.dk or fiercepharma.com in these probes.** This does not prove those domains are entirely unindexed. Ask Currents to demonstrate current coverage from those precise domains and relevant Danish company queries before purchasing a plan to solve that requirement. Børsen and GlobeNewswire supplied useful records. Their metadata being available through Currents does not establish full-text access or a republication licence for the original article.

## Relevance and identity review

A 100-record metadata sample was manually reviewed. Selection was deliberate: one candidate per nonempty company/language response, choosing the first name-matched record when available, then 39 additional ambiguous-name cases. The sample is enriched for difficult identities and is **not a random precision estimate**.

| Review finding | Records |
|---|---:|
| Intended company relation appears valid | 59 |
| Off-topic for the healthcare brief or wrong entity | 40 |
| Company identity unconfirmed from the preview | 1 |

The 59 include clinical, device, corporate and financial reporting. They are not all high-value editorial stories. Thirty-seven of the 40 off-topic/wrong-entity samples still passed the current name matcher. This exposes additional rules needed before broad ingestion; it does not invalidate the earlier fix for the specific Bayer/Abbott/B. Braun/Evotec/Baxter/Gilead cases.

Examples:
- Olympus: all 20 first-page records reviewed concerned films, mythology, coffee, computing or camera history. Its extra page returned a company job advertisement rather than a news item.
- CSL: CSL Ltd finance records were mixed with shipping, a communications company, football supporters and citation-software acronyms.
- Philips: genuine medical imaging/ultrasound releases appeared among consumer deals, lighting, televisions and unrelated personal names.
- Radiometer: astronomy/instrument uses were returned without a verified healthcare-company story.
- Alcon and UCB: entertainment and mathematics uses respectively.
- Otsuka: a health-policy article was returned, but the company identity could not be established from its preview.

A separate targeted check found a potential false negative: a genuine Evotec/Bristol Myers IND/partner headline lacked the current support words and was rejected by our context rule, while its fuller press-release version matched. This needs vocabulary refinement, not more API quota.

## Pagination and duplication

Seven baseline searches reached the 20-record cap. Ten second-page tests were run: those seven plus the three next-largest responses.

| Company (English) | Page 1 | Page 2 | URLs absent from its first page | URLs overlapping its first page |
|---|---:|---:|---:|---:|
| EssilorLuxottica | 19 | 0 | 0 | 0 |
| Pfizer | 19 | 0 | 0 | 0 |
| Eli Lilly | 20 | 20 | 20 | 0 |
| Roche | 20 | 3 | 1 | 2 |
| Sanofi | 20 | 20 | 18 | 2 |
| Bristol Myers Squibb | 19 | 1 | 0 | 1 |
| Bayer | 20 | 20 | 20 | 0 |
| Philips | 20 | 4 | 4 | 0 |
| Olympus | 20 | 1 | 1 | 0 |
| Abbott | 20 | 20 | 20 | 0 |
| **Total** | | **89** | **84** | **5** |

The 84 are additional URLs relative to each corresponding first page, not necessarily additional globally unique or relevant stories. Abbott's extra page was politics/entertainment noise; Olympus added a job posting. Bigger result sets improve retrieval depth but do not solve identity or relevance.

Repeat searches were run about **93.5–93.8 minutes after their baseline counterparts**, using the same five pilot companies and two languages with a refreshed rolling window.

| Company | Language | Baseline records | Repeat records | Existing canonical URLs | Additional URLs |
|---|---|---:|---:|---:|---:|
| Coloplast | en | 0 | 0 | 0 | 0 |
| Coloplast | da | 1 | 1 | 1 | 0 |
| Ambu | en | 0 | 0 | 0 | 0 |
| Bavarian Nordic | da | 3 | 3 | 3 | 0 |
| Demant | en | 2 | 3 | 2 | 1 |
| ALK-Abelló | da | 0 | 0 | 0 | 0 |
| Ambu | da | 0 | 0 | 0 | 0 |
| ALK-Abelló | en | 1 | 1 | 1 | 0 |
| Demant | da | 6 | 6 | 6 | 0 |
| Bavarian Nordic | en | 2 | 2 | 2 | 0 |

The repeats returned 16 records: 15 existing canonical URLs and one additional URL. Canonical URL deduplication would suppress those 15 repeats. Different URLs for revised headlines or syndicated versions still require additional handling; the older Ambu results demonstrate this risk.

The additional Demant-query URL carried a publication timestamp of 13:28 UTC, before the baseline poll. Thus this run does not demonstrate minute-level publication-to-index freshness. It could reflect indexing, article updates or changing query results. A longer observation with independently timestamped newly published items is needed to measure that latency.

The evaluation compared results without inserting the 622 test records into the news archive. It did not exercise a second full production ingestion of every test article.

## Source links, descriptions and dates

Of the 442 baseline records, 440 had nonempty descriptions, 66 had fewer than 80 characters, and the longest description was 303 characters. These are previews, not full articles. Language labels matched the requested language, and all API-reported dates fell within the requested window. Neither check establishes that the date is the publisher's original publication time.

Twelve article URLs were fetched with the collector's identification. Seven responded with HTTP 200, four blocked automated access with HTTP 403, and one failed at the HTTP/2 transport layer even after an unrestricted retry. No 404 was observed. These checks establish response behaviour, not universal reader access or full-text availability.

| Host | Result | Interpretation |
|---|---:|---|
| www.prnewswire.com | 200 | URL responded; full-text access not established |
| seekingalpha.com | 200 | URL responded; full-text access not established |
| www.medtechdive.com | 200 | URL responded; full-text access not established |
| www.benzinga.com | 403 | Automated access blocked; not proof of a broken reader link |
| www.nasdaq.com | Transport error | Still unverified after an unrestricted retry (HTTP/2 stream error) |
| www.globenewswire.com | 403 | Automated access blocked; not proof of a broken reader link |
| www.investing.com | 403 | Automated access blocked; not proof of a broken reader link |
| borsen.dk | 200 | URL responded; full-text access not established |
| www.hpcwire.com | 200 | URL responded; full-text access not established |
| www.business-standard.com | 403 | Automated access blocked; not proof of a broken reader link |
| alvinbunk.wordpress.com | 200 | URL responded; full-text access not established |
| www.statnews.com | 200 | URL responded; full-text access not established |

A verified date discrepancy matters for freshness: [Nespresso Project Olympus](https://alvinbunk.wordpress.com/2026/11/01/nespresso-project-olympus/) had publisher metadata dated **1 November 17:03 UTC**, modified **22 November 16:22 UTC**, while Currents supplied **22 November 23:57 UTC** as its published value. Preserve API observation and publisher publication dates separately when available; do not label every returned record as newly published news.

## Checks against known announcements

| Known item | Independent source | Retrieval finding |
|---|---|---|
| Bavarian Nordic buyback transactions, 23 November | [Official announcement](https://www.bavarian-nordic.com/investor/news/news.aspx?news=7653) | Related original GlobeNewswire releases retrieved in both languages. |
| BioPorto third-quarter results, 19 November | [Official announcement list](https://bioporto.com/investor-relations/announcements/) | Both Danish and English GlobeNewswire releases retrieved, plus an English presentation. |
| Ambu buyback transactions, 23 November | [Official investor page](https://www.ambu.com/corporate-info/investors/investors) | Not retrieved in the recent-window baseline or repeats. Older annual-results coverage exists, so the company is not wholly absent. |
| Demant Capital Markets Day, 24 November | [Official company page](https://www.demant.com/) | Related Danish and English company/market coverage retrieved; exact primary-release completeness was not established. |

Ambu's 17 November clinical release fell earlier than the rolling baseline start time on that date, so it is not counted as a demonstrated baseline miss.

## Subscription recommendation

**Keep Currents as a supplement. Do not upgrade solely to repair the unproven Danish specialist coverage.** It adds useful English company reporting and selected Danish results, but a larger allowance does not establish access to MedWatch, Dagens Medicin or FiercePharma for your use case.

The [published pricing](https://currentsapi.services/en/product/price) lists a continuing 250/day Free plan and a Builder plan from $69/month with 2,500 requests/day, up to 50 results/request and deeper history. Account-specific trial expiry has not been independently verified. Ask the provider what changes tomorrow and whether a paid plan changes source availability, rather than only quotas, result caps and available content fields.

| Cadence for 72 companies, two languages, one page | Requests/day before retries or pagination |
|---|---:|
| Once daily | 144 |
| Twice daily | 288 |
| Three times daily | 432 |

The Free allowance fits one daily pass with headroom; higher cadence needs more quota. Builder is sufficient in quota terms for twice/three-times daily passes, but its value depends on the required publisher coverage and editorial usefulness.

Before committing:
1. Obtain provider demonstrations for the three unobserved priority domains and Danish company queries.
2. Retain direct company announcements, RSS and specialist sources for recall; Ambu shows a current announcement can be missed.
3. Add ambiguity rules for Olympus, CSL, Philips, Radiometer and UCB, and refine support vocabulary for legitimate Evotec headlines.
4. Test a news-only/type filter, healthcare context and selected publisher filters. These additional filtering choices were not included in the 190-request budget.
5. Preserve separate publication/updated/observed dates where available and keep URL deduplication, with additional handling for revised-title and syndicated duplicates.
6. Reassess after a day or two of timestamped known-item checks. This single study does not establish a long-term freshness or uptime guarantee.

GDELT was not evaluated in this Currents-specific request budget.

## Reproducibility and application state

The audit is stored in the team-protected evaluation log with study ID `d9ca878a-8dff-4503-97e3-b28d075c6599`. The tools remain manual; the existing ingestion schedule does not run these tests. Requests are claimed once, daily quota claims are atomic, credentials stay server-side, redirects carrying credentials are refused, and account-limit failures pause execution.

Implementation commits: bbe38e0 (audited evaluator), 3e8ce7e (pacing/quota metadata), 4ff3d9f (per-record validation). Migration 0009 enabled the temporary limit and evaluation tables; 0010 added provider-response metadata. Final verification: 127 tests passed, seven optional network tests skipped; TypeScript, focused lint and production builds passed during implementation.


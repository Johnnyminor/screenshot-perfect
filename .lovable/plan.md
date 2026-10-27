# Lex Nyhedsmonitor – build plan (MVP v1)

Internal TweetDeck-style dashboard for Lex.dk editors covering medtech/pharma companies. Pipeline: ingest -> triage -> display -> act. Danish UI labels; English code, tables, comments. RSS only, no scraping, no LLM in v1.

## 1. Database schema (Lovable Cloud / Postgres)

```text
profiles            id (=auth user id, PK), display_name, created_at
companies           id PK, name, aliases text[], cvr text null, country, sector ('medtech'|'pharma'|'other'),
                    google_news_enabled bool, active bool, created_at
topics              id PK, name, keywords text[], active bool        (non-company columns, e.g. "EMA-godkendelser")
feeds               id PK, name, url UNIQUE, publisher, kind ('static'|'google_news'),
                    company_id FK null (set for generated Google News feeds),
                    source_weight numeric (0-1), active bool,
                    last_polled_at, last_success_at, last_error, consecutive_failures int, etag, last_modified
items               id PK, headline, summary (feed-provided only), canonical_url UNIQUE,
                    publisher, feed_id FK (first seen), published_at timestamptz (from feed),
                    ingested_at, url_hash, is_opinion bool default false
item_sources        item_id FK, feed_id FK, seen_at  PK(item_id, feed_id)   (which feeds carried the story)
item_matches        item_id FK, company_id FK null, topic_id FK null, matched_terms text[],
                    relevance_score numeric   (one row per entity match = "entity match" + "relevance score")
editor_columns      id PK, user_id FK, company_id | topic_id, position int, sort ('time'|'relevance'),
                    hide_opinion bool default true, min_score numeric
item_actions        id PK, item_id FK, user_id FK, status ('new'|'read'|'used'|'dismissed'),
                    note text, article_ref text (Lex article URL), updated_at   UNIQUE(item_id,user_id)
ingest_runs         id PK, started_at, finished_at, feeds_ok, feeds_failed, items_new, log jsonb
```

The five required fields map to: headline, publisher + canonical_url, published_at, item_matches.company_id/topic_id, item_matches.relevance_score.

Relevance score (v1): `source_weight * 0.5 + match_strength * 0.4 + recency bonus`, where match_strength is higher for exact name in headline than alias in summary. Kept in one function so it can be re-tuned and recomputed.

RLS: every table has RLS on. Any signed-in user can read companies, topics, feeds, items, matches (shared team pool). Editors can only read/write their own `editor_columns` and `item_actions`. Managing companies/feeds/flagging opinion: all signed-in editors in v1 (or an `admin` role via a separate `user_roles` table if you want restriction – see questions). Ingestion writes with the server-side service key only. Signup closed; accounts created by invite.

## 2. Ingestion design

Note: this project's stack runs scheduled backend jobs as a protected server endpoint triggered by a database cron (pg_cron + pg_net) rather than a Supabase Edge Function. Same behaviour, same database.

- Cron every 15 min calls `/api/public/ingest` with a shared secret header; endpoint rejects anything else.
- Per run: load active feeds (static + one generated Google News URL per company with google_news_enabled, synced into `feeds` when a company is saved). Poll in small parallel batches with a 10s timeout, sending ETag/If-Modified-Since.
- Parse RSS/Atom with a worker-compatible XML parser. Take headline, link, pubDate, description only.
- Canonicalise URL: strip utm_*/tracking params, fragments, trailing slashes, lowercase host; for Google News links use the publisher link from the item source element where present (no following redirects to scrape). Upsert on `canonical_url`; if exists, just add an `item_sources` row.
- Fallback dedup: same normalised headline within 48h treated as duplicate.
- Missing pubDate -> use ingestion time and mark `published_at_estimated`.
- Matching: case-insensitive word-boundary match of company name/aliases and topic keywords against headline + summary; write `item_matches` with score.
- Errors: per-feed try/catch, store `last_error`, increment `consecutive_failures`; after 5 failures feed shows as broken in the admin page (not auto-disabled). Each run logged in `ingest_runs`. Items older than 30 days on first poll are skipped to avoid backfill floods.

## 3. Frontend

Routes (Danish labels):
- `/login` – Log ind (email/password).
- `/` Dashboard – horizontally scrolling columns, one per `editor_columns` row. Column header: name, sort toggle (Tid / Relevans), filter (skjul holdning/kommentar), unread count. Cards: headline (link out), publisher, timestamp, score badge, matched terms, actions: Læst, Brugt i artikel (+ Lex article link/note), Afvis, Markér som holdning.
- `/kolonner` – Mine kolonner: add/remove/reorder company or topic columns.
- `/virksomheder` – Virksomheder: CRUD name, aliases, CVR, Google News toggle.
- `/kilder` – Kilder: feeds list, weights, active toggle, health status, last error, "Kør nu" button.
- `/emner` – Emner: topic keywords.

Components: DashboardColumn, ItemCard, ItemActionMenu, ColumnConfigurator, CompanyForm, FeedHealthTable. Data via TanStack Query with polling refresh every 60s.

## 4. Phased build order

1. **Shell + seeded data**: schema, RLS, seed migration with your full list (22 Danish + 50 global companies, with tickers, country, sector, aliases e.g. Lundbeck, ALK, Oticon, GN), the 5 static feeds, and ~60 fake items with matches. Login + dashboard reading seed data. *Test: log in, see columns, sort by time/relevance.*
2. **Editor actions + column config**: Mine kolonner, personal item status, opinion flag, hide-opinion filter, "Kopiér kildehenvisning" (source, title, URL, date). *Test: two editors with different columns and separate read state.*
3. **Admin pages**: Virksomheder, Kilder, Emner; Google News feed auto-generation per company; "Hent CVR" action that looks up Danish companies by name via cvrapi.dk and shows the result for confirmation before saving (never guessed). *Test: add a company, see its feed row appear; fetch CVR for Coloplast.*
4. **Real ingestion (manual)**: ingest endpoint + "Kør nu" button, dedup, matching, scoring, run log. Unmatched items kept with score 0. *Test: run once, verify no duplicates across EMA/FiercePharma/Google News.*
5. **Scheduling + hardening**: 15-min cron, per-feed jitter, ETag/Last-Modified, feed health. *Test: leave running a day, review run log and broken feeds.*
6. **Arkiv + tuning**: searchable archive of all items incl. unmatched, sorted by frequency of recurring unknown names (coverage-gap signal); tune weights; remove seed items.

## 5. Decisions (from your answers)

- All signed-in editors can edit companies, feeds, topics. No admin role in v1.
- Read/used/dismissed status is personal: `item_actions` keyed on (user_id, item_id).
- Companies seeded from your list into the `companies` table; CVR filled via cvrapi.dk lookup, not by hand.
- Unmatched items kept forever (score 0), hidden from columns, visible in Arkiv.
- Act step: "Brugt i artikel" + Lex.dk link, plus copy-citation button.
- Polling: every 15 min, staggered with jitter, conditional requests (~75 feeds).

## 6. Remaining risks

- Lægemiddelstyrelsen URL is http and may have moved; FDA/GlobeNewswire sometimes block non-browser clients. Checked in phase 4; broken feeds shown, not silent.
- Google News links are redirect URLs; publisher canonical URL not always recoverable without following redirects, weakening dedup.
- Short aliases ("GN", "ALK", "UCB", "Abbott", "Bayer") will cause false positives; plan supports per-company exclusion keywords and case-sensitive matching for acronyms.
- cvrapi.dk has rate limits and may return several hits per name; hence the confirm step. CVR cannot be set in the seed migration itself.
- Radiometer/Danaher overlap: Danaher news will also be tagged; acceptable and noted.

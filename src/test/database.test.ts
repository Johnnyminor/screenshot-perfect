// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const member = "11111111-1111-4111-8111-111111111111";
const outsider = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
async function asUser(id: string) {
  await db.exec(
    `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',true);`,
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;`);
  for (const file of [
    "0000_migration.sql",
    "0001_collection_reliability.sql",
    "0002_team_access.sql",
    "0003_dashboard_queries.sql",
    "0004_explicit_membership_policies.sql",
    "0005_provider_recovery.sql",
    "0006_company_rss.sql",
    "0007_currents_pilot.sql",
    "0008_company_disambiguation.sql",
    "0009_currents_evaluation.sql",
    "0010_evaluation_rate_metadata.sql",
    "0011_direct_announcements.sql",
    "0012_company_coverage.sql",
    "0013_company_updates.sql",
    "0014_editorial_reference_defaults.sql",
    "0015_priority_company_announcements.sql",
    "0016_distinct_announcement_ids.sql",
    "0017_shared_currents_accounting.sql",
    "0018_incremental_matching.sql",
    "0019_resumable_collection.sql",
    "0020_bounded_dashboard.sql",
  ]) {
    await db.exec(
      await readFile(new URL(`../../drizzle/migrations/${file}`, import.meta.url), "utf8"),
    );
  }
  await db.query(
    "INSERT INTO auth.users(id,email) VALUES ($1,'editor@example.com'),($2,'outsider@example.com')",
    [member, outsider],
  );
  await db.query("INSERT INTO public.app_members(user_id) VALUES ($1)", [member]);
}, 60_000);
beforeEach(async () => {
  await db.exec("BEGIN");
});
afterEach(async () => {
  await db.exec("ROLLBACK");
});
afterAll(async () => {
  await db?.close();
});

describe("database migrations and source lifecycle", () => {
  it("keeps recurring announcements with different identifiers distinct and deduplicates replay", async () => {
    const feed = (
      await db.query<{ id: string }>("SELECT id FROM feeds WHERE connector='announcements' LIMIT 1")
    ).rows[0]!.id;
    const item = {
      headline: "Transactions under share buyback program",
      headline_norm: "transactions under share buyback program",
      publisher: "Company",
      summary: "Announcement",
      published_at: new Date().toISOString(),
      published_at_estimated: false,
      canonical_url: "https://example.com/announcement?ID=1",
    };
    const first = (
      await db.query<{ result: { id: string; created: boolean } }>(
        "SELECT store_collected_item($1::jsonb,NULL,'[]'::jsonb,$2,false) AS result",
        [JSON.stringify(item), feed],
      )
    ).rows[0]!.result;
    const second = (
      await db.query<{ result: { id: string; created: boolean } }>(
        "SELECT store_collected_item($1::jsonb,NULL,'[]'::jsonb,$2,false) AS result",
        [
          JSON.stringify({
            ...item,
            canonical_url: "https://example.com/announcement?ID=2",
            published_at: new Date(Date.now() - 7 * 864e5).toISOString(),
          }),
          feed,
        ],
      )
    ).rows[0]!.result;
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.id).not.toBe(first.id);
    const replay = (
      await db.query<{ result: { id: string; created: boolean } }>(
        "SELECT store_collected_item($1::jsonb,NULL,'[]'::jsonb,$2,false) AS result",
        [JSON.stringify(item), feed],
      )
    ).rows[0]!.result;
    expect(replay).toEqual({ id: first.id, created: false });
  });
  it("preserves references and notes through read, unread and rejection, including legacy null upserts", async () => {
    const item = (await db.query<{ id: string }>("SELECT id FROM items LIMIT 1")).rows[0]!.id;
    await asUser(member);
    await db.query(
      "INSERT INTO item_actions(item_id,user_id,status,article_ref,note) VALUES($1,$2,'used','https://lex.dk/Bavarian_Nordic','Editorial context')",
      [item, member],
    );
    for (const status of ["read", "new", "dismissed"]) {
      await db.query(
        `INSERT INTO item_actions(item_id,user_id,status,article_ref,note) VALUES($1,$2,$3,NULL,NULL)
        ON CONFLICT(item_id,user_id) DO UPDATE SET status=excluded.status,article_ref=excluded.article_ref,note=excluded.note`,
        [item, member, status],
      );
      const action = (
        await db.query<{ status: string; article_ref: string; note: string }>(
          "SELECT status,article_ref,note FROM item_actions WHERE item_id=$1",
          [item],
        )
      ).rows[0]!;
      expect(action).toEqual({
        status,
        article_ref: "https://lex.dk/Bavarian_Nordic",
        note: "Editorial context",
      });
    }
    await db.query(
      "UPDATE item_actions SET article_ref='https://lex.dk/vaccine' WHERE item_id=$1",
      [item],
    );
    expect(
      (
        await db.query<{ article_ref: string }>(
          "SELECT article_ref FROM item_actions WHERE item_id=$1",
          [item],
        )
      ).rows[0]!.article_ref,
    ).toBe("https://lex.dk/vaccine");
  });
  it("defaults new companies to Google News disabled without affecting existing feed rows", async () => {
    const before = (
      await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM feeds WHERE kind='google_news'",
      )
    ).rows[0]!.count;
    const company = (
      await db.query<{ id: string; google_news_enabled: boolean }>(
        "INSERT INTO companies(name) VALUES('New coverage company') RETURNING id,google_news_enabled",
      )
    ).rows[0]!;
    expect(company.google_news_enabled).toBe(false);
    expect((await db.query("SELECT id FROM feeds WHERE company_id=$1", [company.id])).rows).toEqual(
      [],
    );
    expect(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM feeds WHERE kind='google_news'",
        )
      ).rows[0]!.count,
    ).toBe(before);
    await db.query("UPDATE companies SET google_news_enabled=true WHERE id=$1", [company.id]);
    expect(
      (await db.query("SELECT id FROM feeds WHERE company_id=$1 AND active", [company.id])).rows,
    ).toHaveLength(1);
  });
  it("summarizes all company updates under membership RLS and excludes demo stories", async () => {
    await asUser(member);
    const result = (
      await db.query<{ updates: { company_id: string; stories: number; latest: string | null }[] }>(
        "SELECT dashboard_company_updates(NULL,NULL,false) AS updates",
      )
    ).rows[0]!.updates;
    expect(result).toHaveLength(72);
    expect(result.every((row) => row.stories === 0 && row.latest === null)).toBe(true);
    await asUser(outsider);
    expect(
      (
        await db.query<{ updates: unknown[] }>(
          "SELECT dashboard_company_updates(NULL,NULL,false) AS updates",
        )
      ).rows[0]!.updates,
    ).toEqual([]);
  });
  it("matches date, source, opinion and dismissal filters without losing zero-story companies", async () => {
    const company = (
      await db.query<{ id: string }>("SELECT id FROM companies WHERE name='Bavarian Nordic'")
    ).rows[0]!.id;
    const feed = (
      await db.query<{ id: string }>("SELECT id FROM feeds WHERE connector='announcements'")
    ).rows[0]!.id;
    const ids = [];
    for (let n = 0; n < 3; n++) {
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO items(headline,canonical_url,publisher,published_at,is_opinion)
        VALUES('Company announcement',$1,'Company',now()-$2::interval,$3) RETURNING id`,
          [`https://example.com/company-update-${n}`, n === 2 ? "40 days" : "1 day", n === 1],
        )
      ).rows[0]!.id;
      ids.push(id);
      await db.query("INSERT INTO item_matches(item_id,company_id) VALUES($1,$2)", [id, company]);
      if (n !== 2)
        await db.query("INSERT INTO item_sources(item_id,feed_id) VALUES($1,$2)", [id, feed]);
    }
    await asUser(member);
    const count = async (since: string | null, source: string | null, hide: boolean) => {
      const rows = (
        await db.query<{ updates: { company_id: string; stories: number }[] }>(
          "SELECT dashboard_company_updates($1,$2,$3) AS updates",
          [since, source, hide],
        )
      ).rows[0]!.updates;
      expect(rows).toHaveLength(72);
      return rows.find((row) => row.company_id === company)!.stories;
    };
    expect(await count(null, null, false)).toBe(3);
    expect(await count(new Date(Date.now() - 7 * 864e5).toISOString(), null, false)).toBe(2);
    expect(await count(null, feed, false)).toBe(2);
    expect(await count(null, feed, true)).toBe(1);
    await db.query("INSERT INTO item_actions(item_id,user_id,status) VALUES($1,$2,'dismissed')", [
      ids[0],
      member,
    ]);
    expect(await count(null, feed, true)).toBe(0);
  });
  it("reports all active companies to members without leaking coverage to outsiders", async () => {
    await asUser(member);
    const result = (
      await db.query<{ coverage: { name: string; stories_7d: number }[] }>(
        "SELECT company_coverage() AS coverage",
      )
    ).rows[0]!.coverage;
    expect(result).toHaveLength(72);
    // Existing demo/seed stories must never count as real coverage.
    expect(result.every((row) => row.stories_7d === 0)).toBe(true);
    await asUser(outsider);
    expect(
      (await db.query<{ coverage: unknown[] }>("SELECT company_coverage() AS coverage")).rows[0]!
        .coverage,
    ).toEqual([]);
  });
  it("seeds ten paused Currents searches for five existing companies", async () => {
    const result = await db.query<{ company_id: string; active: boolean }>(
      "SELECT company_id,active FROM feeds WHERE connector='currents'",
    );
    expect(result.rows).toHaveLength(10);
    expect(new Set(result.rows.map((row) => row.company_id)).size).toBe(5);
    expect(result.rows.every((row) => !row.active)).toBe(true);
  });
  it("atomically caps pilot claims at the current UTC-day allowance", async () => {
    const limit = (await db.query<{ limit: number }>("SELECT currents_request_limit() AS limit"))
      .rows[0]!.limit;
    expect(limit).toBe(new Date().toISOString().slice(0, 10) === "2026-11-24" ? 200 : 40);
    for (let i = 0; i < limit; i++)
      expect(
        (await db.query<{ allowed: boolean }>("SELECT claim_currents_request() AS allowed")).rows[0]
          ?.allowed,
      ).toBe(true);
    expect(
      (await db.query<{ allowed: boolean }>("SELECT claim_currents_request() AS allowed")).rows[0]
        ?.allowed,
    ).toBe(false);
    expect(
      (await db.query<{ requests: number }>("SELECT requests FROM currents_daily_usage")).rows[0]
        ?.requests,
    ).toBe(limit);
  });
  it("claims an evaluation request once and counts its quota atomically", async () => {
    const row = (
      await db.query<{
        id: string;
      }>(`INSERT INTO currents_evaluation_requests(study_id,phase,ordinal,params)
      VALUES('11111111-1111-4111-8111-111111111111','base',1,'{}') RETURNING id`)
    ).rows[0]!;
    expect(
      (
        await db.query<{ result: { outcome: string } }>(
          "SELECT claim_currents_evaluation($1) AS result",
          [row.id],
        )
      ).rows[0]?.result.outcome,
    ).toBe("claimed");
    expect(
      (
        await db.query<{ result: { outcome: string } }>(
          "SELECT claim_currents_evaluation($1) AS result",
          [row.id],
        )
      ).rows[0]?.result.outcome,
    ).toBe("done");
    expect(
      (await db.query<{ requests: number }>("SELECT requests FROM currents_daily_usage")).rows[0]
        ?.requests,
    ).toBe(1);
  });
  it("does not claim or run a pending evaluation when quota is exhausted", async () => {
    await db.exec(
      `INSERT INTO currents_daily_usage(day,requests) VALUES((now() AT TIME ZONE 'UTC')::date,currents_request_limit())`,
    );
    const row = (
      await db.query<{
        id: string;
      }>(`INSERT INTO currents_evaluation_requests(study_id,phase,ordinal,params)
      VALUES('11111111-1111-4111-8111-111111111111','base',1,'{}') RETURNING id`)
    ).rows[0]!;
    expect(
      (
        await db.query<{ result: { outcome: string } }>(
          "SELECT claim_currents_evaluation($1) AS result",
          [row.id],
        )
      ).rows[0]?.result.outcome,
    ).toBe("quota");
    expect(
      (await db.query<{ status: string }>("SELECT status FROM currents_evaluation_requests"))
        .rows[0]?.status,
    ).toBe("pending");
  });
  it("keeps evaluation execution and result writes service-only", async () => {
    await asUser(member);
    await expect(
      db.exec("SELECT claim_currents_evaluation('11111111-1111-4111-8111-111111111111')"),
    ).rejects.toThrow("permission denied");
  });
  it("prevents a member from resetting or claiming the provider budget", async () => {
    await asUser(member);
    await expect(db.exec("SELECT claim_currents_request()")).rejects.toThrow("permission denied");
  });
  it("adds four hourly first-party feeds linked to existing companies without duplicates", async () => {
    const query = `SELECT c.name,f.poll_interval_minutes,f.kind,f.active
      FROM feeds f JOIN companies c ON c.id=f.company_id WHERE f.kind='static'`;
    const before = await db.query<{
      name: string;
      poll_interval_minutes: number;
      kind: string;
      active: boolean;
    }>(query);
    const names = [
      "Nordic Bioscience",
      "Union Therapeutics",
      "BioPorto",
      "Ferrosan Medical Devices",
    ];
    const owned = before.rows.filter((row) => names.includes(row.name));
    expect(owned).toHaveLength(4);
    expect(owned.every((row) => row.poll_interval_minutes === 60 && row.active)).toBe(true);
    await db.exec(
      await readFile(
        new URL("../../drizzle/migrations/0006_company_rss.sql", import.meta.url),
        "utf8",
      ),
    );
    expect((await db.query(query)).rows).toHaveLength(before.rows.length);
  });
  it("keeps a blocked primary source paused until access is confirmed", async () => {
    const result = await db.query<{ active: boolean; last_error: string }>(
      "SELECT active,last_error FROM feeds WHERE name='Genmab selskabsmeddelelser'",
    );
    expect(result.rows[0]?.active).toBe(false);
    expect(result.rows[0]?.last_error).toContain("403");
  });
  it("preserves feed IDs, telemetry and provenance on company edits and pauses", async () => {
    const company = (await db.query<{ id: string }>("SELECT id FROM companies WHERE name='Genmab'"))
      .rows[0]!;
    const before = (
      await db.query<{ id: string }>("SELECT id FROM feeds WHERE company_id=$1", [company.id])
    ).rows[0]!;
    await db.query("UPDATE feeds SET last_success_at=now(),consecutive_failures=2 WHERE id=$1", [
      before.id,
    ]);
    await db.query("UPDATE companies SET aliases=ARRAY['Genmab A/S'],active=false WHERE id=$1", [
      company.id,
    ]);
    const after = (
      await db.query<{
        id: string;
        active: boolean;
        consecutive_failures: number;
        last_success_at: string;
        url: string;
      }>("SELECT * FROM feeds WHERE company_id=$1", [company.id])
    ).rows[0]!;
    expect(after.id).toBe(before.id);
    expect(after.active).toBe(false);
    expect(after.consecutive_failures).toBe(2);
    expect(after.last_success_at).toBeTruthy();
    expect(new URL(after.url).searchParams.get("q")).toContain('"Genmab A/S"');
    await db.query("UPDATE companies SET active=true WHERE id=$1", [company.id]);
    expect(
      (await db.query<{ active: boolean }>("SELECT active FROM feeds WHERE id=$1", [before.id]))
        .rows[0]?.active,
    ).toBe(true);
  });
  it("escapes company names containing ampersands and Unicode", async () => {
    const result = await db.query<{ url: string }>(
      "SELECT url FROM feeds WHERE name='Google News: Johnson & Johnson'",
    );
    expect(new URL(result.rows[0]!.url).searchParams.get("q")).toBe('"J&J" OR "Johnson & Johnson"');
  });
  it("refuses a second collection while a lease is active", async () => {
    await db.query("SELECT begin_collection('ingest','schedule')");
    await expect(db.query("SELECT begin_collection('rematch','manual')")).rejects.toThrow(
      "allerede",
    );
  });
  it("recovers an expired lease", async () => {
    await db.exec("INSERT INTO ingest_runs(started_at) VALUES(now()-interval '21 minutes')");
    await db.query("SELECT begin_collection('ingest','schedule')");
    expect(
      (
        await db.query<{ status: string }>(
          "SELECT status FROM ingest_runs ORDER BY started_at LIMIT 1",
        )
      ).rows[0]?.status,
    ).toBe("abandoned");
  });
  it("rolls back a story and provenance if match persistence fails", async () => {
    const feed = (await db.query<{ id: string }>("SELECT id FROM feeds LIMIT 1")).rows[0]!.id;
    const payload = {
      headline: "Atomic test",
      summary: "Test",
      canonical_url: "https://example.com/atomic",
      publisher: "Example",
      published_at: new Date().toISOString(),
      published_at_estimated: false,
      headline_norm: "atomic test",
    };
    await db.exec("SAVEPOINT write_test");
    await expect(
      db.query("SELECT store_collected_item($1::jsonb,NULL,$2::jsonb,$3,false)", [
        JSON.stringify(payload),
        JSON.stringify([{ company_id: member, matched_terms: ["test"], relevance_score: 0.9 }]),
        feed,
      ]),
    ).rejects.toThrow();
    await db.exec("ROLLBACK TO SAVEPOINT write_test");
    expect(
      (await db.query("SELECT id FROM items WHERE canonical_url='https://example.com/atomic'"))
        .rows,
    ).toHaveLength(0);
  });
  it("records multiple sources without duplicating an existing headline", async () => {
    const feeds = (
      await db.query<{ id: string }>(
        "SELECT id FROM feeds WHERE connector='rss' ORDER BY id LIMIT 2",
      )
    ).rows;
    const payload = {
      headline: "Duplicate test",
      summary: null,
      canonical_url: "https://example.com/one",
      publisher: "Example",
      published_at: new Date().toISOString(),
      published_at_estimated: false,
      headline_norm: "duplicate test",
    };
    const first = (
      await db.query<{ result: { id: string; created: boolean } }>(
        "SELECT store_collected_item($1::jsonb,NULL,'[]'::jsonb,$2,false) AS result",
        [JSON.stringify(payload), feeds[0]!.id],
      )
    ).rows[0]!.result;
    const second = (
      await db.query<{ result: { id: string; created: boolean } }>(
        "SELECT store_collected_item($1::jsonb,NULL,'[]'::jsonb,$2,false) AS result",
        [JSON.stringify({ ...payload, canonical_url: "https://example.com/two" }), feeds[1]!.id],
      )
    ).rows[0]!.result;
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(
      (await db.query("SELECT * FROM item_sources WHERE item_id=$1", [first.id])).rows,
    ).toHaveLength(2);
  });
});

describe("membership and dashboard SQL", () => {
  it("keeps provider cooldowns readable by the team but writable only by the collector", async () => {
    await db.exec(
      "INSERT INTO provider_health(hostname,last_error) VALUES('news.google.com','HTTP 503')",
    );
    await asUser(member);
    expect((await db.query("SELECT hostname FROM provider_health")).rows).toHaveLength(1);
    await expect(db.exec("UPDATE provider_health SET blocked_until=NULL")).rejects.toThrow(
      "permission denied",
    );
  });
  it("does not expose provider diagnostics to an unapproved account", async () => {
    await db.exec(
      "INSERT INTO provider_health(hostname,last_error) VALUES('news.google.com','HTTP 503')",
    );
    await asUser(outsider);
    expect((await db.query("SELECT hostname FROM provider_health")).rows).toEqual([]);
  });
  it("assigns conservative cadence to newly generated Google feeds", async () => {
    await db.exec("INSERT INTO companies(name,google_news_enabled) VALUES('New Company',true)");
    const result = await db.query<{ poll_interval_minutes: number }>(
      "SELECT poll_interval_minutes FROM feeds WHERE name='Google News: New Company'",
    );
    expect(result.rows[0]?.poll_interval_minutes).toBe(180);
  });
  it("has no legacy unconditional allow policy on shared application tables", async () => {
    const result = await db.query<{ tablename: string; policyname: string }>(
      `SELECT tablename,policyname FROM pg_policies WHERE schemaname='public'
       AND tablename IN ('profiles','companies','topics','feeds','items','item_sources','item_matches','ingest_runs')
       AND (qual='true' OR with_check='true')`,
    );
    expect(result.rows).toEqual([]);
  });
  it("does not expose shared data to a self-registered authenticated account", async () => {
    await asUser(outsider);
    expect(
      (await db.query<{ allowed: boolean }>("SELECT is_team_member() AS allowed")).rows[0]?.allowed,
    ).toBe(false);
    expect((await db.query("SELECT id FROM feeds")).rows).toHaveLength(0);
    await expect(db.exec("INSERT INTO companies(name) VALUES('Unauthorized')")).rejects.toThrow();
  });
  it("prevents browser callers from bypassing RLS through service RPCs", async () => {
    await asUser(member);
    await expect(db.query("SELECT begin_collection('ingest','manual')")).rejects.toThrow(
      "permission denied",
    );
  });
  it("orders by relevance across the whole archive, excludes seeds, and paginates", async () => {
    const company = (await db.query<{ id: string }>("SELECT id FROM companies WHERE name='Genmab'"))
      .rows[0]!.id;
    await db.exec(`WITH inserted AS (
      INSERT INTO items(headline,canonical_url,publisher,published_at)
      SELECT 'Ranking '||n,'https://example.com/ranking/'||n,'Example',now()-n*interval '1 hour' FROM generate_series(1,160) n RETURNING id,headline
    ) INSERT INTO item_matches(item_id,company_id,relevance_score)
      SELECT id,'${company}',CASE WHEN headline='Ranking 160' THEN 1 ELSE 0.5 END FROM inserted;`);
    await asUser(member);
    const getPage = async (offset: number) =>
      (
        await db.query<{ items: { headline: string; is_seed: boolean }[] }>(
          "SELECT dashboard_items($1,NULL,'relevance',0,false,NULL,NULL,$2,50) AS items",
          [company, offset],
        )
      ).rows[0]!.items;
    const first = await getPage(0),
      second = await getPage(50);
    expect(first).toHaveLength(50);
    expect(first[0]?.headline).toBe("Ranking 160");
    expect(first.some((item) => item.is_seed)).toBe(false);
    expect(second).toHaveLength(50);
    expect(first.some((item) => second.some((other) => other.headline === item.headline))).toBe(
      false,
    );
  });
  it("enforces membership for dashboard RPCs as well as direct table queries", async () => {
    await asUser(outsider);
    const result = await db.query<{ items: unknown[] }>(
      "SELECT dashboard_items(NULL,(SELECT id FROM topics LIMIT 1),'time',0,false,NULL,NULL,0,50) AS items",
    );
    expect(result.rows[0]?.items).toEqual([]);
  });
});

describe("incremental collection and shared accounting", () => {
  it("starts a new UTC-day allowance without changing yesterday's count", async () => {
    await db.exec(
      "DELETE FROM currents_daily_usage; INSERT INTO currents_daily_usage VALUES ((now() AT TIME ZONE 'UTC')::date-1,40)",
    );
    await db.query("SELECT reserve_currents_request('preview')");
    expect(
      (
        await db.query<{ requests: number }>(
          "SELECT requests FROM currents_daily_usage ORDER BY day",
        )
      ).rows.map((row) => row.requests),
    ).toEqual([40, 1]);
    expect(
      (
        await db.query<{ valid: boolean }>(
          "SELECT day=(now() AT TIME ZONE 'UTC')::date AS valid FROM currents_requests",
        )
      ).rows[0]?.valid,
    ).toBe(true);
  });
  it("shares the allowance across consumers and consumes each reservation only once", async () => {
    await db.exec("DELETE FROM currents_daily_usage");
    const results = await Promise.all(
      Array.from({ length: 45 }, (_, n) =>
        db.query<{ id: string | null }>("SELECT reserve_currents_request($1) AS id", [
          ["preview", "ingest", "evaluation"][n % 3],
        ]),
      ),
    );
    const ids = results.flatMap((result) => (result.rows[0]?.id ? [result.rows[0].id] : []));
    expect(ids).toHaveLength(40);
    expect(
      (
        await db.query<{ started: boolean }>("SELECT start_currents_request($1) AS started", [
          ids[0],
        ])
      ).rows[0]?.started,
    ).toBe(true);
    expect(
      (
        await db.query<{ started: boolean }>("SELECT start_currents_request($1) AS started", [
          ids[0],
        ])
      ).rows[0]?.started,
    ).toBe(false);
    expect(
      (
        await db.query<{ requests: number }>(
          "SELECT requests FROM currents_daily_usage WHERE day=(now() AT TIME ZONE 'UTC')::date",
        )
      ).rows[0]?.requests,
    ).toBe(40);
  });

  it("reserves evaluation quota once and never replays a claimed evaluation", async () => {
    const id = (
      await db.query<{
        id: string;
      }>(`INSERT INTO currents_evaluation_requests(study_id,phase,ordinal,params)
      VALUES(gen_random_uuid(),'base',1,'{}') RETURNING id`)
    ).rows[0]!.id;
    const first = (
      await db.query<{ claim: { outcome: string; attempt_id: string } }>(
        "SELECT claim_currents_evaluation($1) AS claim",
        [id],
      )
    ).rows[0]!.claim;
    expect(first.outcome).toBe("claimed");
    expect(first.attempt_id).toBeTruthy();
    expect(
      (
        await db.query<{ claim: { outcome: string } }>(
          "SELECT claim_currents_evaluation($1) AS claim",
          [id],
        )
      ).rows[0]?.claim.outcome,
    ).toBe("done");
    expect((await db.query("SELECT * FROM currents_requests")).rows).toHaveLength(1);
  });

  it("skips match rewrites on replay and invalidates only relevant configuration/content changes", async () => {
    const feed = (
      await db.query<{ id: string }>("SELECT id FROM feeds WHERE connector='rss' LIMIT 1")
    ).rows[0]!.id;
    const company = (await db.query<{ id: string }>("SELECT id FROM companies LIMIT 1")).rows[0]!
      .id;
    const revision = async () =>
      Number(
        (await db.query<{ revision: number }>("SELECT revision FROM matching_state")).rows[0]!
          .revision,
      );
    const current = await revision();
    const item = {
      headline: "Incremental test",
      summary: null,
      canonical_url: "https://example.com/incremental",
      publisher: "Example",
      published_at: new Date().toISOString(),
      published_at_estimated: false,
      headline_norm: "incremental test",
    };
    const records = JSON.stringify([
      {
        item,
        input: [item.headline, null, item.published_at, feed],
        existing_id: null,
        feed_id: feed,
        refresh: false,
        matches: [
          {
            company_id: company,
            topic_id: null,
            matched_terms: ["test"],
            relevance_score: 0.9,
            base_score: 0.8,
          },
        ],
      },
    ]);
    await db.query("SELECT store_collected_batch($1,$2,'triage-2')", [records, current]);
    const matchId = (
      await db.query<{ id: string }>(
        "SELECT m.id FROM item_matches m JOIN items i ON i.id=m.item_id WHERE i.canonical_url=$1",
        [item.canonical_url],
      )
    ).rows[0]!.id;
    await db.query("SELECT store_collected_batch($1,$2,'triage-2')", [records, current]);
    expect(
      (await db.query<{ id: string }>("SELECT id FROM item_matches WHERE id=$1", [matchId])).rows,
    ).toHaveLength(1);
    await db.query("UPDATE feeds SET last_polled_at=now() WHERE id=$1", [feed]);
    expect(await revision()).toBe(current);
    await db.query("UPDATE companies SET name=name,notes='Editorial note only' WHERE id=$1", [
      company,
    ]);
    expect(await revision()).toBe(current);
    await db.query("UPDATE companies SET aliases=array_append(aliases,'New Alias') WHERE id=$1", [
      company,
    ]);
    expect(await revision()).toBeGreaterThan(current);
    await db.exec("SAVEPOINT outdated_rules");
    await expect(
      db.query("SELECT store_collected_batch($1,$2,'triage-2')", [records, current]),
    ).rejects.toThrow("rules changed");
    await db.exec("ROLLBACK TO SAVEPOINT outdated_rules");
    await db.query("UPDATE items SET headline='Changed content' WHERE canonical_url=$1", [
      item.canonical_url,
    ]);
    expect(
      Number(
        (
          await db.query<{ match_revision: number }>(
            "SELECT match_revision FROM items WHERE canonical_url=$1",
            [item.canonical_url],
          )
        ).rows[0]!.match_revision,
      ),
    ).toBe(0);
  });

  it("rejects stale content during batch rematching without marking it current", async () => {
    const item = (
      await db.query<{
        id: string;
        headline: string;
        summary: string | null;
        published_at: string;
        feed_id: string;
      }>(
        "INSERT INTO items(headline,canonical_url,publisher,published_at) VALUES('Stale match','https://example.com/stale-match','Example',now()) RETURNING *",
      )
    ).rows[0]!;
    const revision = Number(
      (await db.query<{ revision: number }>("SELECT revision FROM matching_state")).rows[0]!
        .revision,
    );
    await db.query("UPDATE items SET summary='Edited after the snapshot' WHERE id=$1", [item.id]);
    const result = await db.query<{ changed: number }>(
      "SELECT replace_matches_batch($1,$2,'triage-2') AS changed",
      [
        JSON.stringify([
          {
            id: item.id,
            input: [item.headline, item.summary, item.published_at, item.feed_id],
            matches: [],
          },
        ]),
        revision,
      ],
    );
    expect(result.rows[0]?.changed).toBe(0);
  });

  it("calculates exact recency thresholds without rematching", async () => {
    for (const [age, score] of [
      [24, 0.9],
      [24.001, 0.85],
      [72, 0.85],
      [72.001, 0.8],
    ]) {
      const result = await db.query<{ score: string }>(
        "SELECT effective_relevance(0.8,0.9,now()-$1::numeric*interval '1 hour',now()) AS score",
        [age],
      );
      expect(Number(result.rows[0]?.score)).toBe(score);
    }
  });

  it("recovers a source cursor and fences the abandoned worker", async () => {
    const feed = (
      await db.query<{ id: string }>("SELECT id FROM feeds WHERE connector='pubmed' LIMIT 1")
    ).rows[0]!.id;
    const run = (
      await db.query<{ id: string }>("SELECT begin_collection('ingest','schedule') AS id")
    ).rows[0]!.id;
    type Job = { id: string; lease_token: string; cursor: { offset?: number }; attempts: number };
    const first = (
      await db.query<{ job: Job }>("SELECT claim_source_job($1,$2) AS job", [feed, run])
    ).rows[0]!.job;
    await db.query("SELECT checkpoint_source_job($1,$2,'{\"offset\":100}')", [
      first.id,
      first.lease_token,
    ]);
    expect(
      (await db.query<{ job: Job | null }>("SELECT claim_source_job($1,$2) AS job", [feed, run]))
        .rows[0]?.job,
    ).toBeNull();
    await db.query("UPDATE collection_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [
      first.id,
    ]);
    const second = (
      await db.query<{ job: Job }>("SELECT claim_source_job($1,$2) AS job", [feed, run])
    ).rows[0]!.job;
    expect(second.id).toBe(first.id);
    expect(second.cursor.offset).toBe(100);
    expect(second.attempts).toBe(2);
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(
      (
        await db.query<{ ok: boolean }>("SELECT finish_source_job($1,$2,'completed') AS ok", [
          first.id,
          first.lease_token,
        ])
      ).rows[0]?.ok,
    ).toBe(false);
    await db.exec("SAVEPOINT expired_worker");
    await expect(
      db.query("SELECT store_job_batch($1,$2,'[]',1,'triage-2')", [first.id, first.lease_token]),
    ).rejects.toThrow("lease expired");
    await db.exec("ROLLBACK TO SAVEPOINT expired_worker");
  });

  it("does not replay an uncertain Currents source job", async () => {
    const feed = (
      await db.query<{ id: string }>(
        "UPDATE feeds SET active=true WHERE id=(SELECT id FROM feeds WHERE connector='currents' LIMIT 1) RETURNING id",
      )
    ).rows[0]!.id;
    const run = (await db.query<{ id: string }>("SELECT begin_collection('ingest','manual') AS id"))
      .rows[0]!.id;
    const job = (
      await db.query<{ job: { id: string } }>("SELECT claim_source_job($1,$2) AS job", [feed, run])
    ).rows[0]!.job;
    await db.query("UPDATE collection_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [
      job.id,
    ]);
    expect(
      (await db.query<{ job: unknown }>("SELECT claim_source_job($1,$2) AS job", [feed, run]))
        .rows[0]?.job,
    ).toBeNull();
    expect(
      (
        await db.query<{ status: string }>("SELECT status FROM collection_jobs WHERE id=$1", [
          job.id,
        ])
      ).rows[0]?.status,
    ).toBe("failed");
  });

  it("returns only the current editor's action and preserves dismissed stories in the archive", async () => {
    const id = (
      await db.query<{ id: string }>(
        "INSERT INTO items(headline,canonical_url,publisher,published_at) VALUES('Action isolation','https://example.com/action-isolation','Example',now()) RETURNING id",
      )
    ).rows[0]!.id;
    await db.query(
      "INSERT INTO item_actions(item_id,user_id,status,note) VALUES($1,$2,'dismissed','My note'),($1,$3,'used','Private note')",
      [id, member, outsider],
    );
    await asUser(member);
    const rows = (
      await db.query<{ result: { id: string; action: { note: string } }[] }>(
        "SELECT archive_items('Action isolation',false,NULL,NULL,0,50) AS result",
      )
    ).rows[0]!.result;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action.note).toBe("My note");
    await db.exec("RESET ROLE");
    await asUser(outsider);
    expect(
      (
        await db.query<{ result: unknown[] }>(
          "SELECT archive_items(NULL,false,NULL,NULL,0,50) AS result",
        )
      ).rows[0]?.result,
    ).toEqual([]);
  });

  it("detects missing schedules and ignores intentionally paused sources", async () => {
    await db.exec("UPDATE feeds SET active=false");
    const health = (
      await db.query<{
        result: { schedule_missing: boolean; sources_stale: number; source_failures: number };
      }>("SELECT collection_health() AS result")
    ).rows[0]!.result;
    expect(health).toMatchObject({ schedule_missing: true, sources_stale: 0, source_failures: 0 });
    await asUser(member);
    await expect(db.query("SELECT collection_health()")).rejects.toThrow("permission denied");
  });

  it("keeps archive action transfer bounded to the page as action history grows", async () => {
    await db.exec(`WITH inserted AS (
      INSERT INTO items(headline,canonical_url,publisher,published_at)
      SELECT 'Payload profile '||n,'https://example.com/profile/'||n,'Example',now()-n*interval '1 second'
      FROM generate_series(1,500) n RETURNING id
    ) INSERT INTO item_actions(item_id,user_id,status,note)
      SELECT id,'${member}','read',repeat('Editorial history ',30) FROM inserted`);
    await asUser(member);
    const all = (await db.query("SELECT * FROM item_actions")).rows;
    const page = (
      await db.query<{ result: unknown[] }>(
        "SELECT archive_items('Payload profile',false,NULL,NULL,0,50) AS result",
      )
    ).rows[0]!.result;
    expect(all).toHaveLength(500);
    expect(page).toHaveLength(50);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(all)) / 4,
    );
  });
});

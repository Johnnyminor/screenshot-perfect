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
    const feeds = (await db.query<{ id: string }>("SELECT id FROM feeds ORDER BY id LIMIT 2")).rows;
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
    await db.exec("INSERT INTO companies(name) VALUES('New Company')");
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

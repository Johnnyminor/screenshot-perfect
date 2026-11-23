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

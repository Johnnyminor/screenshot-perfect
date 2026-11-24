// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { matchEntity, buildMatches, type Watchable } from "./triage";
let db: PGlite;
let companies: Watchable[];
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE companies(id text PRIMARY KEY,name text,aliases text[] NOT NULL DEFAULT '{}');
    INSERT INTO companies(id,name,aliases) VALUES
    ('bayer','Bayer','{}'),('abbott','Abbott','{"Abbott Laboratories"}'),('braun','B. Braun','{}'),
    ('evotec','Evotec','{}'),('baxter','Baxter International','{"Baxter"}'),('gilead','Gilead Sciences','{"Gilead"}');`);
  await db.exec(
    await readFile(
      new URL("../../drizzle/migrations/0008_company_disambiguation.sql", import.meta.url),
      "utf8",
    ),
  );
  companies = (await db.query<Watchable>("SELECT * FROM companies")).rows;
}, 60000);
afterAll(async () => {
  await db?.close();
});
const entity = (name: string) => companies.find((c) => c.name === name)!;
describe("configured identity disambiguation", () => {
  it.each([
    ["Bayer", "Bayer Leverkusen - Paderborn TV & Stream"],
    ["Bayer", "1. FC Köln - Bayer 04 Leverkusen live resultat"],
    ["Bayer", "BAYER—LEVERKUSEN football highlights"],
    ["Abbott", "Sjokktap for guvernør Abbott i Texas"],
    ["Abbott", "Greg Abbott announces healthcare reform"],
    ["B. Braun", "B. Braun Sheffield Sharks - Bristol Flyers basketball"],
    ["B. Braun", "B-Braun Sheffield Sharks win a charity hospital tournament"],
    ["Evotec", "Evotec med oppkjøp i USA"],
    ["Evotec", "Evotec AS expands marine equipment production"],
    ["Baxter International", "Baxter overrasker alle"],
    ["Gilead Sciences", "Velkommen til Gilead. FN-versjonen."],
  ])("rejects the unrelated %s mention in %s", (company, headline) => {
    expect(matchEntity(entity(company), headline, "")).toBeNull();
  });
  it.each([
    ["Bayer", "Bayer får amerikansk godkjenning for nytt legemiddel mot hjerneslag", ""],
    ["Bayer", "Bayer Norge henter radiofarmasikompetanse fra Artbio", ""],
    ["Bayer", "Bayer inngår forlik om herbicidet Roundup", ""],
    ["Bayer", "Verquvo forsyningsvanskelighed", "Markedsføringen fra Bayer A/S vil ophøre."],
    ["Abbott", "Abbott Amplatzer Paraclose PVL Occluder får FDA-godkjenning", ""],
    ["Abbott", "Abbott Laboratories revises financial guidance", ""],
    ["B. Braun", "B. Braun delivers medical supplies to hospitals", ""],
    ["Evotec", "Evotec acquires a biotech company in the USA", ""],
    ["Baxter International", "Sendoxan 50 mg", "Tabletterne fra Baxter A/S."],
    ["Baxter International", "Baxter International reports earnings", ""],
    ["Gilead Sciences", "Gilead holder fast på salgsnekt til Leger Uten Grenser", ""],
    ["Gilead Sciences", "Gilead Sciences announces share buyback", ""],
  ])("retains the company %s in %s", (company, headline, summary) => {
    expect(matchEntity(entity(company), headline, summary)).not.toBeNull();
  });
  it("does not veto a legitimate company mention elsewhere in a story about a namesake", () => {
    expect(
      matchEntity(entity("Abbott"), "Greg Abbott meets Abbott Laboratories executives", ""),
    ).not.toBeNull();
    expect(
      matchEntity(
        entity("Bayer"),
        "Bayer Leverkusen partners with Bayer AG on medical research",
        "",
      ),
    ).not.toBeNull();
  });
  it("preserves whole-story editorial exclusions and first-party ownership separately", () => {
    const owned = { ...entity("Bayer"), exclude_terms: ["sponsorship"] };
    const item = {
      headline: "Research update",
      summary: null,
      published_at: new Date().toISOString(),
    };
    expect(buildMatches([owned], [], item, 0.9, new Date(), owned.id)).toHaveLength(1);
    expect(
      buildMatches([owned], [], { ...item, headline: "sponsorship" }, 0.9, new Date(), owned.id),
    ).toEqual([]);
  });
});

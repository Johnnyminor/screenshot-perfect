import { useQuery } from "@tanstack/react-query";
import { companyCoverageQuery, feedsQuery } from "@/lib/queries";
import { isFeedStale } from "@/lib/collection-policy";
import { QueryError } from "./QueryError";

export function CoveragePanel() {
  const companies = useQuery(companyCoverageQuery());
  const feeds = useQuery(feedsQuery());
  const active = (feeds.data ?? []).filter((feed) => feed.active);
  const groups = [
    {
      label: "Direkte kilder og API'er",
      rows: active.filter((f) => f.kind !== "google_news" && f.connector !== "currents"),
    },
    { label: "Google News", rows: active.filter((f) => f.kind === "google_news") },
  ];
  const gaps = (companies.data ?? []).filter((c) => c.stories_7d === 0);
  return (
    <section className="space-y-3 rounded-sm border bg-card p-4 text-sm" aria-label="Kildedækning">
      <h2 className="text-lg">Kildedækning og huller</h2>
      <QueryError
        error={companies.error ?? feeds.error}
        retry={() => {
          void companies.refetch();
          void feeds.refetch();
        }}
      />
      <p>
        Driftsstatus viser, om indsamlingen kører. Dækning viser, hvilke kilder der faktisk svarer,
        og hvilke virksomheder der har historier i arkivet.
      </p>
      {groups.map(({ label, rows }) => (
        <div key={label}>
          <strong>{label}:</strong> {rows.filter((f) => !isFeedStale(f) && !f.last_error).length}/
          {rows.length} med nylig succes uden fejl.
          {rows.some((f) => isFeedStale(f) || f.last_error) && (
            <details>
              <summary className="cursor-pointer text-destructive">
                Vis manglende eller forældede kildesvar
              </summary>
              <ul className="list-disc pl-5">
                {rows
                  .filter((f) => isFeedStale(f) || f.last_error)
                  .map((f) => (
                    <li key={f.id}>
                      {f.name}: {f.last_error || "Ingen nylig succes"}; seneste succes:{" "}
                      {f.last_success_at
                        ? new Date(f.last_success_at).toLocaleString("da-DK")
                        : "aldrig"}
                      .
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      ))}
      <p>
        Currents: {active.filter((f) => f.connector === "currents").length} manuelle søgninger;
        indgår ikke i tidsplanens friskhedskrav. Et vellykket kildesvar kan indeholde nul nye
        historier.
      </p>
      {companies.data && (
        <details>
          <summary className="cursor-pointer font-semibold">
            Virksomhedsdækning: {gaps.length}/{companies.data.length} uden historier de seneste 7
            dage — vis alle
          </summary>
          <p className="py-2 text-muted-foreground">
            Automatiske match i det reelle arkiv, målt på publiceringsdato; testhistorier og
            estimerede datoer er udeladt. Nul historier kan også skyldes en stille periode. Antal er
            ikke en garanti for korrekt eller fuldstændig dækning.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>Virksomhed</th>
                  <th>7 dage</th>
                  <th>30 dage</th>
                  <th>Seneste publicering</th>
                  <th>Direkte kilde</th>
                </tr>
              </thead>
              <tbody>
                {[...companies.data]
                  .sort((a, b) => a.stories_7d - b.stories_7d || a.name.localeCompare(b.name))
                  .map((c) => (
                    <tr key={c.id} className={c.stories_7d ? "" : "text-destructive"}>
                      <td className="py-1">{c.name}</td>
                      <td>{c.stories_7d}</td>
                      <td>{c.stories_30d}</td>
                      <td>
                        {c.last_published_at
                          ? new Date(c.last_published_at).toLocaleDateString("da-DK")
                          : "Ingen"}
                      </td>
                      <td>
                        {active.some(
                          (f) =>
                            f.company_id === c.id &&
                            f.kind === "static" &&
                            ["rss", "announcements"].includes(f.connector),
                        )
                          ? "Ja"
                          : "Mangler"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

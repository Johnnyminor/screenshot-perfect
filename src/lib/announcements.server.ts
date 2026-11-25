import { fetchSource, readSourceBody } from "./source-http.server";
import { approvedSourceUrl, isAnnouncementSource } from "./source-config";
import { parseAnnouncements, announcementSummary } from "./announcements";
import { parseAmbu, parseEuroland, eurolandSummary, parseAlkPress } from "./company-announcements";
import type { ParsedItem } from "./source-parsers";

/** Public data endpoints embedded in the publishers' official announcement pages. */
export async function collectAnnouncements(
  source: string,
  store: (item: ParsedItem) => Promise<void>,
  deadline: () => void,
) {
  const config = approvedSourceUrl(source);
  if (!isAnnouncementSource(config)) throw new Error("Ukendt meddelelseskilde.");
  const headers = { "User-Agent": "LexNyhedsmonitor/1.0 (+https://lex.dk)", Accept: "text/html" };
  const now = Date.now(),
    start = new Date(now - 30 * 864e5),
    end = new Date(now + 864e5);
  if (config.hostname === "www.alk.net") {
    const html = await readSourceBody(await fetchSource(source, headers, { deadline }));
    for (const item of parseAlkPress(html, now)) await store(item);
    return;
  }
  const postHeaders = {
    ...headers,
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (config.hostname === "www.ambu.com") {
    const format = (date: Date) =>
      `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()} 12:00:00 AM`;
    const response = await fetchSource("https://www.ambu.com/system/data/news", postHeaders, {
      deadline,
      postBody: new URLSearchParams({ yearFrom: format(start), yearTo: format(end) }).toString(),
    });
    for (const item of parseAmbu(JSON.parse(await readSourceBody(response)), now))
      await store(item);
    return;
  }
  let items: ParsedItem[];
  if (config.hostname === "tools.eurolandir.com") {
    const format = (date: Date) =>
      `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
    const response = await fetchSource(
      "https://tools.eurolandir.com/tools/Pressreleases/Main/GetNews/",
      postHeaders,
      {
        deadline,
        postBody: new URLSearchParams({
          strDateFrom: format(start),
          strDateTo: format(end),
          typeFilter: "",
          orderBy: "0",
          pageIndex: "0",
          pageJummp: "20",
          hasTypeFilter: "false",
          searchPhrase: "",
          companyCode: config.searchParams.get("companycode")!,
          onlyInsiderInfo: "false",
          lang: "en-GB",
          v: "r2024",
          alwaysIncludeInsiders: "false",
          strYears: "",
        }).toString(),
      },
    );
    items = parseEuroland(JSON.parse(await readSourceBody(response)), source, now);
  } else {
    items = parseAnnouncements(
      await readSourceBody(await fetchSource(source, headers, { deadline })),
      now,
    );
  }
  for (const item of items) {
    deadline();
    const html = await readSourceBody(await fetchSource(item.link, headers, { deadline }));
    await store({
      ...item,
      summary:
        config.hostname === "tools.eurolandir.com"
          ? eurolandSummary(html)
          : announcementSummary(html),
    });
  }
}

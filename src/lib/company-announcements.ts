import { z } from "zod";
import { parseDocument } from "htmlparser2";
import { findAll, textContent } from "domutils";
import type { ParsedItem } from "./source-parsers";

const clean = (value: string) => textContent(parseDocument(value)).replace(/\s+/g, " ").trim();
const recent = (item: ParsedItem, now: number) =>
  !!item.publishedAt && +item.publishedAt >= now - 30 * 864e5 && +item.publishedAt <= now + 864e5;

/** Headline/date metadata from the official press page, without fetching external full text. */
export function parseAlkPress(html: string, now = Date.now()): ParsedItem[] {
  const hasClass = (node: { attribs: Record<string, string> }, name: string) =>
    node.attribs["class"]?.split(/\s+/).includes(name) === true;
  const lists = findAll(
    (node) => node.name === "ul" && hasClass(node, "slider-news-promo-list"),
    parseDocument(html).children,
  );
  if (!lists.length) throw new Error("ALKs nyhedsliste mangler eller har ændret format.");
  const rows = lists.flatMap((list) => findAll((node) => node.name === "li", list.children));
  const items = rows
    .map((row) => {
      const title = findAll((node) => hasClass(node, "views-field-title"), row.children)[0];
      const dateField = findAll(
        (node) => hasClass(node, "views-field-field-date"),
        row.children,
      )[0];
      const dateNode = dateField
        ? findAll((node) => hasClass(node, "field-content"), dateField.children)[0]
        : undefined;
      const anchor = findAll(
        (node) => node.name === "a" && !!node.attribs["href"],
        row.children,
      )[0];
      const date = dateNode
        ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(textContent(dateNode).trim())
        : null;
      if (!title || !anchor || !date)
        throw new Error("ALK-meddelelsen mangler titel, link eller dato.");
      const publishedAt = new Date(Date.UTC(Number(date[3]), Number(date[1]) - 1, Number(date[2])));
      if (
        publishedAt.getUTCMonth() !== Number(date[1]) - 1 ||
        publishedAt.getUTCDate() !== Number(date[2])
      )
        throw new Error("ALK-meddelelsen har en ugyldig dato.");
      const url = new URL(anchor.attribs["href"]!);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.hostname !== "www.globenewswire.com" ||
        !url.pathname.startsWith("/news-release/")
      )
        throw new Error("ALK-meddelelsen har et uventet udgiverlink.");
      const headline = textContent(title).replace(/\s+/g, " ").trim();
      if (!headline) throw new Error("ALK-meddelelsen har ingen titel.");
      return { headline, publishedAt, summary: "", link: url.href };
    })
    .filter((item) => recent(item, now));
  if (items.length > 20) throw new Error("ALKs nyhedsliste overstiger 20 aktuelle poster.");
  return [...new Map(items.map((item) => [item.link, item])).values()];
}

const ambuSchema = z.object({
  newsList: z.array(
    z.object({
      id: z.number().int().positive(),
      title: z.string().min(1),
      textRaw: z.string(),
      date: z.string(),
      restrictedNews: z.enum(["True", "False"]),
    }),
  ),
});
export function parseAmbu(body: unknown, now = Date.now()): ParsedItem[] {
  const data = ambuSchema.parse(body);
  const items = data.newsList
    .filter((row) => row.restrictedNews === "False")
    .map((row) => {
      const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s/.exec(row.date);
      if (!date) throw new Error("Ambu-meddelelsen mangler en gyldig dato.");
      const month = Number(date[1]),
        day = Number(date[2]),
        year = Number(date[3]);
      const publishedAt = new Date(Date.UTC(year, month - 1, day));
      if (publishedAt.getUTCMonth() !== month - 1 || publishedAt.getUTCDate() !== day)
        throw new Error("Ambu-meddelelsen har en ugyldig dato.");
      return {
        headline: clean(row.title),
        summary: clean(row.textRaw).slice(0, 1000),
        publishedAt,
        link: `https://www.ambu.com/corporate-info/investors/news-from-ambu#/ambu-news-item=${row.id}/`,
      };
    })
    .filter((item) => recent(item, now));
  if (items.length > 50)
    throw new Error("Ambu returnerede over 50 aktuelle meddelelser. Afgræns indsamlingen.");
  if (items.some((item) => !item.headline || !item.summary))
    throw new Error("Ambu-meddelelsen mangler titel eller tekst.");
  return items;
}

const eurolandSchema = z.object({
  total: z.number().int().nonnegative(),
  News: z.array(
    z.object({
      ID: z.number().int().positive(),
      title: z.string().min(1),
      date: z.string(),
    }),
  ),
});
export function parseEuroland(body: unknown, source: string, now = Date.now()): ParsedItem[] {
  const data = eurolandSchema.parse(body);
  if (data.total > data.News.length || data.News.length > 20)
    throw new Error("Meddelelseslisten kræver flere sider. Udvid adapteren før næste forsøg.");
  const config = new URL(source);
  return data.News.map((row) => {
    const epoch = /Date\((\d+)\)/.exec(row.date);
    if (!epoch) throw new Error("Euroland-meddelelsen mangler en gyldig dato.");
    const publishedAt = new Date(Number(epoch[1]));
    if (!Number.isFinite(+publishedAt))
      throw new Error("Euroland-meddelelsen har en ugyldig dato.");
    const link = new URL("https://tools.eurolandir.com/tools/Pressreleases/GetPressRelease/");
    link.search = new URLSearchParams({
      ID: String(row.ID),
      lang: "en-GB",
      companycode: config.searchParams.get("companycode")!,
      v: "r2024",
    }).toString();
    return { headline: clean(row.title), publishedAt, summary: "", link: link.href };
  }).filter((item) => recent(item, now));
}
export function eurolandSummary(html: string): string {
  const body = findAll(
    (node) => node.attribs["id"] === "SeparateNews-Body",
    parseDocument(html).children,
  )[0];
  const paragraphs = body ? findAll((node) => node.name === "p", body.children) : [];
  const text = paragraphs.length
    ? paragraphs.slice(0, 3).map(textContent).join(" ")
    : body
      ? textContent(body)
      : "";
  const summary = text.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!summary) throw new Error("Euroland-meddelelsens indhold mangler eller har ændret format.");
  return summary;
}

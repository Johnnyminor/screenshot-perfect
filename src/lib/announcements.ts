import { parseDocument } from "htmlparser2";
import { findAll, textContent } from "domutils";
import type { ParsedItem } from "./source-parsers";

const base = "https://www.bavarian-nordic.com/investor/news/news.aspx";
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const hasClass = (value: string | undefined, name: string) => value?.split(/\s+/).includes(name);

/** Deliberately restricted first-party adapter, not a general-purpose web crawler. */
export function announcementUrl(value: string): string {
  const url = new URL(value, base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.hostname !== "www.bavarian-nordic.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/investor/news/news.aspx" ||
    !/^\d+$/.test(url.searchParams.get("news") ?? "") ||
    [...url.searchParams.keys()].some((key) => key !== "news")
  )
    throw new Error("Uventet adresse i meddelelseslisten.");
  url.protocol = "https:";
  url.hash = "";
  return url.href;
}

export function parseAnnouncements(html: string, now = Date.now()): ParsedItem[] {
  const doc = parseDocument(html);
  const rows = findAll(
    (node) => hasClass(node.attribs["class"], "newslist") === true,
    doc.children,
  );
  if (!rows.length) throw new Error("Meddelelseslisten mangler eller har ændret format.");
  const items = rows.map((row) => {
    const anchor = findAll((node) => node.name === "a" && !!node.attribs["href"], row.children)[0];
    const date = findAll(
      (node) => hasClass(node.attribs["class"], "date") === true,
      row.children,
    )[0];
    const headline = anchor ? clean(textContent(anchor)) : "";
    // Listing dates have day precision. Store UTC midnight without inventing a release time.
    const parsed = date ? new Date(`${clean(textContent(date))} 00:00:00 GMT`) : new Date(NaN);
    if (!anchor || !headline || !Number.isFinite(+parsed))
      throw new Error("Meddelelsen mangler titel, link eller gyldig dato.");
    return {
      headline,
      link: announcementUrl(anchor.attribs["href"]!),
      publishedAt: parsed,
      summary: "",
    };
  });
  return [...new Map(items.map((item) => [item.link, item])).values()]
    .filter((item) => +item.publishedAt >= now - 30 * 864e5 && +item.publishedAt <= now + 864e5)
    .sort((a, b) => +b.publishedAt - +a.publishedAt)
    .slice(0, 20);
}

export function announcementSummary(html: string): string {
  const doc = parseDocument(html);
  const article = findAll(
    (node) => node.name === "article" && hasClass(node.attribs["class"], "content") === true,
    doc.children,
  )[0];
  if (!article) throw new Error("Meddelelsens indhold mangler eller har ændret format.");
  const paragraphs = findAll((node) => node.name === "p", article.children);
  const summary = clean(paragraphs.slice(0, 3).map(textContent).join(" ")).slice(0, 1000);
  if (!summary) throw new Error("Meddelelsen indeholder ingen tekst.");
  return summary;
}

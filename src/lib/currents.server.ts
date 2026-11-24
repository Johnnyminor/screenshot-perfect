import { z } from "zod";

const newsSchema = z.object({
  status: z.literal("ok"),
  news: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullish(),
    url: z.string().url(),
    author: z.string().nullish(),
    image: z.string().nullish(),
    language: z.string(),
    category: z.array(z.string()).default([]),
    published: z.string(),
  })),
});

export type CurrentsNewsResult = {
  news: z.infer<typeof newsSchema>["news"];
  error: string | null;
};

/** Fixed API destination; never follow redirects with credentials or expose provider errors. */
export async function fetchCurrentsLatestNews(apiKey: string | undefined): Promise<CurrentsNewsResult> {
  if (!apiKey) return { news: [], error: "Currents API-nøglen er ikke konfigureret." };
  try {
    const response = await fetch("https://api.currentsapi.services/v1/latest-news", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": "LexNyhedsmonitor/1.0 (+https://lex.dk)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const error = response.status === 401 || response.status === 403
        ? "Currents afviste API-nøglen. Kontrollér nøglen og abonnementet."
        : response.status === 429
          ? "Currents' forespørgselsgrænse er nået. Prøv igen senere."
          : "Nyheder fra Currents er midlertidigt utilgængelige.";
      return { news: [], error };
    }
    const parsed = newsSchema.safeParse(await response.json());
    if (!parsed.success) return { news: [], error: "Currents returnerede et ugyldigt nyhedssvar." };
    return { news: parsed.data.news, error: null };
  } catch {
    return { news: [], error: "Nyheder fra Currents kunne ikke hentes. Prøv igen senere." };
  }
}
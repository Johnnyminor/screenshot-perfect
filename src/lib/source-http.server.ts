import { approvedSourceUrl, rateLimitDelay } from "./source-config";

export function retryAfterAt(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  const target = Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(value);
  return Number.isFinite(target) ? Math.max(now, target) : null;
}
export function isAutomatedRequestBlock(body: string): boolean {
  return /automated quer(?:y|ies)|unusual traffic|<title>\s*Sorry/i.test(body);
}
export class SourceHttpError extends Error {
  constructor(
    readonly hostname: string,
    readonly status: number,
    readonly blocked: boolean,
    readonly retryAt: number | null,
  ) {
    super(
      `HTTP ${status} (${hostname})${blocked ? " – udbyderen afviser automatiske forespørgsler" : status === 429 ? " – udbyderens hastighedsgrænse" : ""}`,
    );
  }
}
export async function readSourceBody(response: Response, maxBytes = 5_000_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Kilden returnerede intet indhold.");
  const decoder = new TextDecoder();
  let body = "",
    size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Kilden overskrider svargrænsen.");
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel();
  }
}
async function errorSample(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < 4096) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.slice(0, 4096 - size);
      chunks.push(chunk);
      size += chunk.length;
    }
  } finally {
    await reader.cancel();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(buffer);
}
async function fetchApproved(
  raw: string,
  headers: Record<string, string>,
  redirects = 0,
  postBody?: string,
): Promise<Response> {
  const url = approvedSourceUrl(raw);
  const response = await fetch(url, {
    headers,
    ...(postBody !== undefined ? { method: "POST", body: postBody } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (postBody !== undefined) throw new Error("Kildens data-POST må ikke omdirigeres.");
    if (!location || redirects >= 4) throw new Error("For mange eller ugyldige omdirigeringer.");
    return fetchApproved(new URL(location, url).href, headers, redirects + 1);
  }
  return response;
}

/** A bounded retry policy; explicit automated-request blocks are never retried. */
export async function fetchSource(
  raw: string,
  headers: Record<string, string>,
  options: { attempts?: number; deadline?: () => void; postBody?: string } = {},
): Promise<Response> {
  const host = approvedSourceUrl(raw).hostname;
  for (let attempt = 0; ; attempt++) {
    options.deadline?.();
    const response = await fetchApproved(raw, headers, 0, options.postBody);
    if (response.ok || response.status === 304) return response;
    const retryHeader = response.headers.get("retry-after");
    const blocked = isAutomatedRequestBlock(await errorSample(response));
    const error = new SourceHttpError(host, response.status, blocked, retryAfterAt(retryHeader));
    const delay = rateLimitDelay(retryHeader, attempt);
    if (
      blocked ||
      ![429, 502, 503, 504].includes(response.status) ||
      attempt + 1 >= (options.attempts ?? 2) ||
      delay === null
    )
      throw error;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

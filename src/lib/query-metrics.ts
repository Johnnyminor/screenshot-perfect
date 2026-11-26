type Sample = { name: string; durationMs: number; bytes: number; at: string };
const samples: Sample[] = [];

/** Development-only, bounded measurements. Story text, URLs and credentials are never retained. */
export async function measuredQuery<T>(name: string, operation: () => Promise<T>): Promise<T> {
  if (!import.meta.env.DEV) return operation();
  const start = performance.now();
  const result = await operation();
  samples.push({
    name,
    durationMs: Math.round(performance.now() - start),
    bytes: new TextEncoder().encode(JSON.stringify(result) ?? "null").length,
    at: new Date().toISOString(),
  });
  if (samples.length > 200) samples.shift();
  return result;
}
export const queryMetrics = () => samples.map((sample) => ({ ...sample }));

// Datacenter da Cloudflare por onde o servidor sai para a internet (diagnóstico de latência no Container).
let colo: string | null = null;

export function parseCfTrace(text: string): string | null {
  return text.match(/^colo=(\w+)$/m)?.[1] ?? null;
}

export async function detectColo(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(5000) });
    colo = parseCfTrace(await res.text());
  } catch {
    colo = null;
  }
  return colo;
}

export function getColo(): string | null {
  return colo;
}

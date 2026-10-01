export type ApiSecrets = {
  DATABASE_URL: string;
  SESSION_SECRET: string;
  INTERNAL_TOKEN: string;
  NFSE_CERT_PFX_B64: string;
  NFSE_CERT_PFX_PASSPHRASE: string;
  SIDE_EFFECTS_ENABLED: string;
  NFSE_ENABLE_IBSCBS_DPS: string;
};

export const CONTAINER_PORT = 8080;

// Cabeçalhos de resposta que o front lê em chamadas cross-origin.
export const EXPOSED_HEADERS = ["Content-Disposition", "X-Exported-Xml-Count", "X-Exported-Danfse-Count", "X-Export-Skipped-Count"];

// Configurações opcionais que o Express lê (mesmos nomes usados no Replit), repassadas se existirem.
const PASSTHROUGH_PREFIXES = ["SICOOB_", "NFSE_", "DANFSE_", "ACCOUNTING_"];

export function buildContainerEnv(env: ApiSecrets): Record<string, string> {
  const optional: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && PASSTHROUGH_PREFIXES.some((p) => key.startsWith(p))) optional[key] = value;
  }
  return {
    ...optional,
    DATABASE_URL: env.DATABASE_URL,
    SESSION_SECRET: env.SESSION_SECRET,
    INTERNAL_TOKEN: env.INTERNAL_TOKEN,
    NFSE_CERT_PFX_B64: env.NFSE_CERT_PFX_B64,
    NFSE_CERT_PFX_PASSPHRASE: env.NFSE_CERT_PFX_PASSPHRASE,
    SIDE_EFFECTS_ENABLED: env.SIDE_EFFECTS_ENABLED,
    NFSE_ENABLE_IBSCBS_DPS: env.NFSE_ENABLE_IBSCBS_DPS,
    SESSION_STORE: "pg",
    SESSION_COOKIE_SECURE: "true",
    TRUST_PROXY: "1",
    SERVE_STATIC: "false",
    PORT: String(CONTAINER_PORT),
  };
}

export function toContainerRequest(req: Request, clientIp: string | null): Request {
  const headers = new Headers(req.headers);
  headers.set("x-forwarded-proto", "https");
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  return new Request(req, { headers });
}

export function isAllowedOrigin(origin: string | undefined, allowList: string): boolean {
  if (!origin) return false;
  return allowList.split(",").map((o) => o.trim()).filter(Boolean).includes(origin);
}

// Instância única do Container. O Durable Object nasce na América do Sul (o hint só vale na criação),
// para o Container subir perto do Neon sa-east-1 em vez de onde chegou a primeira requisição.
export const MAIN_INSTANCE = "main-sam";

export function getMainContainer<T extends Rpc.DurableObjectBranded | undefined>(ns: DurableObjectNamespace<T>): DurableObjectStub<T> {
  return ns.get(ns.idFromName(MAIN_INSTANCE), { locationHint: "sam" });
}

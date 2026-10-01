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

export function buildContainerEnv(env: ApiSecrets): Record<string, string> {
  return {
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

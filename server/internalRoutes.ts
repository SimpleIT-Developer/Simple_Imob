import type { Express } from "express";

export type InternalDeps = {
  tick: () => Promise<void>;
  pingDb: () => Promise<void>;
  token: string | undefined;
  info?: () => Record<string, unknown>;
  mtlsCheck?: (body: { linhaDigitavel?: string; chaveAcesso?: string }) => Promise<{ sicoob?: string; nfse?: string }>;
};

export function registerInternalRoutes(app: Express, deps: InternalDeps) {
  app.get("/api/health", async (_req, res) => {
    try {
      await deps.pingDb();
      res.json({ ok: true, ...(deps.info?.() ?? {}) });
    } catch (error: any) {
      res.status(503).json({ ok: false, error: error?.message || "db indisponível" });
    }
  });

  if (!deps.token) return;

  app.post("/internal/tick", async (req, res) => {
    if (req.get("x-internal-token") !== deps.token) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      await deps.tick();
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[internal/tick]", error);
      res.status(500).json({ error: error?.message || "tick falhou" });
    }
  });

  if (deps.mtlsCheck) {
    const mtlsCheck = deps.mtlsCheck;
    app.post("/internal/mtls-check", async (req, res) => {
      if (req.get("x-internal-token") !== deps.token) {
        return res.status(401).json({ error: "unauthorized" });
      }
      res.json(await mtlsCheck(req.body ?? {}));
    });
  }
}

// Só o nome do banco e o endpoint, sem usuário/senha, para conferir para onde o servidor aponta.
export function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.hostname.split(".")[0]}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return null;
  }
}

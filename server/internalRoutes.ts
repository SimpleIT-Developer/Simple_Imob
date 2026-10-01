import type { Express } from "express";

export type InternalDeps = {
  tick: () => Promise<void>;
  pingDb: () => Promise<void>;
  token: string | undefined;
};

export function registerInternalRoutes(app: Express, deps: InternalDeps) {
  app.get("/api/health", async (_req, res) => {
    try {
      await deps.pingDb();
      res.json({ ok: true });
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
}

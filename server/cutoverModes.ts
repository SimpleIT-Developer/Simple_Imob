import type { NextFunction, Request, Response } from "express";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const WRITES_ALLOWED_IN_READ_ONLY = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/2fa/login"]);
const HOP_BY_HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "accept-encoding", "keep-alive"]);

export function isWriteBlocked(method: string, path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.READ_ONLY !== "true") return false;
  if (READ_METHODS.has(method.toUpperCase())) return false;
  return !WRITES_ALLOWED_IN_READ_ONLY.has(path);
}

export type LegacyAction = "none" | "proxy" | "redirect" | "gone";

export function decideLegacyAction(path: string, env: NodeJS.ProcessEnv = process.env): LegacyAction {
  if (!env.LEGACY_REDIRECT_URL || !env.LEGACY_PROXY_API_URL) return "none";
  if (path.startsWith("/webhook/") || path.startsWith("/api/public/")) return "proxy";
  if (path === "/api" || path.startsWith("/api/")) return "gone";
  return "redirect";
}

async function proxy(req: Request, res: Response, base: string) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  if (req.ip) headers.set("x-forwarded-for", req.ip);

  const upstream = await fetch(new URL(req.originalUrl, base), {
    method: req.method,
    headers,
    body: READ_METHODS.has(req.method) ? undefined : Buffer.concat(chunks),
    redirect: "manual",
  });

  res.status(upstream.status);
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name) && name !== "content-encoding") res.setHeader(name, value);
  });
  res.send(Buffer.from(await upstream.arrayBuffer()));
}

export function cutoverMiddleware(env: NodeJS.ProcessEnv = process.env) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const action = decideLegacyAction(req.path, env);
    try {
      if (action === "proxy") return await proxy(req, res, env.LEGACY_PROXY_API_URL!);
      if (action === "redirect") return res.redirect(302, new URL(req.originalUrl, env.LEGACY_REDIRECT_URL!).toString());
      if (action === "gone") {
        return res.status(410).json({ error: `O sistema mudou de endereço: ${env.LEGACY_REDIRECT_URL}` });
      }
    } catch (error: any) {
      console.error("[legacy-proxy]", error);
      return res.status(502).json({ error: "Falha ao encaminhar para o novo sistema" });
    }

    if (isWriteBlocked(req.method, req.path, env)) {
      return res.status(503).json({
        error: "Sistema em manutenção programada (somente consulta). Tente novamente em alguns minutos.",
      });
    }
    next();
  };
}

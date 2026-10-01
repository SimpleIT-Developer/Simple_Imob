import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Pool } from "pg";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function buildSessionOptions(env: NodeJS.ProcessEnv, pool: Pool): session.SessionOptions {
  const usePg = env.SESSION_STORE === "pg";
  const secure = env.SESSION_COOKIE_SECURE === "true";
  if (usePg && !env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET é obrigatório com SESSION_STORE=pg");
  }

  const options: session.SessionOptions = {
    secret: env.SESSION_SECRET || "imobiliaria-simples-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: secure
      ? { secure: true, httpOnly: true, maxAge: ONE_DAY_MS, sameSite: "lax" }
      : { secure: false, httpOnly: true, maxAge: ONE_DAY_MS },
  };

  if (usePg) {
    const PgStore = connectPgSimple(session);
    // Tabela criada por ensureSessionTable (o bundle do esbuild não leva o table.sql do pacote).
    options.store = new PgStore({ pool, tableName: "session", createTableIfMissing: false });
  }
  return options;
}

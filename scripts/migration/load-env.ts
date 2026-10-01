import { config } from "dotenv";
import path from "path";

config({ path: path.resolve("scripts/migration/.env.migration"), override: true });

export type Target = "homolog" | "production";

export function parseTarget(argv: string[]): Target {
  const arg = argv.find((a) => a.startsWith("--target="))?.split("=")[1];
  if (arg !== "homolog" && arg !== "production") throw new Error("Use --target=homolog ou --target=production");
  return arg;
}

export function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável ${name} ausente em scripts/migration/.env.migration`);
  return v;
}

export const SOURCE_ENDPOINT = "ep-steep-pine-ahxdon1l";

export function targetDirectUrl(target: Target): string {
  const url = required(target === "homolog" ? "HOMOLOG_DIRECT_URL" : "PRODUCTION_DIRECT_URL");
  if (url.includes(SOURCE_ENDPOINT)) throw new Error("Destino aponta para o banco ANTIGO. Abortado.");
  if (url.includes("-pooler")) throw new Error("Use a URL direta (sem -pooler) para dump/restore/validação.");
  return url;
}

// Renova o imob_homolog a partir do banco atual (Replit) e valida — rodado pelo Agendador do Windows
// a cada 10 min (tarefa "Imob-SyncHomolog"). Só LÊ o banco atual. O que foi gravado na homologação
// entre uma renovação e outra é descartado. Log em scripts/migration/dumps/sync-homolog.log.
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { dumpsToDelete, isLockStale } from "./sync-homolog-lib";

const dir = path.resolve("scripts/migration/dumps");
fs.mkdirSync(dir, { recursive: true });
const lockFile = path.join(dir, "sync-homolog.lock");
const logFile = path.join(dir, "sync-homolog.log");
const KEEP_DUMPS = 3;
const LOCK_MAX_AGE_MS = 20 * 60_000;

const log = (msg: string) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);

if (fs.existsSync(lockFile)) {
  const lockedAt = Number(fs.readFileSync(lockFile, "utf8")) || 0;
  if (!isLockStale(lockedAt, Date.now(), LOCK_MAX_AGE_MS)) {
    log("PULADO: execução anterior ainda em andamento");
    process.exit(0);
  }
  log("lock antigo ignorado (execução anterior travou)");
}
fs.writeFileSync(lockFile, String(Date.now()));

const started = Date.now();
const run = (script: string, args: string[]) =>
  execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), script, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

try {
  run("scripts/migration/copy-db.ts", ["--target=homolog"]);
  const out = run("scripts/migration/validate.ts", ["--target=homolog", "--tolerar-logs"]);
  const ok = out.includes("✅");
  log(`${ok ? "OK" : "ATENÇÃO"} em ${((Date.now() - started) / 1000).toFixed(0)}s${ok ? "" : ": " + out.slice(-300)}`);
} catch (error: any) {
  const detail = String(error?.stderr || error?.stdout || error?.message || error).replace(/postgresql:\/\/[^@\s]+@/g, "postgresql://***@");
  log(`ERRO em ${((Date.now() - started) / 1000).toFixed(0)}s: ${detail.slice(-500)}`);
  process.exitCode = 1;
} finally {
  for (const f of dumpsToDelete(fs.readdirSync(dir), KEEP_DUMPS)) fs.rmSync(path.join(dir, f), { force: true });
  fs.rmSync(lockFile, { force: true });
}

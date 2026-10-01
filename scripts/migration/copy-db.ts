import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { parseTarget, required, targetDirectUrl } from "./load-env";

const target = parseTarget(process.argv);
if (target === "production" && process.env.CONFIRM_PRODUCTION !== "SIM") {
  throw new Error("Carga em produção exige CONFIRM_PRODUCTION=SIM (somente na janela da virada).");
}
const source = required("SOURCE_DATABASE_URL");
const dest = targetDirectUrl(target);
const bin = required("PG_BIN");
const dir = path.resolve("scripts/migration/dumps");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `imob-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);

const t0 = Date.now();
console.log(`[1/2] pg_dump (somente leitura na origem) → ${file}`);
execFileSync(path.join(bin, "pg_dump"), ["--format=custom", "--no-owner", "--no-privileges", `--file=${file}`, source], { stdio: "inherit" });
const t1 = Date.now();
console.log(`      ${((t1 - t0) / 1000).toFixed(1)}s, ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`);

console.log(`[2/2] pg_restore → ${target}`);
execFileSync(path.join(bin, "pg_restore"), ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${dest}`, file], { stdio: "inherit" });
console.log(`      ${((Date.now() - t1) / 1000).toFixed(1)}s. Total ${((Date.now() - t0) / 1000).toFixed(1)}s`);

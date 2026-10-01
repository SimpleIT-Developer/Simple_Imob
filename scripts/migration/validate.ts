import { parseTarget, required, targetDirectUrl } from "./load-env";
import { diffSnapshots, takeSnapshot } from "./snapshot";

const target = parseTarget(process.argv);
const [src, dst] = await Promise.all([takeSnapshot(required("SOURCE_DATABASE_URL")), takeSnapshot(targetDirectUrl(target))]);
console.table(Object.entries(src.tables).map(([t, s]) => ({ tabela: t, origem: s.rows, destino: dst.tables[t]?.rows ?? "—" })));
// Em "somente leitura" consultas ainda gravam em system_logs; com --tolerar-logs essa tabela vira aviso.
const tolerateTables = process.argv.includes("--tolerar-logs") ? ["public.system_logs"] : [];
for (const t of tolerateTables) {
  if (src.tables[t]?.checksum !== dst.tables[t]?.checksum) {
    console.warn(`⚠️  ${t}: diferença tolerada (origem ${src.tables[t]?.rows} × destino ${dst.tables[t]?.rows} linhas)`);
  }
}
const diffs = diffSnapshots(src, dst, { tolerateTables });
if (diffs.length) {
  console.error(`\n❌ ${diffs.length} diferença(s):\n` + diffs.map((d) => " - " + d).join("\n"));
  process.exit(1);
}
console.log(`\n✅ ${target}: idêntico à origem (${Object.keys(src.tables).length} tabelas, checksums conferidos).`);

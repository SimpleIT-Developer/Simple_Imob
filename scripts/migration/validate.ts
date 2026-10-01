import { parseTarget, required, targetDirectUrl } from "./load-env";
import { diffSnapshots, takeSnapshot } from "./snapshot";

const target = parseTarget(process.argv);
const [src, dst] = await Promise.all([takeSnapshot(required("SOURCE_DATABASE_URL")), takeSnapshot(targetDirectUrl(target))]);
console.table(Object.entries(src.tables).map(([t, s]) => ({ tabela: t, origem: s.rows, destino: dst.tables[t]?.rows ?? "—" })));
const diffs = diffSnapshots(src, dst);
if (diffs.length) {
  console.error(`\n❌ ${diffs.length} diferença(s):\n` + diffs.map((d) => " - " + d).join("\n"));
  process.exit(1);
}
console.log(`\n✅ ${target}: idêntico à origem (${Object.keys(src.tables).length} tabelas, checksums conferidos).`);

import pg from "pg";

export type TableSnapshot = { columns: string[]; rows: number; checksum: string };
export type DbSnapshot = {
  tables: Record<string, TableSnapshot>;
  sequences: Record<string, string>;
  enums: Record<string, string[]>;
  indexes: string[];
  constraints: string[];
};

const IGNORED_TABLES = new Set(["public.session"]);

export async function takeSnapshot(connectionString: string): Promise<DbSnapshot> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const snap: DbSnapshot = { tables: {}, sequences: {}, enums: {}, indexes: [], constraints: [] };

    const tables = await client.query<{ s: string; t: string }>(
      `SELECT table_schema s, table_name t FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')
       ORDER BY 1, 2`,
    );
    for (const { s, t } of tables.rows) {
      const key = `${s}.${t}`;
      if (IGNORED_TABLES.has(key)) continue;
      const cols = await client.query<{ c: string }>(
        `SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') c
         FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY column_name`,
        [s, t],
      );
      const ident = `"${s.replace(/"/g, '""')}"."${t.replace(/"/g, '""')}"`;
      const agg = await client.query<{ rows: string; checksum: string }>(
        `SELECT count(*)::text rows,
                md5(coalesce(string_agg(h, '' ORDER BY h), '')) checksum
         FROM (SELECT md5(x::text) h FROM ${ident} x) q`,
      );
      snap.tables[key] = {
        columns: cols.rows.map((r) => r.c),
        rows: Number(agg.rows[0].rows),
        checksum: agg.rows[0].checksum,
      };
    }

    const seqs = await client.query<{ k: string; v: string | null }>(
      `SELECT schemaname || '.' || sequencename k, last_value::text v FROM pg_sequences ORDER BY 1`,
    );
    for (const r of seqs.rows) snap.sequences[r.k] = r.v ?? "null";

    const enums = await client.query<{ k: string; v: string }>(
      `SELECT n.nspname || '.' || t.typname k, e.enumlabel v
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
       ORDER BY 1, e.enumsortorder`,
    );
    for (const r of enums.rows) (snap.enums[r.k] ??= []).push(r.v);

    const idx = await client.query<{ v: string }>(
      `SELECT schemaname || '.' || indexname || ':' || indexdef v FROM pg_indexes
       WHERE schemaname NOT IN ('pg_catalog','information_schema') AND tablename <> 'session' ORDER BY 1`,
    );
    snap.indexes = idx.rows.map((r) => r.v);

    // PG18 registra NOT NULL como constraint ('n'); comparamos só p/f/u/c para PG16 x PG18 baterem.
    const cons = await client.query<{ v: string }>(
      `SELECT n.nspname || '.' || cl.relname || ':' || c.conname || ':' || pg_get_constraintdef(c.oid) v
       FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
       WHERE c.contype IN ('p','f','u','c') AND n.nspname NOT IN ('pg_catalog','information_schema')
         AND cl.relname <> 'session'
       ORDER BY 1`,
    );
    snap.constraints = cons.rows.map((r) => r.v);
    return snap;
  } finally {
    await client.end();
  }
}

export function diffSnapshots(source: DbSnapshot, target: DbSnapshot, opts: { tolerateTables?: string[] } = {}): string[] {
  const diffs: string[] = [];
  const tolerated = new Set(opts.tolerateTables ?? []);
  const keys = new Set([...Object.keys(source.tables), ...Object.keys(target.tables)]);
  for (const key of [...keys].sort()) {
    if (IGNORED_TABLES.has(key) || tolerated.has(key)) continue;
    const a = source.tables[key];
    const b = target.tables[key];
    if (!a) { diffs.push(`${key}: existe só no destino`); continue; }
    if (!b) { diffs.push(`${key}: faltando no destino`); continue; }
    if (a.rows !== b.rows) diffs.push(`${key}: linhas ${a.rows} → ${b.rows}`);
    if (a.checksum !== b.checksum) diffs.push(`${key}: checksum diferente`);
    if (a.columns.join("|") !== b.columns.join("|")) diffs.push(`${key}: colunas diferentes`);
  }
  for (const k of new Set([...Object.keys(source.sequences), ...Object.keys(target.sequences)])) {
    if (source.sequences[k] !== target.sequences[k]) diffs.push(`sequence ${k}: ${source.sequences[k]} → ${target.sequences[k]}`);
  }
  for (const k of new Set([...Object.keys(source.enums), ...Object.keys(target.enums)])) {
    if ((source.enums[k] ?? []).join(",") !== (target.enums[k] ?? []).join(",")) diffs.push(`enum ${k} diferente`);
  }
  const listDiff = (label: string, a: string[], b: string[]) => {
    const sa = new Set(a);
    const sb = new Set(b);
    for (const x of a) if (!sb.has(x)) diffs.push(`${label} faltando no destino: ${x}`);
    for (const x of b) if (!sa.has(x)) diffs.push(`${label} só no destino: ${x}`);
  };
  listDiff("índice", source.indexes, target.indexes);
  listDiff("constraint", source.constraints, target.constraints);
  return diffs;
}

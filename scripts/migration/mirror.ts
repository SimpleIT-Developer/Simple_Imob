// Espelho de mão única: banco atual (Replit, origem) → imob_homolog (Cloudflare homologação),
// via replicação lógica do Postgres. Uso:
//   npx tsx scripts/migration/mirror.ts setup    # cria publication na origem e subscription no imob_homolog
//   npx tsx scripts/migration/mirror.ts status   # estado e atraso do espelho
//   npx tsx scripts/migration/mirror.ts drop     # remove subscription (e o slot na origem) e a publication
// Nunca altera dados da origem: só cria/remove a publication. O destino é SEMPRE o imob_homolog.
import pg from "pg";
import { required, targetDirectUrl } from "./load-env";

const NAME = "imob_espelho";
const cmd = process.argv[2];

const sourceUrl = required("SOURCE_DATABASE_URL");
if (sourceUrl.includes("-pooler")) throw new Error("SOURCE_DATABASE_URL deve ser a URL direta (sem -pooler).");
const targetUrl = targetDirectUrl("homolog");

async function connect(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

async function assertHomolog(target: pg.Client) {
  const db = (await target.query("select current_database() d")).rows[0].d as string;
  if (db !== "imob_homolog") throw new Error(`Destino precisa ser imob_homolog (é ${db}). Abortado.`);
}

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function setup() {
  const source = await connect(sourceUrl);
  const target = await connect(targetUrl);
  try {
    await assertHomolog(target);
    const wal = (await source.query("show wal_level")).rows[0].wal_level;
    if (wal !== "logical") {
      throw new Error(`Origem com wal_level=${wal}. Ative "Logical Replication" no console Neon do projeto antigo e rode de novo.`);
    }
    const existing = await target.query("select 1 from pg_subscription where subname = $1", [NAME]);
    if (existing.rowCount) throw new Error(`Subscription ${NAME} já existe no destino. Use "status" ou "drop".`);

    const pub = await source.query("select 1 from pg_publication where pubname = $1", [NAME]);
    if (!pub.rowCount) {
      await source.query(`CREATE PUBLICATION ${NAME} FOR ALL TABLES`);
      console.log(`[origem] publication ${NAME} criada (FOR ALL TABLES).`);
    }
    const tables = (await source.query<{ s: string; t: string }>(
      "select schemaname s, tablename t from pg_publication_tables where pubname = $1 order by 1, 2", [NAME],
    )).rows;

    // A cópia inicial da subscription recarrega tudo; zera antes as tabelas espelhadas no destino.
    const list = tables.map((r) => `${quoteIdent(r.s)}.${quoteIdent(r.t)}`).join(", ");
    await target.query(`TRUNCATE ${list} CASCADE`);
    console.log(`[imob_homolog] ${tables.length} tabelas zeradas para a cópia inicial.`);

    await target.query(
      `CREATE SUBSCRIPTION ${NAME} CONNECTION '${sourceUrl.replace(/'/g, "''")}' PUBLICATION ${NAME}
       WITH (copy_data = true, create_slot = true, slot_name = '${NAME}')`,
    );
    console.log(`[imob_homolog] subscription ${NAME} criada; cópia inicial em andamento. Acompanhe com "status".`);
  } finally {
    await source.end();
    await target.end();
  }
}

async function status() {
  const source = await connect(sourceUrl);
  const target = await connect(targetUrl);
  try {
    await assertHomolog(target);
    const sub = await target.query(
      `select subname, subenabled from pg_subscription where subname = $1`, [NAME],
    );
    if (!sub.rowCount) { console.log("Espelho não configurado."); return; }
    const rel = await target.query(
      `select srsubstate st, count(*)::int n from pg_subscription_rel r join pg_subscription s on s.oid = r.srsubid
       where s.subname = $1 group by 1`, [NAME],
    );
    const states: Record<string, string> = { i: "iniciando", d: "copiando", f: "cópia concluída", s: "sincronizando", r: "pronta" };
    const stat = await target.query(
      `select max(last_msg_receipt_time) recebido, max(latest_end_time) aplicado from pg_stat_subscription where subname = $1`, [NAME],
    );
    const slot = await source.query(
      `select active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) atraso
       from pg_replication_slots where slot_name = $1`, [NAME],
    );
    console.log(`Subscription: ${sub.rows[0].subenabled ? "ativa" : "DESATIVADA"}`);
    console.log("Tabelas: " + rel.rows.map((r) => `${states[r.st] ?? r.st}=${r.n}`).join(", "));
    console.log(`Última mensagem recebida: ${stat.rows[0].recebido ?? "-"} · último commit aplicado: ${stat.rows[0].aplicado ?? "-"}`);
    console.log(`Slot na origem: ${slot.rowCount ? `${slot.rows[0].active ? "conectado" : "DESCONECTADO"}, atraso ${slot.rows[0].atraso}` : "inexistente"}`);
  } finally {
    await source.end();
    await target.end();
  }
}

async function drop() {
  const target = await connect(targetUrl);
  const source = await connect(sourceUrl);
  try {
    await assertHomolog(target);
    const sub = await target.query("select 1 from pg_subscription where subname = $1", [NAME]);
    if (sub.rowCount) {
      await target.query(`DROP SUBSCRIPTION ${NAME}`); // também remove o slot na origem
      console.log(`[imob_homolog] subscription ${NAME} removida (slot na origem removido junto).`);
    }
    const slot = await source.query("select active from pg_replication_slots where slot_name = $1", [NAME]);
    if (slot.rowCount && !slot.rows[0].active) {
      await source.query("select pg_drop_replication_slot($1)", [NAME]);
      console.log(`[origem] slot ${NAME} órfão removido.`);
    }
    const pub = await source.query("select 1 from pg_publication where pubname = $1", [NAME]);
    if (pub.rowCount) {
      await source.query(`DROP PUBLICATION ${NAME}`);
      console.log(`[origem] publication ${NAME} removida.`);
    }
  } finally {
    await target.end();
    await source.end();
  }
}

if (cmd === "setup") await setup();
else if (cmd === "status") await status();
else if (cmd === "drop") await drop();
else throw new Error("Use: mirror.ts setup | status | drop");

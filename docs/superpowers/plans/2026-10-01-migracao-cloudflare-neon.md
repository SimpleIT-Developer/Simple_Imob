# Migração Cloudflare + Neon SP — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar o Imob_Simple rodando em `imob.simpleit.app.br` / `api.imob.simpleit.app.br` (Cloudflare Workers + Container) sobre Neon sa-east-1, em paralelo ao Replit, e fazer a virada sem perda de dados.

**Architecture:** `imob-web` (Worker + assets do Vite) e `imob-api` (Worker Hono) na Cloudflare; o `imob-api` repassa tudo a um Cloudflare Container de instância única que roda o Express atual (Node 20 + Chromium). Toda mudança no código Express fica atrás de variável de ambiente cujo valor ausente reproduz o comportamento atual, porque o Replit publica a partir do mesmo repositório.

**Tech Stack:** Node 20, Express 5, Drizzle/pg, React/Vite, Hono, `@cloudflare/containers`, Wrangler 4, Neon Postgres 18, `pg_dump`/`pg_restore` 18, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-01-migracao-cloudflare-neon-design.md`

## Global Constraints

- **Nada altera o Replit nem o banco antigo** (`ep-steep-pine-ahxdon1l`, us-east-1, PG16) antes da Task 11. O banco antigo só é lido.
- Toda mudança no servidor/cliente: **variável ausente = comportamento idêntico ao atual**.
- **Nunca** rodar o app contra qualquer cópia de banco sem `SIDE_EFFECTS_ENABLED=false`. O `.env` local aponta para a **produção antiga**: todo comando local deste plano sobrescreve `DATABASE_URL` para a branch `homolog`.
- Branch Neon `homolog` para testes; branch `main` do Neon SP (`ep-wild-mountain-b68tblk0`) recebe **somente** a carga final da Task 11.
- `pg_dump`/`pg_restore` usam o host **sem** `-pooler`; o app usa o host **com** `-pooler`.
- Hosts: web `imob.simpleit.app.br`, API `api.imob.simpleit.app.br`, zona `simpleit.app.br`.
- Workers: nomes `imob-web`, `imob-api`; classe do Container `ImobServer`, binding `IMOB_SERVER`, instância `"main"`, `max_instances: 1`, `instance_type: "standard-1"`, porta `8080`.
- Cookie de sessão no Container: `secure: true`, `sameSite: "lax"`, host-only.
- `.env`, `cert/*` e `webhook_sicoob.log` **continuam no Git até a Task 12** (removê-los antes quebraria o Replit).
- Trabalho na branch Git `migracao-cloudflare`; merge em `main` só na Task 11.
- Testes: `npx tsx --test <arquivo>` (padrão de `server/services/dimobReport.test.ts`).

## Review Focus

1. **Emissão real a partir da homologação** — qualquer caminho (rota, worker, cron, reprocessamento) que chegue a `emitirNfse`/`cancelarNfse`/`emitirBoleto`/PIX com `SIDE_EFFECTS_ENABLED=false` deve falhar antes da rede. Coberto na Task 2 com interceptor de axios que derruba o teste se houver chamada.
2. **Replit muda de comportamento após o merge** — sem nenhuma variável nova, sessão, cookie, estáticos, fetch do cliente e worker devem ser idênticos. Coberto nas Tasks 3, 5 e 6 com testes do caminho "sem variáveis".
3. **Login perdido entre `imob.` e `api.imob.`** — cookie não enviado em `fetch` cross-origin ou em `window.open`. Coberto na Task 6 (o wrapper força `credentials: "include"`) e na Task 10 (checklist manual).
4. **Cópia de banco incompleta ou divergente (PG16→PG18)** — linhas, sequences, enums, índices, constraints. Coberto na Task 1 (`validate.ts` com checksum por tabela e testes de `diffSnapshots`).
5. **Webhook do Sicoob perdido na virada** — durante `READ_ONLY` responde 503 (o Sicoob reenvia); após a virada, o proxy legado entrega no novo. Coberto na Task 5 (teste de proxy preservando corpo e status) e no runbook da Task 11.

---

### Task 0: Preparação (branch, ferramentas, acessos)

**Files:** nenhum arquivo de código.

- [ ] **Step 1: Criar a branch de trabalho sem levar as alterações pendentes do DIMOB**

As alterações não commitadas em `main` (DIMOB) são do usuário. Pergunte se ele quer commitá-las antes; **não** as inclua nos commits desta migração.

```bash
git switch -c migracao-cloudflare
```

- [ ] **Step 2: Instalar o cliente PostgreSQL 18 (só binários de cliente)**

```powershell
winget install -e --id PostgreSQL.PostgreSQL.18 --override "--mode unattended --disable-components server,pgAdmin,stackbuilder"
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" --version
```
Expected: `pg_dump (PostgreSQL) 18.x`

- [ ] **Step 3: Criar a branch `homolog` no Neon SP (ação do usuário)**

No console Neon do projeto novo: Branches → Create branch → nome `homolog`, a partir de `main`. Copiar as duas connection strings (com e sem `-pooler`) e guardar em `scripts/migration/.env.migration` (arquivo **não versionado**):

```
SOURCE_DATABASE_URL=postgresql://neondb_owner:...@ep-steep-pine-ahxdon1l.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
HOMOLOG_DIRECT_URL=postgresql://...@ep-XXXX.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require
HOMOLOG_POOLER_URL=postgresql://...@ep-XXXX-pooler.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require
PRODUCTION_DIRECT_URL=postgresql://neondb_owner:...@ep-wild-mountain-b68tblk0.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require
PRODUCTION_POOLER_URL=postgresql://neondb_owner:...@ep-wild-mountain-b68tblk0-pooler.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require
PG_BIN=C:\Program Files\PostgreSQL\18\bin
```

Adicionar ao `.gitignore`:
```
scripts/migration/.env.migration
scripts/migration/dumps/
```

- [ ] **Step 4: Conferir acesso Cloudflare e decidir como buildar o Container**

```bash
npx wrangler@4 whoami
```
Expected: conta que contém a zona `simpleit.app.br`; plano Workers Paid (exigido por Containers).

O `wrangler deploy` do Container exige Docker. Perguntar ao usuário: **(a)** instalar Docker Desktop nesta máquina (deploy direto daqui) ou **(b)** Workers Builds conectado ao GitHub na branch `migracao-cloudflare`. Registrar a escolha no topo deste plano.

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore: ignorar artefatos locais da migração"
```

---

### Task 1: Cópia e validação do banco (ensaio em `homolog`)

**Files:**
- Create: `scripts/migration/load-env.ts`
- Create: `scripts/migration/copy-db.ts`
- Create: `scripts/migration/snapshot.ts`
- Create: `scripts/migration/validate.ts`
- Test: `scripts/migration/snapshot.test.ts`

**Interfaces:**
- Produces: `npx tsx scripts/migration/copy-db.ts --target=homolog|production`; `npx tsx scripts/migration/validate.ts --target=homolog|production` (exit 0 = idêntico); `diffSnapshots(a: DbSnapshot, b: DbSnapshot): string[]`.

- [ ] **Step 1: Teste de `diffSnapshots`**

`scripts/migration/snapshot.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots, type DbSnapshot } from "./snapshot";

const base: DbSnapshot = {
  tables: { "public.users": { columns: ["id:character varying:NO:gen_random_uuid()"], rows: 5, checksum: "abc" } },
  sequences: { "public.x_seq": "10" },
  enums: { "public.property_status": ["available", "rented"] },
  indexes: ["public.users_pkey:CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)"],
  constraints: ["public.users:users_pkey:PRIMARY KEY (id)"],
};

test("snapshots iguais não geram diferenças", () => {
  assert.deepEqual(diffSnapshots(base, structuredClone(base)), []);
});

test("detecta contagem, checksum, sequence, enum, índice e tabela faltando", () => {
  const target = structuredClone(base);
  target.tables["public.users"].rows = 4;
  target.tables["public.users"].checksum = "zzz";
  target.sequences["public.x_seq"] = "9";
  target.enums["public.property_status"] = ["available"];
  target.indexes = [];
  target.tables["public.extra"] = { columns: [], rows: 0, checksum: "" };
  const diffs = diffSnapshots(base, target);
  assert.ok(diffs.some((d) => d.includes("public.users") && d.includes("linhas")));
  assert.ok(diffs.some((d) => d.includes("checksum")));
  assert.ok(diffs.some((d) => d.includes("public.x_seq")));
  assert.ok(diffs.some((d) => d.includes("property_status")));
  assert.ok(diffs.some((d) => d.includes("users_pkey")));
  assert.ok(diffs.some((d) => d.includes("public.extra")));
});

test("ignora a tabela de sessão, que só existe no destino", () => {
  const target = structuredClone(base);
  target.tables["public.session"] = { columns: [], rows: 3, checksum: "s" };
  assert.deepEqual(diffSnapshots(base, target), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test scripts/migration/snapshot.test.ts`
Expected: FAIL — `Cannot find module './snapshot'`

- [ ] **Step 3: Implementar `snapshot.ts`**

```ts
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

export function diffSnapshots(source: DbSnapshot, target: DbSnapshot): string[] {
  const diffs: string[] = [];
  const keys = new Set([...Object.keys(source.tables), ...Object.keys(target.tables)]);
  for (const key of [...keys].sort()) {
    if (IGNORED_TABLES.has(key)) continue;
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
    const sa = new Set(a); const sb = new Set(b);
    for (const x of a) if (!sb.has(x)) diffs.push(`${label} faltando no destino: ${x}`);
    for (const x of b) if (!sa.has(x)) diffs.push(`${label} só no destino: ${x}`);
  };
  listDiff("índice", source.indexes, target.indexes);
  listDiff("constraint", source.constraints, target.constraints);
  return diffs;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test scripts/migration/snapshot.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Implementar `load-env.ts`, `copy-db.ts` e `validate.ts`**

`scripts/migration/load-env.ts`:
```ts
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
```

`scripts/migration/copy-db.ts`:
```ts
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
```

`scripts/migration/validate.ts`:
```ts
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
```

- [ ] **Step 6: Ensaio real em `homolog`**

Run: `npx tsx scripts/migration/copy-db.ts --target=homolog`
Expected: dump e restore sem erro; anotar os tempos.

Run: `npx tsx scripts/migration/validate.ts --target=homolog`
Expected: `✅ homolog: idêntico à origem (22 tabelas, ...)`. Como o Replit continua gravando, diferenças em `system_logs`/`audit_logs` entre o dump e a validação são esperadas: rode a validação logo após a cópia e investigue qualquer diferença fora dessas tabelas. Se a diferença for de formato PG16×PG18 (não de dado), ajuste a query do snapshot e documente.

- [ ] **Step 7: Commit**

```bash
git add scripts/migration/*.ts
git commit -m "feat(migracao): scripts de cópia e validação do banco"
```

---

### Task 2: Trava de efeitos externos (`SIDE_EFFECTS_ENABLED`)

**Files:**
- Create: `server/services/sideEffects.ts`
- Modify: `server/providers/SicoobProvider.ts` (`emitirBoleto` ~L175, `initiatePixPayment` ~L234, `confirmPixPayment` ~L312, `confirmPixPaymentByAccount` ~L396)
- Modify: `server/providers/NfseNationalProvider.ts` (`emitirNfse` ~L1120, `cancelarNfse` ~L1345)
- Modify: `server/services/nfseWorker.ts` (`start`, novo `tick`)
- Test: `server/services/sideEffects.test.ts`

**Interfaces:**
- Produces: `sideEffectsEnabled(env?): boolean`, `assertSideEffectsAllowed(action: string, env?): void`, `class SideEffectBlockedError extends Error`, `nfseWorker.tick(): Promise<void>`.

- [ ] **Step 1: Teste**

`server/services/sideEffects.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

process.env.SIDE_EFFECTS_ENABLED = "false";
process.env.DATABASE_URL = "postgres://invalid:invalid@127.0.0.1:1/none";

// Qualquer chamada de rede derruba o teste: a trava tem que agir ANTES do axios.
axios.interceptors.request.use(() => { throw new Error("REDE CHAMADA"); });

const { sideEffectsEnabled, SideEffectBlockedError } = await import("./sideEffects");
const { sicoobProvider } = await import("../providers/SicoobProvider");
const { nfseProvider } = await import("../providers/NfseNationalProvider");

test("sem variáveis, efeitos ficam ligados (comportamento atual do Replit)", () => {
  assert.equal(sideEffectsEnabled({}), true);
});

test("SIDE_EFFECTS_ENABLED=false ou READ_ONLY=true desligam efeitos", () => {
  assert.equal(sideEffectsEnabled({ SIDE_EFFECTS_ENABLED: "false" }), false);
  assert.equal(sideEffectsEnabled({ READ_ONLY: "true" }), false);
});

const blocked = (p: Promise<unknown>) => assert.rejects(p, (e: unknown) => e instanceof SideEffectBlockedError);

test("Sicoob: boleto e PIX bloqueados antes da rede", async () => {
  await blocked(sicoobProvider.emitirBoleto({}));
  await blocked(sicoobProvider.initiatePixPayment("chave"));
  await blocked(sicoobProvider.confirmPixPayment("e2e", 1, "x"));
  await blocked((sicoobProvider as any).confirmPixPaymentByAccount({}, 1, "x"));
});

test("NFS-e: emissão e cancelamento bloqueados antes do banco e da rede", async () => {
  await blocked(nfseProvider.emitirNfse("id"));
  await blocked(nfseProvider.cancelarNfse("id", "motivo"));
});
```

Antes de escrever o teste, confirme a assinatura real de `confirmPixPaymentByAccount` (`server/providers/SicoobProvider.ts:396`) e o nome do export da instância em `NfseNationalProvider.ts` (o `nfseWorker` importa `nfseProvider`). Ajuste a chamada do teste aos parâmetros reais.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test server/services/sideEffects.test.ts`
Expected: FAIL — `Cannot find module './sideEffects'`

- [ ] **Step 3: Implementar**

`server/services/sideEffects.ts`:
```ts
export class SideEffectBlockedError extends Error {
  constructor(action: string) {
    super(`Bloqueado neste ambiente (homologação/manutenção): ${action} não é executado.`);
    this.name = "SideEffectBlockedError";
  }
}

export function sideEffectsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SIDE_EFFECTS_ENABLED !== "false" && env.READ_ONLY !== "true";
}

export function assertSideEffectsAllowed(action: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!sideEffectsEnabled(env)) throw new SideEffectBlockedError(action);
}
```

Em cada método listado, **primeira linha do corpo** (antes de qualquer `try`, `initialize` ou token):
```ts
assertSideEffectsAllowed("Sicoob emitirBoleto");
```
(com o nome de cada ação: `"Sicoob initiatePixPayment"`, `"Sicoob confirmPixPayment"`, `"Sicoob confirmPixPaymentByAccount"`, `"NFS-e emitirNfse"`, `"NFS-e cancelarNfse"`) e o import:
```ts
import { assertSideEffectsAllowed } from "../services/sideEffects";
```

Em `server/services/nfseWorker.ts`:
```ts
import { sideEffectsEnabled } from "./sideEffects";
```
No início de `start()`:
```ts
    if (!sideEffectsEnabled()) {
      console.log("[NfseWorker] Efeitos externos desligados neste ambiente; worker não iniciado.");
      return;
    }
```
Novo método público, abaixo de `pauseTemporarily`:
```ts
  async tick(): Promise<void> {
    if (!sideEffectsEnabled()) return;
    await this.processQueue();
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test server/services/sideEffects.test.ts`
Expected: PASS (4 testes), sem `REDE CHAMADA`.

Run: `npx tsc`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add server/services/sideEffects.ts server/services/sideEffects.test.ts server/services/nfseWorker.ts server/providers/SicoobProvider.ts server/providers/NfseNationalProvider.ts
git commit -m "feat: trava SIDE_EFFECTS_ENABLED para NFS-e, boleto e PIX"
```

---

### Task 3: Runtime do servidor para o Container (sessão, estáticos, health, tick)

**Files:**
- Create: `server/sessionConfig.ts`
- Create: `server/internalRoutes.ts`
- Modify: `server/db.ts` (nova `ensureSessionTable`)
- Modify: `server/routes.ts:2523-2534` (bloco `session({...})`)
- Modify: `server/index.ts` (trust proxy, ensureSessionTable, rotas internas, `SERVE_STATIC`)
- Test: `server/sessionConfig.test.ts`, `server/internalRoutes.test.ts`

**Interfaces:**
- Consumes: `nfseWorker.tick()` (Task 2), `pool` de `server/db.ts`.
- Produces: `buildSessionOptions(env, pool): session.SessionOptions`; `registerInternalRoutes(app, deps: { tick(): Promise<void>; pingDb(): Promise<void>; token: string | undefined })`; rotas `GET /api/health`, `POST /internal/tick` (header `x-internal-token`).

- [ ] **Step 1: Testes**

`server/sessionConfig.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buildSessionOptions } from "./sessionConfig";

const pool = new pg.Pool({ connectionString: "postgres://x:x@127.0.0.1:1/x" });

test("sem variáveis: idêntico ao atual (memória, cookie não-secure)", () => {
  const o = buildSessionOptions({}, pool);
  assert.equal(o.store, undefined);
  assert.equal(o.secret, "imobiliaria-simples-secret-key");
  assert.deepEqual(o.cookie, { secure: false, httpOnly: true, maxAge: 86400000 });
  assert.equal(o.resave, false);
  assert.equal(o.saveUninitialized, false);
});

test("Container: store Postgres e cookie secure + lax", () => {
  const o = buildSessionOptions({ SESSION_STORE: "pg", SESSION_COOKIE_SECURE: "true", SESSION_SECRET: "s3cr3t" }, pool);
  assert.ok(o.store);
  assert.equal(o.secret, "s3cr3t");
  assert.deepEqual(o.cookie, { secure: true, httpOnly: true, maxAge: 86400000, sameSite: "lax" });
});

test("store Postgres sem SESSION_SECRET é recusado", () => {
  assert.throws(() => buildSessionOptions({ SESSION_STORE: "pg" }, pool), /SESSION_SECRET/);
});
```

`server/internalRoutes.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import { registerInternalRoutes } from "./internalRoutes";

async function start(deps: Parameters<typeof registerInternalRoutes>[1]) {
  const app = express();
  app.use(express.json());
  registerInternalRoutes(app, deps);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => server.close() };
}

test("tick exige token e chama o worker", async () => {
  let ticks = 0;
  const s = await start({ tick: async () => { ticks++; }, pingDb: async () => {}, token: "t0k" });
  try {
    assert.equal((await fetch(`${s.base}/internal/tick`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${s.base}/internal/tick`, { method: "POST", headers: { "x-internal-token": "errado" } })).status, 401);
    assert.equal((await fetch(`${s.base}/internal/tick`, { method: "POST", headers: { "x-internal-token": "t0k" } })).status, 200);
    assert.equal(ticks, 1);
  } finally { s.close(); }
});

test("sem INTERNAL_TOKEN a rota de tick não existe (Replit)", async () => {
  const s = await start({ tick: async () => {}, pingDb: async () => {}, token: undefined });
  try {
    assert.equal((await fetch(`${s.base}/internal/tick`, { method: "POST" })).status, 404);
  } finally { s.close(); }
});

test("health reflete o banco", async () => {
  const ok = await start({ tick: async () => {}, pingDb: async () => {}, token: undefined });
  const bad = await start({ tick: async () => {}, pingDb: async () => { throw new Error("down"); }, token: undefined });
  try {
    assert.equal((await fetch(`${ok.base}/api/health`)).status, 200);
    assert.equal((await fetch(`${bad.base}/api/health`)).status, 503);
  } finally { ok.close(); bad.close(); }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test server/sessionConfig.test.ts server/internalRoutes.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar**

`server/sessionConfig.ts`:
```ts
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
```

`server/internalRoutes.ts`:
```ts
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
```

Em `server/db.ts`, acrescentar:
```ts
export async function ensureSessionTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`);
  } finally {
    client.release();
  }
}
```

Em `server/routes.ts`, substituir o bloco `app.use(session({ ... }))` (L2523-2534) por:
```ts
  app.use(session(buildSessionOptions(process.env, pool)));
```
com imports `import { buildSessionOptions } from "./sessionConfig";` e `import { pool } from "./db";` (verifique se `pool` já é importado de `./db`; se for, só acrescente o nome).

Em `server/index.ts`:
- logo após `const app = express();`:
```ts
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}
```
- importar `ensureSessionTable`, `pool` de `./db`, `registerInternalRoutes` de `./internalRoutes`;
- no bloco async, antes de `await registerRoutes(...)`:
```ts
  if (process.env.SESSION_STORE === "pg") {
    await ensureSessionTable();
  }
  registerInternalRoutes(app, {
    tick: () => nfseWorker.tick(),
    pingDb: async () => { await pool.query("select 1"); },
    token: process.env.INTERNAL_TOKEN,
  });
```
- trocar `if (process.env.NODE_ENV === "production") { serveStatic(app); }` por:
```ts
  if (process.env.NODE_ENV === "production") {
    if (process.env.SERVE_STATIC !== "false") {
      serveStatic(app);
    }
  } else {
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test server/sessionConfig.test.ts server/internalRoutes.test.ts`
Expected: PASS (6 testes)

Run: `npx tsc`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add server/sessionConfig.ts server/sessionConfig.test.ts server/internalRoutes.ts server/internalRoutes.test.ts server/db.ts server/routes.ts server/index.ts
git commit -m "feat: sessão Postgres, health e tick interno atrás de variáveis"
```

---

### Task 4: Certificado do Sicoob via secret

**Files:**
- Create: `server/providers/pfxSource.ts`
- Modify: `server/providers/SicoobProvider.ts:60-79` (`loadCert`)
- Test: `server/providers/pfxSource.test.ts`

**Interfaces:**
- Produces: `resolveSicoobPfx(env, readFile: (p: string) => Buffer | null): { pfx: Buffer; passphrase: string; source: "env" | "file" } | null`.

- [ ] **Step 1: Teste**

`server/providers/pfxSource.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSicoobPfx } from "./pfxSource";

const file = Buffer.from("arquivo");
const readFile = () => file;

test("sem variáveis usa o arquivo cert/ e senha 1234 (comportamento atual)", () => {
  assert.deepEqual(resolveSicoobPfx({}, readFile), { pfx: file, passphrase: "1234", source: "file" });
});

test("SICOOB_CERT_PFX_B64 tem prioridade", () => {
  const r = resolveSicoobPfx({ SICOOB_CERT_PFX_B64: Buffer.from("sicoob").toString("base64"), SICOOB_CERT_PFX_PASSPHRASE: "x" }, readFile);
  assert.equal(r?.pfx.toString(), "sicoob");
  assert.equal(r?.passphrase, "x");
  assert.equal(r?.source, "env");
});

test("cai para NFSE_CERT_PFX_B64 (mesmo certificado da imobiliária)", () => {
  const r = resolveSicoobPfx({ NFSE_CERT_PFX_B64: Buffer.from("nfse").toString("base64"), NFSE_CERT_PFX_PASSPHRASE: "y" }, readFile);
  assert.equal(r?.pfx.toString(), "nfse");
  assert.equal(r?.passphrase, "y");
});

test("sem variável e sem arquivo retorna null", () => {
  assert.equal(resolveSicoobPfx({}, () => null), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test server/providers/pfxSource.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`server/providers/pfxSource.ts`:
```ts
import path from "path";

export const DEFAULT_PFX_PATH = path.join(process.cwd(), "cert", "IMOBILIARIA_SIMOES_LTDA_1009005362.pfx");

export function resolveSicoobPfx(
  env: NodeJS.ProcessEnv,
  readFile: (p: string) => Buffer | null,
): { pfx: Buffer; passphrase: string; source: "env" | "file" } | null {
  const b64 = env.SICOOB_CERT_PFX_B64?.trim() || env.NFSE_CERT_PFX_B64?.trim();
  if (b64) {
    const passphrase = env.SICOOB_CERT_PFX_B64?.trim()
      ? env.SICOOB_CERT_PFX_PASSPHRASE || "1234"
      : env.NFSE_CERT_PFX_PASSPHRASE || "1234";
    return { pfx: Buffer.from(b64, "base64"), passphrase, source: "env" };
  }
  const pfx = readFile(DEFAULT_PFX_PATH);
  return pfx ? { pfx, passphrase: "1234", source: "file" } : null;
}
```

Substituir o corpo de `loadCert()` em `SicoobProvider.ts`:
```ts
  private loadCert() {
    try {
      const resolved = resolveSicoobPfx(process.env, (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null));
      if (!resolved) {
        console.warn("Certificado PFX não encontrado em:", DEFAULT_PFX_PATH);
        return;
      }
      this.certPfx = resolved.pfx;
      this.httpsAgent = new https.Agent({
        pfx: this.certPfx,
        passphrase: resolved.passphrase,
        rejectUnauthorized: false // Sicoob production might need this true, but usually false avoids chain issues in some envs
      });
      console.log(`Certificado Sicoob carregado com sucesso (${resolved.source}).`);
    } catch (e) {
      console.error("Erro ao carregar certificado Sicoob:", e);
    }
  }
```
com `import { DEFAULT_PFX_PATH, resolveSicoobPfx } from "./pfxSource";`. Remova o import de `path` só se ele não for mais usado no arquivo.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test server/providers/pfxSource.test.ts server/services/sideEffects.test.ts`
Expected: PASS

Run: `npx tsc`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add server/providers/pfxSource.ts server/providers/pfxSource.test.ts server/providers/SicoobProvider.ts
git commit -m "feat: certificado Sicoob via secret com fallback para o arquivo atual"
```

---

### Task 5: Modos do Replit para a virada (`READ_ONLY` e modo legado)

**Files:**
- Create: `server/cutoverModes.ts`
- Modify: `server/index.ts` (registrar os middlewares **antes** de `express.json`)
- Test: `server/cutoverModes.test.ts`

**Interfaces:**
- Produces: `isWriteBlocked(method, path, env?): boolean`; `decideLegacyAction(path, env?): "none" | "proxy" | "redirect" | "gone"`; `cutoverMiddleware(env?)` (Express middleware).

- [ ] **Step 1: Teste**

`server/cutoverModes.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import { cutoverMiddleware, decideLegacyAction, isWriteBlocked } from "./cutoverModes";

test("sem variáveis nada é bloqueado nem redirecionado", () => {
  assert.equal(isWriteBlocked("POST", "/api/receipts", {}), false);
  assert.equal(decideLegacyAction("/api/receipts", {}), "none");
});

test("READ_ONLY bloqueia escrita e mantém leitura e login", () => {
  const env = { READ_ONLY: "true" };
  assert.equal(isWriteBlocked("GET", "/api/receipts", env), false);
  assert.equal(isWriteBlocked("POST", "/api/receipts", env), true);
  assert.equal(isWriteBlocked("DELETE", "/api/receipts/1", env), true);
  assert.equal(isWriteBlocked("POST", "/webhook/sicoob", env), true);
  assert.equal(isWriteBlocked("POST", "/api/auth/login", env), false);
  assert.equal(isWriteBlocked("POST", "/api/auth/logout", env), false);
  assert.equal(isWriteBlocked("POST", "/api/auth/2fa/login", env), false);
});

test("modo legado: proxy para webhook e links públicos, 410 para API, redirect para páginas", () => {
  const env = { LEGACY_REDIRECT_URL: "https://imob.simpleit.app.br", LEGACY_PROXY_API_URL: "https://api.imob.simpleit.app.br" };
  assert.equal(decideLegacyAction("/webhook/sicoob", env), "proxy");
  assert.equal(decideLegacyAction("/api/public/receipts/1/boleto", env), "proxy");
  assert.equal(decideLegacyAction("/api/receipts", env), "gone");
  assert.equal(decideLegacyAction("/recibos", env), "redirect");
});

test("modo legado ponta a ponta: proxy preserva método, corpo e status; redirect mantém caminho", async () => {
  const upstream = express();
  upstream.post("/webhook/sicoob", express.raw({ type: "*/*" }), (req, res) => {
    res.status(202).json({ got: (req.body as Buffer).toString(), ct: req.get("content-type") });
  });
  const up = upstream.listen(0);
  const upUrl = `http://127.0.0.1:${(up.address() as AddressInfo).port}`;

  const legacy = express();
  legacy.use(cutoverMiddleware({ LEGACY_REDIRECT_URL: "https://imob.simpleit.app.br", LEGACY_PROXY_API_URL: upUrl }));
  legacy.use((_req, res) => res.status(599).send("não deveria chegar aqui"));
  const lg = legacy.listen(0);
  const lgUrl = `http://127.0.0.1:${(lg.address() as AddressInfo).port}`;

  try {
    const r = await fetch(`${lgUrl}/webhook/sicoob`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"pix":[1]}' });
    assert.equal(r.status, 202);
    assert.deepEqual(await r.json(), { got: '{"pix":[1]}', ct: "application/json" });

    const red = await fetch(`${lgUrl}/recibos?ano=2026`, { redirect: "manual" });
    assert.equal(red.status, 302);
    assert.equal(red.headers.get("location"), "https://imob.simpleit.app.br/recibos?ano=2026");

    const gone = await fetch(`${lgUrl}/api/receipts`);
    assert.equal(gone.status, 410);
  } finally { up.close(); lg.close(); }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test server/cutoverModes.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`server/cutoverModes.ts`:
```ts
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
```

Em `server/index.ts`, logo após o bloco de `trust proxy` (antes de `app.use(express.json(...))`):
```ts
app.use(cutoverMiddleware());
```
com `import { cutoverMiddleware } from "./cutoverModes";`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test server/cutoverModes.test.ts`
Expected: PASS (4 testes)

Run: `npx tsc`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add server/cutoverModes.ts server/cutoverModes.test.ts server/index.ts
git commit -m "feat: modos READ_ONLY e legado para a virada do Replit"
```

---

### Task 6: Frontend com API em outro host (`VITE_API_URL`)

**Files:**
- Create: `client/src/lib/api-url.ts` (pura, testável em Node)
- Create: `client/src/lib/api-base.ts` (usa `import.meta.env`)
- Modify: `client/src/main.tsx`
- Modify: `client/src/pages/invoices.tsx:456,899,925`
- Modify: `client/src/pages/receipts.tsx:1476,1849,1951`
- Test: `client/src/lib/api-url.test.ts`

**Interfaces:**
- Produces: `resolveApiUrl(path: string, base: string): string`; `apiUrl(path)`, `absoluteApiUrl(path)`, `installApiFetch()`.

- [ ] **Step 1: Teste**

`client/src/lib/api-url.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiUrl } from "./api-url";

test("base vazia mantém a URL relativa (Replit/dev)", () => {
  assert.equal(resolveApiUrl("/api/receipts", ""), "/api/receipts");
});

test("prefixa somente caminhos /api", () => {
  const base = "https://api.imob.simpleit.app.br/";
  assert.equal(resolveApiUrl("/api/receipts?x=1", base), "https://api.imob.simpleit.app.br/api/receipts?x=1");
  assert.equal(resolveApiUrl("/api", base), "https://api.imob.simpleit.app.br/api");
  assert.equal(resolveApiUrl("/apiary", base), "/apiary");
  assert.equal(resolveApiUrl("/recibos", base), "/recibos");
  assert.equal(resolveApiUrl("https://viacep.com.br/ws/1/json", base), "https://viacep.com.br/ws/1/json");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test client/src/lib/api-url.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

`client/src/lib/api-url.ts`:
```ts
export function resolveApiUrl(path: string, base: string): string {
  if (!base) return path;
  const isApi = path === "/api" || path.startsWith("/api/") || path.startsWith("/api?");
  return isApi ? base.replace(/\/+$/, "") + path : path;
}
```

`client/src/lib/api-base.ts`:
```ts
import { resolveApiUrl } from "./api-url";

const API_BASE: string = import.meta.env.VITE_API_URL ?? "";

export function apiUrl(path: string): string {
  return resolveApiUrl(path, API_BASE);
}

export function absoluteApiUrl(path: string): string {
  return new URL(apiUrl(path), window.location.origin).toString();
}

// Com a API em outro host, todo fetch("/api/...") do app vai para VITE_API_URL levando o cookie de sessão.
export function installApiFetch(): void {
  if (!API_BASE) return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      const resolved = resolveApiUrl(input, API_BASE);
      if (resolved !== input) return original(resolved, { ...init, credentials: "include" });
    }
    return original(input, init);
  };
}
```

`client/src/main.tsx`:
```tsx
import { createRoot } from "react-dom/client";
import AppRoot from "./AppRoot";
import { installApiFetch } from "./lib/api-base";
import "./index.css";

installApiFetch();

console.log("Main mounting via AppRoot...");
createRoot(document.getElementById("root")!).render(<AppRoot />);
```

Nas páginas, importar `import { apiUrl, absoluteApiUrl } from "@/lib/api-base";` e trocar:
- `invoices.tsx:456`: `` `${window.location.origin}/api/public/nfse/danfse/${emissao.chaveAcesso}` `` → `` absoluteApiUrl(`/api/public/nfse/danfse/${emissao.chaveAcesso}`) ``
- `invoices.tsx:899`: `` window.open(`/api/nfse/emissoes/${emissao.id}/xml`, '_blank') `` → `` window.open(apiUrl(`/api/nfse/emissoes/${emissao.id}/xml`), '_blank') ``
- `invoices.tsx:925`: `` window.open(`/api/nfse/danfse/${emissao.chaveAcesso}`, '_blank') `` → `` window.open(apiUrl(`/api/nfse/danfse/${emissao.chaveAcesso}`), '_blank') ``
- `receipts.tsx:1476`: `` `${window.location.origin}/api/public/receipts/${receipt.id}/boleto` `` → `` absoluteApiUrl(`/api/public/receipts/${receipt.id}/boleto`) ``
- `receipts.tsx:1849` e `:1951`: `` window.open(`/api/receipts/${receipt.id}/boleto-pdf`, '_blank') `` → `` window.open(apiUrl(`/api/receipts/${receipt.id}/boleto-pdf`), '_blank') ``

Confirmar que não sobrou nenhum uso fora do `fetch`:
```bash
grep -rnE "window\.open\([^)]*['\"\`]/api|location\.origin\}?/api|href=\{?['\"\`]/api|src=\{?['\"\`]/api" client/src
```
Expected: nenhuma linha. Se aparecer alguma, aplique `apiUrl`/`absoluteApiUrl` do mesmo jeito.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test client/src/lib/api-url.test.ts`
Expected: PASS

Run: `npx tsc && npx vite build`
Expected: build ok.

- [ ] **Step 5: Regressão local "como Replit" (sem variáveis novas, contra homolog, efeitos desligados)**

```powershell
$env:DATABASE_URL = (Select-String -Path scripts/migration/.env.migration -Pattern '^HOMOLOG_POOLER_URL=(.*)').Matches[0].Groups[1].Value
$env:SIDE_EFFECTS_ENABLED = "false"
npm run dev
```
Expected: abre em `http://localhost:5000`, login funciona, telas carregam, log mostra `[NfseWorker] Efeitos externos desligados`. Encerrar com Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/api-url.ts client/src/lib/api-url.test.ts client/src/lib/api-base.ts client/src/main.tsx client/src/pages/invoices.tsx client/src/pages/receipts.tsx
git commit -m "feat(client): API em host separado via VITE_API_URL"
```

---

### Task 7: Imagem do Container e Worker `imob-api`

**Files:**
- Modify: `script/build.ts` (flag `--server-only`)
- Modify: `package.json` (scripts `build:server`, `build:web`)
- Create: `Dockerfile`, `.dockerignore`
- Create: `cloudflare/api/package.json`, `cloudflare/api/tsconfig.json`, `cloudflare/api/wrangler.jsonc`
- Create: `cloudflare/api/src/index.ts`, `cloudflare/api/src/forward.ts`
- Create: `cloudflare/api/.dev.vars.example`
- Test: `cloudflare/api/src/forward.test.ts`

**Interfaces:**
- Consumes: `GET /api/health`, `POST /internal/tick` + `x-internal-token` (Task 3); variáveis `SESSION_STORE`, `SESSION_COOKIE_SECURE`, `TRUST_PROXY`, `SERVE_STATIC`, `SIDE_EFFECTS_ENABLED`, `INTERNAL_TOKEN` (Tasks 2-3); `NFSE_CERT_PFX_B64`/`NFSE_CERT_PFX_PASSPHRASE` (Task 4).
- Produces: Worker `imob-api` em `https://api.imob.simpleit.app.br`; service `imob-api` para o binding do `imob-web`.

- [ ] **Step 1: Testes das funções puras do Worker**

`cloudflare/api/src/forward.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContainerEnv, isAllowedOrigin, toContainerRequest } from "./forward";

test("repassa proto https e IP do cliente", () => {
  const req = new Request("https://api.imob.simpleit.app.br/api/receipts?x=1", { headers: { cookie: "connect.sid=abc" } });
  const out = toContainerRequest(req, "200.1.2.3");
  assert.equal(out.url, "https://api.imob.simpleit.app.br/api/receipts?x=1");
  assert.equal(out.headers.get("x-forwarded-proto"), "https");
  assert.equal(out.headers.get("x-forwarded-for"), "200.1.2.3");
  assert.equal(out.headers.get("cookie"), "connect.sid=abc");
});

test("origens permitidas vêm de CORS_ORIGINS", () => {
  const list = "https://imob.simpleit.app.br, https://sistema.imobiliariasimoes.com.br";
  assert.equal(isAllowedOrigin("https://imob.simpleit.app.br", list), true);
  assert.equal(isAllowedOrigin("https://evil.com", list), false);
  assert.equal(isAllowedOrigin(undefined, list), false);
});

test("env do container: fixos de runtime + secrets", () => {
  const env = buildContainerEnv({
    DATABASE_URL: "db", SESSION_SECRET: "s", INTERNAL_TOKEN: "t",
    NFSE_CERT_PFX_B64: "b64", NFSE_CERT_PFX_PASSPHRASE: "p",
    SIDE_EFFECTS_ENABLED: "false", NFSE_ENABLE_IBSCBS_DPS: "true",
  });
  assert.equal(env.DATABASE_URL, "db");
  assert.equal(env.SIDE_EFFECTS_ENABLED, "false");
  assert.equal(env.SESSION_STORE, "pg");
  assert.equal(env.SESSION_COOKIE_SECURE, "true");
  assert.equal(env.TRUST_PROXY, "1");
  assert.equal(env.SERVE_STATIC, "false");
  assert.equal(env.PORT, "8080");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test cloudflare/api/src/forward.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar o Worker**

`cloudflare/api/src/forward.ts`:
```ts
export type ApiSecrets = {
  DATABASE_URL: string;
  SESSION_SECRET: string;
  INTERNAL_TOKEN: string;
  NFSE_CERT_PFX_B64: string;
  NFSE_CERT_PFX_PASSPHRASE: string;
  SIDE_EFFECTS_ENABLED: string;
  NFSE_ENABLE_IBSCBS_DPS: string;
};

export const CONTAINER_PORT = 8080;

export function buildContainerEnv(env: ApiSecrets): Record<string, string> {
  return {
    DATABASE_URL: env.DATABASE_URL,
    SESSION_SECRET: env.SESSION_SECRET,
    INTERNAL_TOKEN: env.INTERNAL_TOKEN,
    NFSE_CERT_PFX_B64: env.NFSE_CERT_PFX_B64,
    NFSE_CERT_PFX_PASSPHRASE: env.NFSE_CERT_PFX_PASSPHRASE,
    SIDE_EFFECTS_ENABLED: env.SIDE_EFFECTS_ENABLED,
    NFSE_ENABLE_IBSCBS_DPS: env.NFSE_ENABLE_IBSCBS_DPS,
    SESSION_STORE: "pg",
    SESSION_COOKIE_SECURE: "true",
    TRUST_PROXY: "1",
    SERVE_STATIC: "false",
    PORT: String(CONTAINER_PORT),
  };
}

export function toContainerRequest(req: Request, clientIp: string | null): Request {
  const headers = new Headers(req.headers);
  headers.set("x-forwarded-proto", "https");
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  return new Request(req, { headers });
}

export function isAllowedOrigin(origin: string | undefined, allowList: string): boolean {
  if (!origin) return false;
  return allowList.split(",").map((o) => o.trim()).filter(Boolean).includes(origin);
}
```

`cloudflare/api/src/index.ts`:
```ts
import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildContainerEnv, CONTAINER_PORT, isAllowedOrigin, toContainerRequest, type ApiSecrets } from "./forward";

type Env = ApiSecrets & {
  IMOB_SERVER: DurableObjectNamespace<ImobServer>;
  CORS_ORIGINS: string;
};

export class ImobServer extends Container<Env> {
  defaultPort = CONTAINER_PORT;
  sleepAfter = "15m";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = buildContainerEnv(env);
  }
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) =>
  cors({
    origin: (origin) => (isAllowedOrigin(origin, c.env.CORS_ORIGINS) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Disposition"],
  })(c, next),
);

app.get("/health", (c) => c.json({ ok: true, worker: "imob-api" }));
app.all("/internal/*", (c) => c.notFound());

app.all("*", async (c) => {
  const container = getContainer(c.env.IMOB_SERVER, "main");
  const res = await container.fetch(toContainerRequest(c.req.raw, c.req.header("cf-connecting-ip") ?? null));
  // Resposta mutável para o middleware de CORS acrescentar cabeçalhos.
  return new Response(res.body, res);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const container = getContainer(env.IMOB_SERVER, "main");
    ctx.waitUntil(
      container
        .fetch(new Request("http://imob-server/internal/tick", { method: "POST", headers: { "x-internal-token": env.INTERNAL_TOKEN } }))
        .then(async (r) => { if (!r.ok) console.error("[cron] tick falhou", r.status, await r.text()); })
        .catch((e) => console.error("[cron] tick erro", e)),
    );
  },
} satisfies ExportedHandler<Env>;
```

`cloudflare/api/wrangler.jsonc`:
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "imob-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [{ "pattern": "api.imob.simpleit.app.br", "custom_domain": true }],
  "vars": {
    // Homologação: false. Só vira "true" na virada (Task 11).
    "SIDE_EFFECTS_ENABLED": "false",
    "NFSE_ENABLE_IBSCBS_DPS": "true",
    "CORS_ORIGINS": "https://imob.simpleit.app.br"
  },
  "triggers": { "crons": ["* * * * *"] },
  "containers": [
    {
      "class_name": "ImobServer",
      "image": "../../Dockerfile",
      "image_build_context": "../..",
      "instance_type": "standard-1",
      "max_instances": 1
    }
  ],
  "durable_objects": {
    "bindings": [{ "name": "IMOB_SERVER", "class_name": "ImobServer" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ImobServer"] }],
  "observability": { "enabled": true }
}
```

`cloudflare/api/package.json`:
```json
{
  "name": "imob-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@cloudflare/containers": "latest",
    "hono": "^4.6.14"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260901.0",
    "typescript": "^5",
    "wrangler": "^4"
  }
}
```
Depois do `npm install`, fixe a versão instalada de `@cloudflare/containers` no lugar de `latest`.

`cloudflare/api/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types"],
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`cloudflare/api/.dev.vars.example`:
```
DATABASE_URL=
SESSION_SECRET=
INTERNAL_TOKEN=
NFSE_CERT_PFX_B64=
NFSE_CERT_PFX_PASSPHRASE=
```
(e `cloudflare/*/node_modules`, `cloudflare/*/.dev.vars`, `cloudflare/*/.wrangler` no `.gitignore`).

- [ ] **Step 4: Build somente do servidor**

Em `script/build.ts`, dentro de `buildAll()`, trocar:
```ts
  console.log("building client...");
  await viteBuild();
```
por:
```ts
  if (!process.argv.includes("--server-only")) {
    console.log("building client...");
    await viteBuild();
  }
```
Em `package.json` → `scripts`:
```json
    "build:server": "tsx script/build.ts --server-only",
    "build:web": "vite build",
```

`Dockerfile` (raiz):
```dockerfile
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HEADLESS_BROWSER_PATH=/usr/bin/chromium
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.cjs"]
```

`.dockerignore`:
```
node_modules
dist
.git
.env
.env.*
cert
*.log
.dbg
.pendencias
attached_assets
Modelo
Modelos
XML
Assinador
Cadastros
cloudflare
scripts/migration/.env.migration
scripts/migration/dumps
docs
```

- [ ] **Step 5: Rodar testes e typecheck**

```bash
cd cloudflare/api && npm install && npm run typecheck && cd ../..
npx tsx --test cloudflare/api/src/forward.test.ts
npm run build:server
```
Expected: typecheck ok; 3 testes PASS; `dist/index.cjs` gerado sem build do cliente.

- [ ] **Step 6: Secrets de homologação e deploy**

Gerar os valores e enviar (PowerShell, na pasta `cloudflare/api`):
```powershell
$homolog = (Select-String -Path ../../scripts/migration/.env.migration -Pattern '^HOMOLOG_POOLER_URL=(.*)').Matches[0].Groups[1].Value
$homolog | npx wrangler secret put DATABASE_URL
[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }) -as [byte[]]) | npx wrangler secret put SESSION_SECRET
[Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }) -as [byte[]]) | npx wrangler secret put INTERNAL_TOKEN
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD/../../cert/IMOBILIARIA_SIMOES_LTDA_1009005362.pfx")) | npx wrangler secret put NFSE_CERT_PFX_B64
```
`NFSE_CERT_PFX_PASSPHRASE`: pedir ao usuário a senha usada hoje no Replit (o padrão do código é `1234`) e enviar com `npx wrangler secret put NFSE_CERT_PFX_PASSPHRASE`.

Deploy, conforme a escolha da Task 0 Step 4:
- (a) Docker Desktop local: `npx wrangler deploy`
- (b) Workers Builds: root directory `cloudflare/api`, build command vazio, deploy command `npx wrangler deploy`, branch `migracao-cloudflare`; `git push -u origin migracao-cloudflare`.

- [ ] **Step 7: Verificar no ar**

```bash
curl -s https://api.imob.simpleit.app.br/health
curl -s https://api.imob.simpleit.app.br/api/health
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.imob.simpleit.app.br/internal/tick
npx wrangler tail imob-api --format pretty
```
Expected: `{"ok":true,"worker":"imob-api"}`; `{"ok":true}` (a 1ª chamada pode levar alguns segundos com o Container subindo); `404`; no tail, um `scheduled` por minuto sem erro, e o log do Container com `[NfseWorker] Efeitos externos desligados`.

- [ ] **Step 8: Commit**

```bash
git add script/build.ts package.json Dockerfile .dockerignore .gitignore cloudflare/api
git commit -m "feat(cloudflare): Worker imob-api e Container do Express"
```

---

### Task 8: Worker `imob-web`

**Files:**
- Create: `cloudflare/web/package.json`, `cloudflare/web/tsconfig.json`, `cloudflare/web/wrangler.jsonc`, `cloudflare/web/src/index.ts`

**Interfaces:**
- Consumes: service `imob-api` (Task 7); build `dist/public` gerado com `VITE_API_URL`.
- Produces: `https://imob.simpleit.app.br`.

- [ ] **Step 1: Implementar**

`cloudflare/web/src/index.ts`:
```ts
type Env = { ASSETS: Fetcher; API: Fetcher };

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/") || pathname.startsWith("/webhook/")) {
      return env.API.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

`cloudflare/web/wrangler.jsonc`:
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "imob-web",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "../../dist/public",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/webhook/*"]
  },
  "services": [{ "binding": "API", "service": "imob-api" }],
  "routes": [{ "pattern": "imob.simpleit.app.br", "custom_domain": true }],
  "observability": { "enabled": true }
}
```

`cloudflare/web/package.json`:
```json
{
  "name": "imob-web",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "cd ../.. && cross-env VITE_API_URL=https://api.imob.simpleit.app.br npm run build:web",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260901.0",
    "typescript": "^5",
    "wrangler": "^4"
  }
}
```
(`cross-env` já está nas devDependencies da raiz.) `cloudflare/web/tsconfig.json` igual ao de `cloudflare/api`.

- [ ] **Step 2: Build, typecheck e deploy**

```bash
cd cloudflare/web && npm install && npm run typecheck && npm run build && npx wrangler deploy && cd ../..
```
Expected: `dist/public/index.html` gerado; deploy cria o custom domain `imob.simpleit.app.br`.

- [ ] **Step 3: Verificar**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://imob.simpleit.app.br/
curl -s -o /dev/null -w "%{http_code}\n" https://imob.simpleit.app.br/recibos
curl -s https://imob.simpleit.app.br/api/health
grep -o "api.imob.simpleit.app.br" -m1 dist/public/assets/*.js
```
Expected: `200`, `200` (fallback SPA), `{"ok":true}` (via service binding), e a URL da API presente no bundle.

No navegador: abrir `https://imob.simpleit.app.br`, fazer login com usuário real (dados de `homolog`) e conferir no DevTools → Application → Cookies que `connect.sid` está em `api.imob.simpleit.app.br` com `Secure` e `SameSite=Lax`, e que recarregar a página mantém o login.

- [ ] **Step 4: Commit**

```bash
git add cloudflare/web .gitignore
git commit -m "feat(cloudflare): Worker imob-web com assets e encaminhamento para a API"
```

---

### Task 9: Teste mTLS somente leitura dentro do Container

**Files:**
- Modify: `server/internalRoutes.ts` (rota `POST /internal/mtls-check`)
- Test: `server/internalRoutes.test.ts` (novo caso)

**Interfaces:**
- Consumes: `sicoobProvider.consultarSegundaVia(linhaDigitavel)`, `nfseProvider.consultarNfse(emissaoId)` (somente leitura).
- Produces: `POST /internal/mtls-check` no Container, com corpo `{ linhaDigitavel?: string; emissaoId?: string }` → `{ sicoob?: "ok" | string; nfse?: "ok" | string }`. Como o Worker bloqueia `/internal/*` ao público, ela é exposta como `POST /__mtls-check` no `imob-api`, que só encaminha com `x-internal-token` válido (Step 3).

- [ ] **Step 1: Teste**

Acrescentar a `server/internalRoutes.test.ts`:
```ts
test("mtls-check exige token e devolve resultado de cada consulta", async () => {
  const s = await start({
    tick: async () => {}, pingDb: async () => {}, token: "t0k",
    mtlsCheck: async (body) => ({ sicoob: body.linhaDigitavel ? "ok" : undefined, nfse: body.emissaoId ? "falhou: x" : undefined }),
  });
  try {
    assert.equal((await fetch(`${s.base}/internal/mtls-check`, { method: "POST" })).status, 401);
    const r = await fetch(`${s.base}/internal/mtls-check`, {
      method: "POST",
      headers: { "x-internal-token": "t0k", "content-type": "application/json" },
      body: JSON.stringify({ linhaDigitavel: "1", emissaoId: "2" }),
    });
    assert.deepEqual(await r.json(), { sicoob: "ok", nfse: "falhou: x" });
  } finally { s.close(); }
});
```
(o helper `start` da Task 3 já aplica `express.json()` antes de `registerInternalRoutes`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test server/internalRoutes.test.ts`
Expected: FAIL — rota inexistente / tipo `mtlsCheck` desconhecido.

- [ ] **Step 3: Implementar**

Em `server/internalRoutes.ts`, estender `InternalDeps` com:
```ts
  mtlsCheck?: (body: { linhaDigitavel?: string; emissaoId?: string }) => Promise<{ sicoob?: string; nfse?: string }>;
```
e, dentro do bloco após `if (!deps.token) return;`:
```ts
  if (deps.mtlsCheck) {
    const mtlsCheck = deps.mtlsCheck;
    app.post("/internal/mtls-check", async (req, res) => {
      if (req.get("x-internal-token") !== deps.token) {
        return res.status(401).json({ error: "unauthorized" });
      }
      res.json(await mtlsCheck(req.body ?? {}));
    });
  }
```
Em `server/index.ts`, no `registerInternalRoutes`:
```ts
    mtlsCheck: async ({ linhaDigitavel, emissaoId }) => {
      const out: { sicoob?: string; nfse?: string } = {};
      if (linhaDigitavel) {
        try { await sicoobProvider.consultarSegundaVia(linhaDigitavel); out.sicoob = "ok"; }
        catch (e: any) { out.sicoob = `falhou: ${e?.message}`; }
      }
      if (emissaoId) {
        try { const r = await nfseProvider.consultarNfse(emissaoId); out.nfse = r.success ? "ok" : `falhou: ${r.message}`; }
        catch (e: any) { out.nfse = `falhou: ${e?.message}`; }
      }
      return out;
    },
```
(imports `sicoobProvider` de `./providers/SicoobProvider` e `nfseProvider` de `./providers/NfseNationalProvider`. `registerInternalRoutes` precisa vir **depois** de `app.use(express.json(...))`, que já está antes do bloco async.)

Em `cloudflare/api/src/index.ts`, **antes** de `app.all("/internal/*", ...)`:
```ts
app.post("/__mtls-check", async (c) => {
  if (c.req.header("x-internal-token") !== c.env.INTERNAL_TOKEN) return c.notFound();
  const container = getContainer(c.env.IMOB_SERVER, "main");
  return container.fetch(new Request("http://imob-server/internal/mtls-check", {
    method: "POST",
    headers: { "x-internal-token": c.env.INTERNAL_TOKEN, "content-type": "application/json" },
    body: await c.req.text(),
  }));
});
```

- [ ] **Step 4: Rodar e ver passar; redeploy**

Run: `npx tsx --test server/internalRoutes.test.ts`
Expected: PASS (4 testes)

Redeploy do `imob-api` (mesmo método da Task 7).

- [ ] **Step 5: Teste real somente leitura**

Escolher em `homolog` um recibo com `slip_digitable_line` e uma emissão NFS-e com status de sucesso (`select id from nfse_emissoes where chave_acesso is not null limit 1`), e chamar:
```powershell
$token = "<INTERNAL_TOKEN de homologação>"
curl.exe -s -X POST https://api.imob.simpleit.app.br/__mtls-check -H "x-internal-token: $token" -H "content-type: application/json" -d '{\"linhaDigitavel\":\"<linha>\",\"emissaoId\":\"<id>\"}'
```
Expected: `{"sicoob":"ok","nfse":"ok"}`. Isso prova que o certificado A1 funciona dentro do Container. Ambas são consultas, sem emissão.

- [ ] **Step 6: Commit**

```bash
git add server/internalRoutes.ts server/internalRoutes.test.ts server/index.ts cloudflare/api/src/index.ts
git commit -m "feat: verificação mTLS somente leitura no Container"
```

---

### Task 10: Homologação lado a lado (checklist de paridade)

**Files:**
- Create: `docs/migracao/checklist-paridade.md`

- [ ] **Step 1: Escrever o checklist**

`docs/migracao/checklist-paridade.md` com uma linha por item, colunas `Item | Replit | Cloudflare | OK? | Observação`:

1. Login, logout, 2FA (setup/login), sessão mantida após recarregar e após 20 min parado (Container hibernado)
2. Usuários: criar, editar, permissões por campo (Todos/Nenhum/Personalizado) bloqueando campo no front e no back
3. Proprietários, locatários, fiadores, prestadores, imóveis (incluindo status do imóvel): listar, criar, editar, excluir
4. Contratos e itens recorrentes
5. Serviços e lançamentos do mês
6. Recibos: gerar, editar, desconto, split de proprietário, imprimir (`/print-receipt`), link público do recibo
7. Boleto: emitir → **deve mostrar "Bloqueado neste ambiente"**; 2ª via PDF de boleto já existente abre (consulta real)
8. Caixa (`/cash`) e Controle de Despesas: saldo anterior e fechamento mensal iguais ao Replit no mesmo mês
9. Repasses e PIX: montar repasse; enviar PIX → **"Bloqueado neste ambiente"**
10. Notas/NFS-e: listar emissões, XML, DANFSE (download real), link público da DANFSE; emitir/cancelar → **bloqueado**
11. Relatórios: receita, seguros, repasses, notas emitidas (PDF via Chromium), DIMOB (tela e exportações)
12. Exportação contábil de NFS-e (ZIP)
13. Auditoria: alteração registrada com De/Para e campos sensíveis mascarados
14. Webhook Sicoob simulado: `POST https://imob.simpleit.app.br/webhook/sicoob` com payload de exemplo do `webhook_sicoob.log` → 200 e registro igual ao do Replit
15. Tempo de resposta: listas de recibos/contratos e dashboard ≤ Replit (anotar ms dos dois)
16. Cron: `wrangler tail imob-api` mostra 1 tick/min sem erro durante 30 min

- [ ] **Step 2: Executar com o usuário**

Para cada item, comparar com o Replit (mesmo dado; a cópia `homolog` pode ser renovada com `copy-db.ts --target=homolog` antes da sessão de testes). Corrigir qualquer divergência como bug da tarefa que a originou (com teste), redeploy, retestar.

Critério de saída: todos os itens `OK` + `validate.ts --target=homolog` verde + aprovação explícita do usuário para agendar a virada.

- [ ] **Step 3: Commit**

```bash
git add docs/migracao/checklist-paridade.md
git commit -m "docs(migracao): checklist de paridade preenchido"
```

---

### Task 11: Virada (runbook)

**Files:**
- Create: `docs/migracao/runbook-virada.md` (o conteúdo abaixo, com horários e responsáveis preenchidos)

Pré-requisitos: Task 10 aprovada; data/hora combinada com o cliente, fora do horário de emissão; usuário com acesso ao Replit (Secrets + Deploy) presente.

- [ ] **Step 1: Preparar o Replit (antes da janela, sem efeito)**

Merge da branch `migracao-cloudflare` em `main` e publicar no Replit **sem** variáveis novas. Como tudo está atrás de variável, o comportamento é idêntico. Conferir login e uma tela no `sistema.imobiliariasimoes.com.br`.

- [ ] **Step 2: T0 — Somente leitura no Replit**

Replit → Secrets: `READ_ONLY=true` → Redeploy. Verificar: login ok, telas abrem, salvar algo retorna "Sistema em manutenção programada". O `nfseWorker` não inicia (log).

- [ ] **Step 3: Conferir que não há NFS-e em processamento**

No banco antigo (leitura): `select status, count(*) from nfse_emissoes group by status;` e anotar. Pendentes/processando ficam como estão e serão processadas pelo novo sistema após a virada.

- [ ] **Step 4: Carga final em produção**

```powershell
$env:CONFIRM_PRODUCTION = "SIM"
npx tsx scripts/migration/copy-db.ts --target=production
npx tsx scripts/migration/validate.ts --target=production
```
Expected: `✅ production: idêntico à origem`. Com o Replit em somente leitura, **qualquer** diferença bloqueia a virada → rollback (Step 9).

- [ ] **Step 5: Apontar a Cloudflare para produção e ligar efeitos**

```powershell
cd cloudflare/api
(Select-String -Path ../../scripts/migration/.env.migration -Pattern '^PRODUCTION_POOLER_URL=(.*)').Matches[0].Groups[1].Value | npx wrangler secret put DATABASE_URL
```
Em `cloudflare/api/wrangler.jsonc`, `"SIDE_EFFECTS_ENABLED": "true"`; então `npx wrangler deploy`.

- [ ] **Step 6: Smoke test**

- `curl https://api.imob.simpleit.app.br/api/health` → `{"ok":true}`
- login em `https://imob.simpleit.app.br`, abrir recibos do mês, gerar um PDF de relatório
- criar e excluir um registro de teste (ex.: prestador "TESTE MIGRAÇÃO")
- `wrangler tail imob-api`: tick por minuto e `[NfseWorker]` processando normalmente

- [ ] **Step 7: Replit em modo legado**

Replit → Secrets: remover `READ_ONLY`; adicionar `SIDE_EFFECTS_ENABLED=false`, `LEGACY_REDIRECT_URL=https://imob.simpleit.app.br`, `LEGACY_PROXY_API_URL=https://api.imob.simpleit.app.br` → Redeploy.
Verificar:
- `https://sistema.imobiliariasimoes.com.br/recibos` → redireciona para `https://imob.simpleit.app.br/recibos`
- um link público antigo (`/api/public/receipts/<id>/boleto`) abre via proxy
- `curl -X POST https://sistema.imobiliariasimoes.com.br/webhook/sicoob -d '{}' -H 'content-type: application/json'` → mesma resposta do novo sistema

- [ ] **Step 8: Comunicar a URL nova aos usuários**

`https://imob.simpleit.app.br`. Os mesmos usuários e senhas. Commit do runbook preenchido:
```bash
git add docs/migracao/runbook-virada.md
git commit -m "docs(migracao): runbook da virada executado"
```

- [ ] **Step 9: Rollback (somente se Steps 4-6 falharem)**

Replit → Secrets: remover `READ_ONLY` (e qualquer variável de legado) → Redeploy. O Replit volta a operar sobre o banco antigo, intocado. No `cloudflare/api/wrangler.jsonc`, `SIDE_EFFECTS_ENABLED` volta a `"false"` + deploy. Registrar a causa e remarcar.

---

### Task 12: Pós-virada

**Files:**
- Create: `DEPLOY.md`
- Modify: `replit.md`, `.gitignore`

- [ ] **Step 1: Monitorar 48 h**

`npx wrangler tail imob-api`; conferir diariamente `nfse_emissoes` (sem acúmulo de `PENDENTE`/`FALHOU` novos) e `pix_transfer_attempts`.

- [ ] **Step 2: Tirar segredos do Git**

```bash
git rm --cached .env cert/IMOBILIARIA_SIMOES_LTDA_1009005362.pfx cert/IMOBILIARIA_SIMOES_LTDA_Chave_Publica.cer webhook_sicoob.log
```
`.gitignore`:
```
.env
cert/
*.log
```
Atenção: no próximo pull no Replit, esses arquivos somem do workspace dele. Isso é aceitável porque o Replit está em modo legado, sem efeitos.

- [ ] **Step 3: Rotacionar senhas**

No Neon: resetar a senha de `neondb_owner` no projeto novo → atualizar `DATABASE_URL` (`wrangler secret put`) e `scripts/migration/.env.migration`. No projeto antigo: resetar também (ele só é usado pelo Replit em modo legado, que não grava).

- [ ] **Step 4: Documentar**

`DEPLOY.md` no padrão do Gabinete/SimpleERP: tabela dos Workers (`imob-web`, `imob-api`), comandos de build/deploy, lista de secrets e vars, como ver logs, como renovar o certificado (`NFSE_CERT_PFX_B64`). Atualizar `replit.md` informando que a produção está na Cloudflare.

- [ ] **Step 5: Commit**

```bash
git add .gitignore DEPLOY.md replit.md
git commit -m "chore: segredos fora do Git e documentação de deploy Cloudflare"
```

- [ ] **Step 6: Após ≥ 30 dias estáveis (com o usuário)**

Desligar o deploy do Replit e arquivar o banco antigo (exportar dump final e guardar). Planejar a fase do domínio `imobiliariasimoes.com.br`.

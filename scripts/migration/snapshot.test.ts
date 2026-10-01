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

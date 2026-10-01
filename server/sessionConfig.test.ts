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

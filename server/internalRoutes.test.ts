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

test("mtls-check exige token e devolve resultado de cada consulta", async () => {
  const s = await start({
    tick: async () => {}, pingDb: async () => {}, token: "t0k",
    mtlsCheck: async (body) => ({ sicoob: body.linhaDigitavel ? "ok" : undefined, nfse: body.chaveAcesso ? "falhou: x" : undefined }),
  });
  try {
    assert.equal((await fetch(`${s.base}/internal/mtls-check`, { method: "POST" })).status, 401);
    const r = await fetch(`${s.base}/internal/mtls-check`, {
      method: "POST",
      headers: { "x-internal-token": "t0k", "content-type": "application/json" },
      body: JSON.stringify({ linhaDigitavel: "1", chaveAcesso: "2" }),
    });
    assert.deepEqual(await r.json(), { sicoob: "ok", nfse: "falhou: x" });
  } finally { s.close(); }
});

test("health informa efeitos externos e banco em uso (para o runbook conferir)", async () => {
  const s = await start({
    tick: async () => {}, pingDb: async () => {}, token: undefined,
    info: () => ({ sideEffectsEnabled: false, database: "imob_homolog" }),
  });
  try {
    const body = await (await fetch(`${s.base}/api/health`)).json();
    assert.equal(body.sideEffectsEnabled, false);
    assert.equal(body.database, "imob_homolog");
  } finally { s.close(); }
});

test("databaseName não expõe credenciais", async () => {
  const { databaseName } = await import("./internalRoutes");
  assert.equal(databaseName("postgresql://u:senha@ep-x-pooler.c-2.sa-east-1.aws.neon.tech/imob_homolog?sslmode=require"), "ep-x-pooler/imob_homolog");
  assert.equal(databaseName(undefined), null);
});

test("health mede o tempo da consulta ao banco (dbMs)", async () => {
  const s = await start({ tick: async () => {}, pingDb: async () => { await new Promise((r) => setTimeout(r, 20)); }, token: undefined });
  try {
    const body = await (await fetch(`${s.base}/api/health`)).json();
    assert.equal(body.ok, true);
    assert.ok(typeof body.dbMs === "number" && body.dbMs >= 15, JSON.stringify(body));
  } finally { s.close(); }
});

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

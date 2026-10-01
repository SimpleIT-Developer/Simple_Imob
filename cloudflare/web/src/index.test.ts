import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./index";

const fakeEnv = {
  ASSETS: { fetch: async () => new Response("assets") },
  API: { fetch: async () => new Response("api") },
} as any;

const call = async (path: string) =>
  (await worker.fetch(new Request(`https://imob.simpleit.app.br${path}`), fakeEnv, {} as any)).text();

test("/api e /webhook vão para a API; o resto para os assets", async () => {
  assert.equal(await call("/api/public/receipts/1/boleto"), "api");
  assert.equal(await call("/webhook/sicoob"), "api");
  assert.equal(await call("/"), "assets");
  assert.equal(await call("/recibos"), "assets");
  assert.equal(await call("/apiary"), "assets");
});

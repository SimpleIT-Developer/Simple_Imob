import { test } from "node:test";
import assert from "node:assert/strict";
import { detectColo, parseCfTrace } from "./diagnostics";

test("extrai o datacenter (colo) do trace da Cloudflare", () => {
  assert.equal(parseCfTrace("fl=1\nh=www.cloudflare.com\ncolo=GRU\nloc=BR\n"), "GRU");
  assert.equal(parseCfTrace("sem colo"), null);
});

test("detectColo não derruba o servidor se a rede falhar", async () => {
  assert.equal(await detectColo(async () => { throw new Error("offline"); }), null);
  assert.equal(await detectColo(async () => new Response("colo=IAD\n")), "IAD");
});

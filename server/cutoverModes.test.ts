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

test("READ_ONLY via middleware responde 503 em escrita", async () => {
  const app = express();
  app.use(cutoverMiddleware({ READ_ONLY: "true" }));
  app.use((_req, res) => res.status(200).send("ok"));
  const s = app.listen(0);
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/receipts`, { method: "POST" })).status, 503);
    assert.equal((await fetch(`${base}/api/receipts`)).status, 200);
  } finally { s.close(); }
});

test("modo legado não vira redirecionamento aberto (//host, /\host)", async () => {
  const legacy = express();
  legacy.use(cutoverMiddleware({ LEGACY_REDIRECT_URL: "https://imob.simpleit.app.br/", LEGACY_PROXY_API_URL: "http://127.0.0.1:1" }));
  const lg = legacy.listen(0);
  const base = `http://127.0.0.1:${(lg.address() as AddressInfo).port}`;
  try {
    for (const p of ["//evil.com/x", "/\evil.com/x", "///evil.com"]) {
      const r = await fetch(`${base}${p}`, { redirect: "manual" });
      assert.equal(r.status, 302);
      assert.ok(r.headers.get("location")!.startsWith("https://imob.simpleit.app.br/"), `${p} → ${r.headers.get("location")}`);
    }
  } finally { lg.close(); }
});

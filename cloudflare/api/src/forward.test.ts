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

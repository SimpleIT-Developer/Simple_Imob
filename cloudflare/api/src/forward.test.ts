import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContainerEnv, EXPOSED_HEADERS, isAllowedOrigin, toContainerRequest } from "./forward";

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

test("CORS expõe os cabeçalhos que o front lê (exportação contábil)", () => {
  for (const h of ["Content-Disposition", "X-Exported-Xml-Count", "X-Exported-Danfse-Count", "X-Export-Skipped-Count"]) {
    assert.ok(EXPOSED_HEADERS.includes(h), h);
  }
});

test("variáveis opcionais do Replit (SICOOB_*, NFSE_*, DANFSE_*, ACCOUNTING_*) chegam ao container", () => {
  const env = buildContainerEnv({
    DATABASE_URL: "db", SESSION_SECRET: "s", INTERNAL_TOKEN: "t",
    NFSE_CERT_PFX_B64: "b64", NFSE_CERT_PFX_PASSPHRASE: "p",
    SIDE_EFFECTS_ENABLED: "false", NFSE_ENABLE_IBSCBS_DPS: "true",
    SICOOB_ORIGEM_CONTA: "123", DANFSE_RETRY_MAX_ATTEMPTS: "5", ACCOUNTING_EXPORT_NFSE_CONCURRENCY: "2",
    NFSE_XML_DOWNLOAD_TIMEOUT_MS: "9000", IMOB_SERVER: { binding: true }, OUTRA: "x",
  } as any);
  assert.equal(env.SICOOB_ORIGEM_CONTA, "123");
  assert.equal(env.DANFSE_RETRY_MAX_ATTEMPTS, "5");
  assert.equal(env.ACCOUNTING_EXPORT_NFSE_CONCURRENCY, "2");
  assert.equal(env.NFSE_XML_DOWNLOAD_TIMEOUT_MS, "9000");
  assert.equal(env.OUTRA, undefined);
  assert.equal((env as any).IMOB_SERVER, undefined);
  assert.equal(env.SESSION_STORE, "pg");
});

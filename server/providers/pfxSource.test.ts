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

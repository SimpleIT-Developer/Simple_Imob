import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiUrl } from "./api-url";

test("base vazia mantém a URL relativa (Replit/dev)", () => {
  assert.equal(resolveApiUrl("/api/receipts", ""), "/api/receipts");
});

test("prefixa somente caminhos /api", () => {
  const base = "https://api.imob.simpleit.app.br/";
  assert.equal(resolveApiUrl("/api/receipts?x=1", base), "https://api.imob.simpleit.app.br/api/receipts?x=1");
  assert.equal(resolveApiUrl("/api", base), "https://api.imob.simpleit.app.br/api");
  assert.equal(resolveApiUrl("/apiary", base), "/apiary");
  assert.equal(resolveApiUrl("/recibos", base), "/recibos");
  assert.equal(resolveApiUrl("https://viacep.com.br/ws/1/json", base), "https://viacep.com.br/ws/1/json");
});

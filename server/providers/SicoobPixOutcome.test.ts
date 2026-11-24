import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySicoobPixEstado, getSicoobPixEstado } from "./SicoobProvider";

test("EM_PROCESSAMENTO (resposta da confirmação) não conta como pago", () => {
  assert.equal(classifySicoobPixEstado("EM_PROCESSAMENTO"), "processando");
});

test("FINALIZADO conta como pago", () => {
  assert.equal(classifySicoobPixEstado("FINALIZADO"), "finalizado");
  assert.equal(classifySicoobPixEstado("finalizado"), "finalizado");
});

test("REJEITADO e devolução liberam reenvio", () => {
  assert.equal(classifySicoobPixEstado("REJEITADO"), "rejeitado");
  assert.equal(classifySicoobPixEstado("DEVOLVIDO"), "rejeitado");
  assert.equal(classifySicoobPixEstado("CANCELADO"), "rejeitado");
});

test("estado desconhecido ou ausente fica em processamento (bloqueia reenvio, mais seguro)", () => {
  assert.equal(classifySicoobPixEstado(undefined), "processando");
  assert.equal(classifySicoobPixEstado(""), "processando");
  assert.equal(classifySicoobPixEstado("CONFIRMADO"), "processando");
});

test("lê o estado do formato real da API de pagamentos PIX do Sicoob", () => {
  const rejeitado = {
    endToEndId: "E00966246202611241252i52F4Tc7Fe7",
    valor: "1253.30",
    estado: "REJEITADO",
    detalheRejeicao: "Timeout do participante emissor da ordem de pagamento.",
  };
  assert.equal(getSicoobPixEstado(rejeitado), "REJEITADO");
  assert.equal(classifySicoobPixEstado(getSicoobPixEstado(rejeitado)), "rejeitado");
  assert.equal(getSicoobPixEstado({}), null);
});

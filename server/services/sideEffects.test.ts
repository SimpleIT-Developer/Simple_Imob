import { test } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

process.env.SIDE_EFFECTS_ENABLED = "false";
process.env.DATABASE_URL = "postgres://invalid:invalid@127.0.0.1:1/none";

// Qualquer chamada de rede derruba o teste: a trava tem que agir ANTES do axios.
axios.interceptors.request.use(() => {
  throw new Error("REDE CHAMADA");
});

const { sideEffectsEnabled, SideEffectBlockedError } = await import("./sideEffects");
const { sicoobProvider } = await import("../providers/SicoobProvider");
const { nfseProvider } = await import("../providers/NfseNationalProvider");

test("sem variáveis, efeitos ficam ligados (comportamento atual do Replit)", () => {
  assert.equal(sideEffectsEnabled({}), true);
});

test("SIDE_EFFECTS_ENABLED=false ou READ_ONLY=true desligam efeitos", () => {
  assert.equal(sideEffectsEnabled({ SIDE_EFFECTS_ENABLED: "false" }), false);
  assert.equal(sideEffectsEnabled({ READ_ONLY: "true" }), false);
});

const blocked = (p: Promise<unknown>) => assert.rejects(p, (e: unknown) => e instanceof SideEffectBlockedError);

test("Sicoob: boleto e PIX bloqueados antes da rede", async () => {
  await blocked(sicoobProvider.emitirBoleto({}));
  await blocked(sicoobProvider.initiatePixPayment("chave"));
  await blocked(sicoobProvider.confirmPixPayment("e2e", 1, "x"));
  await blocked(sicoobProvider.confirmPixPaymentByAccount(1, "x", {} as any));
});

test("NFS-e: emissão e cancelamento bloqueados antes do banco e da rede", async () => {
  await blocked(nfseProvider.emitirNfse("id"));
  await blocked(nfseProvider.cancelarNfse("id", "motivo"));
});

test("nfseWorker: com efeitos desligados, start() e tick() não consultam a fila", async () => {
  const { storage } = await import("../storage");
  const { nfseWorker } = await import("./nfseWorker");
  let consultas = 0;
  const original = storage.getPendingNfseEmissoes;
  storage.getPendingNfseEmissoes = async () => { consultas++; return []; };
  try {
    nfseWorker.start();
    await nfseWorker.tick();
    assert.equal(consultas, 0);
  } finally {
    nfseWorker.stop();
    storage.getPendingNfseEmissoes = original;
  }
});

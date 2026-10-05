import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { generateDanfseV2 } from "./danfse-v2";
import { NFSE_XML_FICTICIO } from "./fixture-nfse";

test("gera DANFSe v2.0 em PDF de uma página A4 a partir do XML autorizado", async () => {
  const bytes = await generateDanfseV2(NFSE_XML_FICTICIO);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.3) < 1 && Math.abs(height - 841.9) < 1, `${width}x${height}`);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDimobFichas,
  buildDimobReportCsv,
  type DimobReceiptRow,
} from "./dimobReport";

function row(overrides: Partial<DimobReceiptRow>): DimobReceiptRow {
  return {
    contractId: "c1",
    refMonth: 1,
    rentAmount: 1000,
    adminFeeAmount: 100,
    contractStartDate: "2025-01-15",
    tenantName: "Locatario X",
    tenantDoc: "111",
    propertyAddress: "Rua A, 1 - Centro",
    propertyCity: "Tatui",
    propertyState: "SP",
    propertyZip: "18270-000",
    propertyType: "RESIDENCIAL",
    landlords: [{ name: "Locador Y", doc: "999", percent: 100 }],
    ...overrides,
  };
}

test("reajuste no meio do ano é refletido mês a mês", () => {
  const rows = [
    row({ refMonth: 1, rentAmount: 620, adminFeeAmount: 62 }),
    row({ refMonth: 6, rentAmount: 680, adminFeeAmount: 68 }),
  ];
  const [ficha] = buildDimobFichas(rows);
  assert.equal(ficha.months[0].renBruto, 620);
  assert.equal(ficha.months[5].renBruto, 680);
  assert.equal(ficha.totalRenBruto, 1300);
  assert.equal(ficha.totalComissao, 130);
});

test("mês sem recibo fica zerado", () => {
  const [ficha] = buildDimobFichas([row({ refMonth: 3, rentAmount: 900 })]);
  assert.equal(ficha.months.length, 12);
  assert.equal(ficha.months[0].renBruto, 0);
  assert.equal(ficha.months[1].comissao, 0);
  assert.equal(ficha.months[2].renBruto, 900);
});

test("imposto retido sempre zero", () => {
  const [ficha] = buildDimobFichas([row({})]);
  assert.equal(ficha.totalImpostoRetido, 0);
  assert.ok(ficha.months.every((m) => m.impostoRetido === 0));
});

test("imóvel com dois proprietários rateia por percentual", () => {
  const rows = [
    row({
      refMonth: 1,
      rentAmount: 1000,
      adminFeeAmount: 100,
      landlords: [
        { name: "A", doc: "1", percent: 60 },
        { name: "B", doc: "2", percent: 40 },
      ],
    }),
  ];
  const fichas = buildDimobFichas(rows);
  assert.equal(fichas.length, 2);
  const a = fichas.find((f) => f.landlordName === "A")!;
  const b = fichas.find((f) => f.landlordName === "B")!;
  assert.equal(a.months[0].renBruto, 600);
  assert.equal(a.months[0].comissao, 60);
  assert.equal(b.months[0].renBruto, 400);
});

test("fichas distintas por contrato", () => {
  const rows = [
    row({ contractId: "c1", landlords: [{ name: "A", doc: "1", percent: 100 }] }),
    row({ contractId: "c2", landlords: [{ name: "A", doc: "1", percent: 100 }] }),
  ];
  assert.equal(buildDimobFichas(rows).length, 2);
});

test("CSV tem BOM, cabeçalho e 12 linhas por ficha", () => {
  const fichas = buildDimobFichas([row({ refMonth: 2, rentAmount: 700 })]);
  const csv = buildDimobReportCsv(fichas, 2026);
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.replace("﻿", "").split("\r\n");
  assert.equal(lines[0].split(";")[0], "ano");
  assert.equal(lines.length, 1 + 12);
  assert.ok(lines[2].includes("FEV;700,00"));
});

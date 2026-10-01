import { db } from "../db";
import { receipts, contracts, properties, tenants, landlords } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * Relatório de rendimentos para o Imposto de Renda (modelo DIMOB).
 * Fonte da matriz mensal: tabela `receipts` (uma linha por contrato/mês), que
 * funciona como snapshot e reflete reajustes de aluguel ao longo do ano.
 * Mês sem recibo fica zerado. Imposto retido fica 0 (sem fonte de dados ainda).
 */

export interface DimobLandlordAllocation {
  name: string;
  doc: string;
  /** Percentual de participação no imóvel (0-100). */
  percent: number;
}

export interface DimobReceiptRow {
  contractId: string;
  refMonth: number;
  rentAmount: number;
  adminFeeAmount: number;
  contractStartDate: string | null;
  tenantName: string;
  tenantDoc: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyType: string;
  landlords: DimobLandlordAllocation[];
}

export interface DimobFichaMonth {
  month: number;
  renBruto: number;
  comissao: number;
  impostoRetido: number;
}

export interface DimobFicha {
  contractId: string;
  contractNumber: string;
  contractDate: string | null;
  landlordName: string;
  landlordDoc: string;
  tenantName: string;
  tenantDoc: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyType: string;
  months: DimobFichaMonth[];
  totalRenBruto: number;
  totalComissao: number;
  totalImpostoRetido: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function emptyMonths(): DimobFichaMonth[] {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    renBruto: 0,
    comissao: 0,
    impostoRetido: 0,
  }));
}

/**
 * Agrupa recibos em fichas — uma por (contrato × locador). Imóvel com vários
 * proprietários gera uma ficha por proprietário, rateando aluguel e comissão
 * pelo percentual de participação.
 */
export function buildDimobFichas(rows: DimobReceiptRow[]): DimobFicha[] {
  const fichas = new Map<string, DimobFicha>();

  for (const row of rows) {
    const allocations = row.landlords.length > 0 ? row.landlords : [];
    for (const landlord of allocations) {
      const key = `${row.contractId}::${landlord.doc || landlord.name}`;
      let ficha = fichas.get(key);
      if (!ficha) {
        ficha = {
          contractId: row.contractId,
          contractNumber: "",
          contractDate: row.contractStartDate,
          landlordName: landlord.name,
          landlordDoc: landlord.doc,
          tenantName: row.tenantName,
          tenantDoc: row.tenantDoc,
          propertyAddress: row.propertyAddress,
          propertyCity: row.propertyCity,
          propertyState: row.propertyState,
          propertyZip: row.propertyZip,
          propertyType: row.propertyType,
          months: emptyMonths(),
          totalRenBruto: 0,
          totalComissao: 0,
          totalImpostoRetido: 0,
        };
        fichas.set(key, ficha);
      }

      if (row.refMonth < 1 || row.refMonth > 12) continue;
      const factor = landlord.percent / 100;
      const monthEntry = ficha.months[row.refMonth - 1];
      monthEntry.renBruto = round2(monthEntry.renBruto + row.rentAmount * factor);
      monthEntry.comissao = round2(monthEntry.comissao + row.adminFeeAmount * factor);
    }
  }

  for (const ficha of fichas.values()) {
    ficha.totalRenBruto = round2(ficha.months.reduce((sum, m) => sum + m.renBruto, 0));
    ficha.totalComissao = round2(ficha.months.reduce((sum, m) => sum + m.comissao, 0));
    ficha.totalImpostoRetido = round2(ficha.months.reduce((sum, m) => sum + m.impostoRetido, 0));
  }

  return Array.from(fichas.values()).sort(
    (a, b) =>
      a.landlordName.localeCompare(b.landlordName, "pt-BR") ||
      a.tenantName.localeCompare(b.tenantName, "pt-BR"),
  );
}

/** Busca os recibos do ano e monta as fichas do DIMOB. */
export async function getDimobReport(year: number): Promise<DimobFicha[]> {
  const allLandlords = await db.select().from(landlords);
  const landlordById = new Map(allLandlords.map((l) => [l.id, l]));

  const rows = await db
    .select({
      contractId: receipts.contractId,
      refMonth: receipts.refMonth,
      rentAmount: receipts.rentAmount,
      adminFeeAmount: receipts.adminFeeAmount,
      contractStartDate: contracts.startDate,
      contractLandlordId: contracts.landlordId,
      tenantName: tenants.name,
      tenantDoc: tenants.doc,
      propertyAddress: properties.address,
      propertyNeighborhood: properties.neighborhood,
      propertyCity: properties.city,
      propertyState: properties.state,
      propertyZip: properties.zipCode,
      propertyType: properties.type,
      landlordShares: properties.landlordShares,
    })
    .from(receipts)
    .leftJoin(contracts, eq(receipts.contractId, contracts.id))
    .leftJoin(properties, eq(contracts.propertyId, properties.id))
    .leftJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(receipts.refYear, year));

  const sourceRows: DimobReceiptRow[] = rows.map((row) => {
    const shares = Array.isArray(row.landlordShares) ? row.landlordShares : [];
    let allocations: DimobLandlordAllocation[] = shares
      .filter((s) => landlordById.has(s.landlordId))
      .map((s) => {
        const l = landlordById.get(s.landlordId)!;
        return { name: l.name, doc: l.doc ?? "", percent: Number(s.percent) || 0 };
      });

    if (allocations.length === 0 && row.contractLandlordId) {
      const l = landlordById.get(row.contractLandlordId);
      if (l) allocations = [{ name: l.name, doc: l.doc ?? "", percent: 100 }];
    }

    const address = [row.propertyAddress, row.propertyNeighborhood]
      .filter(Boolean)
      .join(" - ");

    return {
      contractId: row.contractId,
      refMonth: row.refMonth,
      rentAmount: Number(row.rentAmount) || 0,
      adminFeeAmount: Number(row.adminFeeAmount) || 0,
      contractStartDate: row.contractStartDate ?? null,
      tenantName: row.tenantName ?? "",
      tenantDoc: row.tenantDoc ?? "",
      propertyAddress: address,
      propertyCity: row.propertyCity ?? "",
      propertyState: row.propertyState ?? "",
      propertyZip: row.propertyZip ?? "",
      propertyType: row.propertyType ?? "",
      landlords: allocations,
    };
  });

  return buildDimobFichas(sourceRows);
}

const MONTH_LABELS = [
  "JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
  "JUL", "AGO", "SET", "OUT", "NOV", "DEZ",
];

/** "2025-01-15" -> "15/01/2025"; passa adiante qualquer outro formato. */
function formatDateBr(value: string | null): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

function brl(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function csvField(value: string | number) {
  const str = String(value ?? "");
  if (/[";\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** CSV (separador ";", BOM UTF-8) — formato longo, uma linha por ficha/mês. */
export function buildDimobReportCsv(fichas: DimobFicha[], year: number): string {
  const header = [
    "ano", "locador", "cpf_locador", "locatario", "cpf_locatario",
    "numero_contrato", "data_contrato", "imovel", "municipio", "uf", "cep",
    "tipo_imovel", "mes", "ren_bruto", "comissao", "imposto_retido",
  ];
  const lines = [header.join(";")];

  for (const ficha of fichas) {
    for (const m of ficha.months) {
      lines.push(
        [
          year,
          ficha.landlordName,
          ficha.landlordDoc,
          ficha.tenantName,
          ficha.tenantDoc,
          ficha.contractNumber,
          formatDateBr(ficha.contractDate),
          ficha.propertyAddress,
          ficha.propertyCity,
          ficha.propertyState,
          ficha.propertyZip,
          ficha.propertyType,
          MONTH_LABELS[m.month - 1],
          brl(m.renBruto),
          brl(m.comissao),
          brl(m.impostoRetido),
        ]
          .map(csvField)
          .join(";"),
      );
    }
  }

  return "﻿" + lines.join("\r\n");
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fichaHtml(ficha: DimobFicha, year: number): string {
  const monthRows = ficha.months
    .map(
      (m) => `
      <tr>
        <td class="mes">${MONTH_LABELS[m.month - 1]}</td>
        <td class="num">R$ ${brl(m.renBruto)}</td>
        <td class="num">R$ ${brl(m.comissao)}</td>
        <td class="num">R$ ${brl(m.impostoRetido)}</td>
      </tr>`,
    )
    .join("");

  return `
  <section class="ficha">
    <h2>FICHA PARA INFORMAÇÃO DO DIMOB — ${year}</h2>
    <table class="cab">
      <tr><th>CPF/CNPJ do Locador</th><td>${esc(ficha.landlordDoc)}</td><th>Nome do Locador</th><td>${esc(ficha.landlordName)}</td></tr>
      <tr><th>CPF/CNPJ do Locatário</th><td>${esc(ficha.tenantDoc)}</td><th>Nome do Locatário</th><td>${esc(ficha.tenantName)}</td></tr>
      <tr><th>Nº do Contrato</th><td>${esc(ficha.contractNumber)}</td><th>Data do Contrato</th><td>${esc(formatDateBr(ficha.contractDate))}</td></tr>
      <tr><th>Endereço do Imóvel</th><td colspan="3">${esc(ficha.propertyAddress)}</td></tr>
      <tr><th>Município / UF</th><td>${esc(ficha.propertyCity)} / ${esc(ficha.propertyState)}</td><th>CEP</th><td>${esc(ficha.propertyZip)}</td></tr>
      <tr><th>Tipo de Imóvel</th><td colspan="3">${esc(ficha.propertyType)}</td></tr>
    </table>
    <table class="matriz">
      <thead>
        <tr><th class="mes">MÊS</th><th>REN. BRUTO</th><th>COMISSÃO</th><th>IMPOSTO RETIDO</th></tr>
      </thead>
      <tbody>
        ${monthRows}
        <tr class="total">
          <td class="mes">TOTAL</td>
          <td class="num">R$ ${brl(ficha.totalRenBruto)}</td>
          <td class="num">R$ ${brl(ficha.totalComissao)}</td>
          <td class="num">R$ ${brl(ficha.totalImpostoRetido)}</td>
        </tr>
      </tbody>
    </table>
  </section>`;
}

export function buildDimobReportHtml(fichas: DimobFicha[], year: number): string {
  const pages: string[] = [];
  for (let i = 0; i < fichas.length; i += 2) {
    pages.push(
      `<div class="page">${fichas
        .slice(i, i + 2)
        .map((f) => fichaHtml(f, year))
        .join("")}</div>`,
    );
  }
  const body = fichas.length
    ? pages.join("")
    : `<p class="vazio">Nenhum recibo encontrado para o ano ${year}.</p>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>DIMOB ${year}</title>
<style>
  @page { size: A4 portrait; margin: 9mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #111; margin: 0; }
  /* Duas fichas por página A4 */
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .ficha { page-break-inside: avoid; padding-bottom: 10mm; }
  .ficha h2 { font-size: 11px; text-align: center; margin: 0 0 6px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #333; padding: 2px 5px; text-align: left; vertical-align: middle; line-height: 1.15; }
  .cab { margin-bottom: 6px; }
  .cab th { background: #eee; width: 17%; white-space: nowrap; }
  .matriz th { background: #eee; text-align: center; }
  .matriz td { height: 15px; }
  .mes { font-weight: bold; width: 64px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { font-weight: bold; background: #f2f2f2; }
  .vazio { text-align: center; margin-top: 40px; font-size: 14px; }
</style>
</head>
<body>
  ${body}
</body>
</html>`;
}

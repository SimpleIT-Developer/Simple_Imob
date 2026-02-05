
import { db } from "./server/db";
import { invoices, receipts, contracts, properties, nfseEmissoes } from "./shared/schema";
import { eq, desc } from "drizzle-orm";

async function debugInvoicePropertyTypes() {
  console.log("Consultando últimas faturas e tipos de imóveis associados...");

  const recentInvoices = await db
    .select({
      invoiceId: invoices.id,
      invoiceStatus: invoices.status,
      receiptId: receipts.id,
      contractId: contracts.id,
      propertyId: properties.id,
      propertyAddress: properties.address,
      propertyType: properties.type,
      nfseStatus: nfseEmissoes.status,
      nfseXml: nfseEmissoes.apiResponseRaw // Just to check if we have emission data
    })
    .from(invoices)
    .innerJoin(receipts, eq(invoices.receiptId, receipts.id))
    .innerJoin(contracts, eq(receipts.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .leftJoin(nfseEmissoes, eq(nfseEmissoes.origemId, invoices.id))
    .orderBy(desc(invoices.createdAt))
    .limit(10);

  if (recentInvoices.length === 0) {
    console.log("Nenhuma fatura encontrada.");
  } else {
    console.table(recentInvoices.map(i => ({
      id: i.invoiceId.slice(0, 8),
      address: i.propertyAddress.slice(0, 30),
      type: `'${i.propertyType}'`, // Quote to see spaces
      nfse: i.nfseStatus
    })));
  }
  
  // Also check distinct property types in the DB
  const distinctTypes = await db.selectDistinct({ type: properties.type }).from(properties);
  console.log("\nTipos de imóvel distintos no banco:");
  console.table(distinctTypes.map(t => ({ type: `'${t.type}'` })));

  process.exit(0);
}

debugInvoicePropertyTypes().catch(console.error);

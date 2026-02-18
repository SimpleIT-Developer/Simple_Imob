import "dotenv/config";
import { db, pool } from "../server/db";
import { receipts, invoices } from "@shared/schema";
import { and, eq } from "drizzle-orm";

async function main() {
  console.log("Ajustando recibos com NF já emitida...");

  try {
    const rows = await db
      .select({
        receiptId: receipts.id,
        isInvoiceGenerated: receipts.isInvoiceGenerated,
        isInvoiceIssued: receipts.isInvoiceIssued,
        isInvoiceCancelled: receipts.isInvoiceCancelled,
        invoiceId: invoices.id,
        invoiceStatus: invoices.status,
      })
      .from(invoices)
      .innerJoin(receipts, eq(invoices.receiptId, receipts.id))
      .where(
        and(
          eq(invoices.status, "issued"),
          eq(receipts.isInvoiceGenerated, true),
          eq(receipts.isInvoiceIssued, false)
        )
      );

    console.log(`Encontrados ${rows.length} recibos para corrigir.`);

    for (const row of rows) {
      await db
        .update(receipts)
        .set({
          isInvoiceGenerated: true,
          isInvoiceIssued: true,
          isInvoiceCancelled: false,
        })
        .where(eq(receipts.id, row.receiptId));
    }

    console.log("Correção concluída.");
  } catch (error) {
    console.error("Erro ao ajustar recibos:", error);
  } finally {
    await pool.end();
  }
}

main();


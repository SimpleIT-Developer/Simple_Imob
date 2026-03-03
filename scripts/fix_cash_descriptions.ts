
import "dotenv/config";
import { db, pool } from "../server/db";
import { cashTransactions, receipts, contracts, tenants } from "../shared/schema";
import { eq, and, isNotNull } from "drizzle-orm";

async function main() {
  console.log("Starting cash transaction description update...");

  try {
    // 1. Get all cash transactions that are receipts (type IN, receiptId not null)
    const transactions = await db.select()
      .from(cashTransactions)
      .where(
        and(
          eq(cashTransactions.type, "IN"),
          isNotNull(cashTransactions.receiptId)
        )
      );

    console.log(`Found ${transactions.length} transactions to check/update.`);

    let updatedCount = 0;

    for (const tx of transactions) {
      if (!tx.receiptId) continue;

      // 2. Get Receipt
      const [receipt] = await db.select().from(receipts).where(eq(receipts.id, tx.receiptId));
      if (!receipt) {
        console.warn(`Receipt not found for transaction ${tx.id} (receiptId: ${tx.receiptId})`);
        continue;
      }

      // 3. Get Contract
      const [contract] = await db.select().from(contracts).where(eq(contracts.id, receipt.contractId));
      if (!contract) {
        console.warn(`Contract not found for receipt ${receipt.id}`);
        continue;
      }

      // 4. Get Tenant
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, contract.tenantId));
      if (!tenant) {
        console.warn(`Tenant not found for contract ${contract.id}`);
        continue;
      }

      // 5. Construct new description
      // Format: "Pagamento Recibo MM/YYYY - TENANT NAME"
      const newDescription = `Pagamento Recibo ${String(receipt.refMonth).padStart(2, "0")}/${receipt.refYear} - ${tenant.name}`;

      // 6. Update if different
      if (tx.description !== newDescription) {
        await db.update(cashTransactions)
          .set({ description: newDescription })
          .where(eq(cashTransactions.id, tx.id));
        updatedCount++;
        // console.log(`Updated tx ${tx.id}: ${tx.description} -> ${newDescription}`);
      }
    }

    console.log(`Finished! Updated ${updatedCount} transactions.`);

  } catch (error) {
    console.error("Error updating transactions:", error);
  } finally {
    await pool.end();
  }
}

main();

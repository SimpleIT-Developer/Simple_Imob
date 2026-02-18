
import { storage } from "../server/storage";

async function main() {
  try {
    const receipts = await storage.getReceipts();
    console.log("Total receipts:", receipts.length);
    for (const r of receipts) {
      console.log(`ID: ${r.id}, SlipIssued: ${r.isSlipIssued}, Digitable: ${r.slipDigitableLine}, Barcode: ${r.slipBarcode}`);
    }
  } catch (error) {
    console.error("Error:", error);
  }
  process.exit(0);
}

main();

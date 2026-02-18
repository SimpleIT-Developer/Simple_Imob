
import { storage } from "../server/storage";
import { eq } from "drizzle-orm";
import { receipts } from "@shared/schema";
import { db } from "../server/db";

// Function to convert Digitable Line to Barcode
function digitableToBarcode(line: string): string | null {
  // Remove non-digits
  const d = line.replace(/\D/g, '');
  
  if (d.length !== 47) {
    console.error(`Invalid digitable line length: ${d.length}`);
    return null;
  }

  // Field 1: AAABC.CCCCX -> 0-9 (Data 0-8, DV 9)
  // Field 2: DDDDD.DDDDDY -> 10-20 (Data 10-19, DV 20)
  // Field 3: EEEEE.EEEEEZ -> 21-31 (Data 21-30, DV 31)
  // Field 4: K -> 32
  // Field 5: UUUUVVVVVVVVVV -> 33-46

  const bank = d.substring(0, 3);
  const currency = d.substring(3, 4);
  const dv = d.substring(32, 33);
  const factor = d.substring(33, 37);
  const value = d.substring(37, 47);
  
  const freeField1 = d.substring(4, 9);
  const freeField2 = d.substring(10, 20);
  const freeField3 = d.substring(21, 31);

  // Barcode layout:
  // 0-2: Bank
  // 3: Currency
  // 4: DV (K)
  // 5-8: Factor
  // 9-18: Value
  // 19-43: Free Field (concatenated)

  const barcode = bank + currency + dv + factor + value + freeField1 + freeField2 + freeField3;
  
  return barcode;
}

async function main() {
  console.log("Fixing missing barcodes...");
  
  try {
    const allReceipts = await storage.getReceipts();
    
    for (const r of allReceipts) {
      if (r.isSlipIssued && r.slipDigitableLine && !r.slipBarcode) {
        console.log(`Fixing receipt ${r.id}...`);
        const barcode = digitableToBarcode(r.slipDigitableLine);
        
        if (barcode) {
          console.log(`Generated Barcode: ${barcode}`);
          
          // Update in DB
          await db.update(receipts)
            .set({ slipBarcode: barcode })
            .where(eq(receipts.id, r.id));
            
          console.log("Updated successfully.");
        } else {
          console.log("Could not generate barcode.");
        }
      }
    }
    
    console.log("Done.");
  } catch (error) {
    console.error("Error:", error);
  }
  process.exit(0);
}

main();

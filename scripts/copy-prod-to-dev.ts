import pg from "pg";

const { Pool } = pg;

// Get both database URLs
const devUrl = process.env.DATABASE_URL;
const prodUrl = process.env.REPLIT_PROD_DATABASE_URL || process.env.DATABASE_URL;

if (!devUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

console.log("Development DB URL length:", devUrl?.length);
console.log("Production DB URL length:", prodUrl?.length);

const devPool = new Pool({ connectionString: devUrl });
const prodPool = new Pool({ connectionString: prodUrl });

async function copyTable(tableName: string, columns: string[]) {
  try {
    const colList = columns.join(", ");
    
    // Get data from production
    const result = await prodPool.query(`SELECT ${colList} FROM ${tableName}`);
    console.log(`Found ${result.rows.length} rows in ${tableName}`);
    
    if (result.rows.length === 0) return;
    
    // Insert into development
    for (const row of result.rows) {
      const values = columns.map((_, i) => `$${i + 1}`).join(", ");
      const params = columns.map(col => row[col]);
      
      try {
        await devPool.query(
          `INSERT INTO ${tableName} (${colList}) VALUES (${values}) ON CONFLICT DO NOTHING`,
          params
        );
      } catch (err: any) {
        console.error(`Error inserting into ${tableName}:`, err.message);
      }
    }
    
    console.log(`Copied ${result.rows.length} rows to ${tableName}`);
  } catch (err: any) {
    console.error(`Error copying ${tableName}:`, err.message);
  }
}

async function main() {
  console.log("Starting data copy from production to development...\n");
  
  // Clear development tables first
  console.log("Clearing development tables...");
  await devPool.query(`
    TRUNCATE TABLE invoices, landlord_transfers, cash_transactions, receipts, 
    services, contracts, guarantors, properties, service_providers, tenants, 
    landlords, users, nfse_config, nfse_emissoes, nfse_lotes, system_logs CASCADE
  `);
  console.log("Development tables cleared.\n");
  
  // Copy tables in order of dependencies
  await copyTable("users", ["id", "name", "email", "password_hash", "role", "created_at"]);
  await copyTable("landlords", ["id", "name", "cpf_cnpj", "email", "phone", "address", "bank_name", "bank_agency", "bank_account", "bank_account_type", "pix_key", "pix_key_type", "admin_fee_percentage", "created_at"]);
  await copyTable("tenants", ["id", "name", "cpf_cnpj", "email", "phone", "address", "created_at"]);
  await copyTable("service_providers", ["id", "name", "cpf_cnpj", "service_type", "email", "phone", "created_at"]);
  await copyTable("guarantors", ["id", "tenant_id", "name", "cpf_cnpj", "email", "phone", "address", "relationship", "created_at"]);
  await copyTable("properties", ["id", "landlord_id", "address", "type", "bedrooms", "bathrooms", "area", "rent_value", "is_available", "created_at"]);
  await copyTable("contracts", ["id", "property_id", "tenant_id", "start_date", "end_date", "rent_value", "due_day", "status", "created_at"]);
  await copyTable("services", ["id", "contract_id", "service_provider_id", "description", "value", "date", "status", "created_at"]);
  await copyTable("receipts", ["id", "contract_id", "month", "year", "rent_value", "extra_charges", "discounts", "total_value", "due_date", "payment_date", "status", "created_at"]);
  await copyTable("cash_transactions", ["id", "type", "category", "description", "value", "date", "contract_id", "landlord_id", "tenant_id", "created_at"]);
  await copyTable("landlord_transfers", ["id", "landlord_id", "contract_id", "month", "year", "gross_value", "admin_fee", "net_value", "transfer_date", "status", "pix_transaction_id", "created_at"]);
  await copyTable("invoices", ["id", "receipt_id", "invoice_number", "issue_date", "status", "nf_provider_id", "created_at"]);
  await copyTable("nfse_config", ["id", "certificate_password", "certificate_path", "environment", "city_code", "company_cnpj", "company_name", "company_address", "municipal_registration", "created_at", "updated_at"]);
  await copyTable("system_logs", ["id", "action", "entity", "entity_id", "user_id", "details", "created_at"]);
  
  console.log("\nData copy complete!");
  
  await devPool.end();
  await prodPool.end();
}

main().catch(console.error);

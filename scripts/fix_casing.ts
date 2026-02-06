import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Starting casing fix migration...");

  try {
    // Users
    await db.execute(sql`
      UPDATE users SET 
        name = UPPER(name),
        email = LOWER(email)
    `);
    console.log("Updated users");

    // Landlords
    await db.execute(sql`
      UPDATE landlords SET 
        name = UPPER(name),
        email = LOWER(email),
        address = UPPER(address),
        neighborhood = UPPER(neighborhood),
        city = UPPER(city),
        state = UPPER(state),
        profession = UPPER(profession),
        nationality = UPPER(nationality),
        bank = UPPER(bank),
        branch = UPPER(branch),
        account = UPPER(account)
    `);
    console.log("Updated landlords");

    // Tenants
    await db.execute(sql`
      UPDATE tenants SET 
        name = UPPER(name),
        email = LOWER(email),
        address = UPPER(address),
        neighborhood = UPPER(neighborhood),
        city = UPPER(city),
        state = UPPER(state),
        profession = UPPER(profession),
        class = UPPER(class)
    `);
    console.log("Updated tenants");

    // Guarantors
    await db.execute(sql`
      UPDATE guarantors SET 
        name = UPPER(name),
        email = LOWER(email),
        address = UPPER(address),
        neighborhood = UPPER(neighborhood),
        city = UPPER(city),
        state = UPPER(state),
        profession = UPPER(profession),
        spouse_name = UPPER(spouse_name),
        class = UPPER(class)
    `);
    console.log("Updated guarantors");

    // Properties
    await db.execute(sql`
      UPDATE properties SET 
        title = UPPER(title),
        type = UPPER(type),
        sale_rent = UPPER(sale_rent),
        address = UPPER(address),
        neighborhood = UPPER(neighborhood),
        city = UPPER(city),
        state = UPPER(state)
    `);
    console.log("Updated properties");

    // Service Providers
    await db.execute(sql`
      UPDATE service_providers SET 
        name = UPPER(name),
        email = LOWER(email),
        service_type = UPPER(service_type)
    `);
    console.log("Updated service_providers");

    // Services
    await db.execute(sql`
      UPDATE services SET 
        description = UPPER(description)
    `);
    console.log("Updated services");

    console.log("Migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await pool.end();
  }
}

main();

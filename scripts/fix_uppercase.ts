
import "dotenv/config";
import { db, pool } from "../server/db";
import { landlords, tenants, guarantors, serviceProviders, properties } from "@shared/schema";
import { eq } from "drizzle-orm";

// Helper to normalize data (uppercase strings, lowercase emails) - duplicated from routes.ts for standalone execution
function normalizeData(data: any) {
  if (!data || typeof data !== 'object') return data;
  
  const newData = { ...data };
  
  // Fields to always lowercase
  const lowerCaseFields = ['email', 'tomadorEmail', 'email_corporativo'];
  
  // Fields to preserve (do not change case)
  const preserveFields = [
    'id', 'password', 'passwordHash', 'pixKey', 'pixKeyType', 'status',
    'slipPdfUrl', 'slipOurNumber', 'slipDigitableLine', 'slipBarcode',
    'xmlUrl', 'pdfUrl', 'chaveAcesso', 'codigoVerificacao',
    'details', 'tomadorEnderecoJson', 'apiRequestRaw', 'apiResponseRaw',
    'certificatePassword', 'certificadoSenha'
  ];

  for (const key of Object.keys(newData)) {
    if (typeof newData[key] === 'string') {
      // Check if it's a URL field by convention (ends with Url or starts with url)
      const isUrl = key.endsWith('Url') || key.startsWith('url');
      const isId = key.endsWith('Id'); // Foreign keys usually

      if (lowerCaseFields.includes(key)) {
        newData[key] = newData[key].toLowerCase();
      } else if (!preserveFields.includes(key) && !isUrl && !isId) {
        newData[key] = newData[key].toUpperCase();
      }
    }
  }
  return newData;
}

async function main() {
  console.log("Starting database normalization...");

  try {
    // 1. Landlords
    console.log("Processing Landlords...");
    const allLandlords = await db.select().from(landlords);
    let landlordsCount = 0;
    for (const entity of allLandlords) {
      const normalized = normalizeData(entity);
      // Check if anything changed to avoid unnecessary updates
      let changed = false;
      for (const key in entity) {
        if (entity[key as keyof typeof entity] !== normalized[key]) {
          changed = true;
          break;
        }
      }
      
      if (changed) {
        await db.update(landlords)
          .set(normalized)
          .where(eq(landlords.id, entity.id));
        landlordsCount++;
      }
    }
    console.log(`Updated ${landlordsCount} landlords.`);

    // 2. Tenants
    console.log("Processing Tenants...");
    const allTenants = await db.select().from(tenants);
    let tenantsCount = 0;
    for (const entity of allTenants) {
      const normalized = normalizeData(entity);
      let changed = false;
      for (const key in entity) {
        if (entity[key as keyof typeof entity] !== normalized[key]) {
          changed = true;
          break;
        }
      }
      if (changed) {
        await db.update(tenants)
          .set(normalized)
          .where(eq(tenants.id, entity.id));
        tenantsCount++;
      }
    }
    console.log(`Updated ${tenantsCount} tenants.`);

    // 3. Guarantors
    console.log("Processing Guarantors...");
    const allGuarantors = await db.select().from(guarantors);
    let guarantorsCount = 0;
    for (const entity of allGuarantors) {
      const normalized = normalizeData(entity);
      let changed = false;
      for (const key in entity) {
        if (entity[key as keyof typeof entity] !== normalized[key]) {
          changed = true;
          break;
        }
      }
      if (changed) {
        await db.update(guarantors)
          .set(normalized)
          .where(eq(guarantors.id, entity.id));
        guarantorsCount++;
      }
    }
    console.log(`Updated ${guarantorsCount} guarantors.`);

    // 4. Service Providers
    console.log("Processing Service Providers...");
    const allServiceProviders = await db.select().from(serviceProviders);
    let spCount = 0;
    for (const entity of allServiceProviders) {
      const normalized = normalizeData(entity);
      let changed = false;
      for (const key in entity) {
        if (entity[key as keyof typeof entity] !== normalized[key]) {
          changed = true;
          break;
        }
      }
      if (changed) {
        await db.update(serviceProviders)
          .set(normalized)
          .where(eq(serviceProviders.id, entity.id));
        spCount++;
      }
    }
    console.log(`Updated ${spCount} service providers.`);

    // 5. Properties
    console.log("Processing Properties...");
    const allProperties = await db.select().from(properties);
    let propertiesCount = 0;
    for (const entity of allProperties) {
      const normalized = normalizeData(entity);
      let changed = false;
      for (const key in entity) {
        if (entity[key as keyof typeof entity] !== normalized[key]) {
          changed = true;
          break;
        }
      }
      if (changed) {
        await db.update(properties)
          .set(normalized)
          .where(eq(properties.id, entity.id));
        propertiesCount++;
      }
    }
    console.log(`Updated ${propertiesCount} properties.`);

    console.log("Normalization complete!");
  } catch (error) {
    console.error("Error during normalization:", error);
  } finally {
    await pool.end();
  }
}

main();

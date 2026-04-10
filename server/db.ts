import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn(
    "DATABASE_URL must be set. Did you forget to provision a database?\n" +
      "Falling back to memory storage if available."
  );
} else {
  console.log("Database connection initialized with URL length:", process.env.DATABASE_URL.length);
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres" });
export const db = drizzle(pool, { schema });

export async function ensureReceiptDiscountColumn() {
  const client = await pool.connect();
  try {
    await client.query(
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_discount_to') THEN CREATE TYPE receipt_discount_to AS ENUM ('TENANT','LANDLORD','BOTH'); END IF; END $$;"
    );
    await client.query(
      "ALTER TABLE services ADD COLUMN IF NOT EXISTS receipt_discount_to receipt_discount_to;"
    );
    await client.query(
      "ALTER TABLE properties ADD COLUMN IF NOT EXISTS landlord_shares jsonb NOT NULL DEFAULT '[]'::jsonb;"
    );
    await client.query(
      "ALTER TABLE receipts ADD COLUMN IF NOT EXISTS landlord_split_override jsonb NULL;"
    );
  } finally {
    client.release();
  }
}

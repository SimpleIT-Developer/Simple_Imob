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

export async function ensurePixTransferAttemptInfrastructure() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS pix_transfer_attempts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        transfer_id varchar NOT NULL REFERENCES landlord_transfers(id) ON DELETE CASCADE,
        receipt_id varchar NULL REFERENCES receipts(id) ON DELETE SET NULL,
        contract_id varchar NULL REFERENCES contracts(id) ON DELETE SET NULL,
        property_id varchar NULL REFERENCES properties(id) ON DELETE SET NULL,
        landlord_id varchar NULL REFERENCES landlords(id) ON DELETE SET NULL,
        amount numeric(10,2) NOT NULL,
        pix_key text NOT NULL,
        pix_key_type text NULL,
        bank_api text NOT NULL,
        request_id text NOT NULL,
        dedupe_key text NOT NULL,
        status text NOT NULL,
        reference text NULL,
        payload_sent text NULL,
        response_received text NULL,
        error_message text NULL,
        provider_transfer_id text NULL,
        provider_status text NULL,
        request_sent_at timestamp NULL,
        response_received_at timestamp NULL,
        created_by_user_id varchar NULL REFERENCES users(id) ON DELETE SET NULL,
        request_ip text NULL,
        user_agent text NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pix_transfer_attempts_request_id_uidx
      ON pix_transfer_attempts (request_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS pix_transfer_attempts_transfer_idx
      ON pix_transfer_attempts (transfer_id, created_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS pix_transfer_attempts_provider_transfer_idx
      ON pix_transfer_attempts (provider_transfer_id);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pix_transfer_attempts_dedupe_blocking_uidx
      ON pix_transfer_attempts (dedupe_key)
      WHERE status IN ('PENDENTE', 'ENVIANDO', 'ENVIADO', 'CONFIRMADO', 'ERRO_CONFIRMAR');
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pix_transfer_attempts_transfer_blocking_uidx
      ON pix_transfer_attempts (transfer_id)
      WHERE status IN ('PENDENTE', 'ENVIANDO', 'ENVIADO', 'CONFIRMADO', 'ERRO_CONFIRMAR');
    `);
  } finally {
    client.release();
  }
}

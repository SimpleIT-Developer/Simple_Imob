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

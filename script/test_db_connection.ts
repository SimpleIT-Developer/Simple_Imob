
import pkg from 'pg';
const { Client } = pkg;
import 'dotenv/config';

async function testConnection() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL not found in environment");
    return;
  }

  console.log("Testing connection to:", connectionString.replace(/:[^:@]*@/, ":***@")); // Hide password

  const client = new Client({
    connectionString,
  });

  try {
    console.log("Connecting...");
    await client.connect();
    console.log("Connected! Attempting query...");
    const res = await client.query('SELECT 1 as result');
    console.log("Query success:", res.rows[0]);
    await client.end();
  } catch (err: any) {
    console.error("Connection error details:", {
      message: err.message,
      code: err.code,
      detail: err.detail,
      hint: err.hint,
      host: err.address,
      port: err.port
    });
  }
}

testConnection();


import 'dotenv/config';
import { db } from '../server/db';
import { tenants } from '../shared/schema';

async function verify() {
  const allTenants = await db.select().from(tenants).limit(5);
  console.log(JSON.stringify(allTenants, null, 2));
  process.exit(0);
}

verify();

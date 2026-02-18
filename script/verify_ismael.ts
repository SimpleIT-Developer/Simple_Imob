
import 'dotenv/config';
import { db } from '../server/db';
import { tenants } from '../shared/schema';
import { eq, like } from 'drizzle-orm';

async function verifyIsmael() {
  const results = await db.select().from(tenants).where(like(tenants.name, '%ISMAEL MENDES%'));
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

verifyIsmael();

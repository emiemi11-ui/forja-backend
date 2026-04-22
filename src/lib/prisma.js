import { PrismaClient } from '@prisma/client';

// Auto-enable SSL for cloud databases (Neon, Supabase, Railway, Render) if the
// connection URL doesn't already specify sslmode. Prisma forwards the string
// to the Postgres driver, so appending `sslmode=require` works.
function ensureSslInUrl(url) {
  if (!url) return url;
  if (/sslmode=/i.test(url)) return url;
  const cloudPatterns = /neon\.tech|supabase\.co|railway\.app|railway\.internal|render\.com|\.aws\.|aivencloud/i;
  if (cloudPatterns.test(url) || process.env.PGSSL === 'true') {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}sslmode=require`;
  }
  return url;
}

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = ensureSslInUrl(process.env.DATABASE_URL);
}
if (process.env.DIRECT_URL) {
  process.env.DIRECT_URL = ensureSslInUrl(process.env.DIRECT_URL);
}

const globalForPrisma = globalThis;

const prisma = globalForPrisma.__forjaPrisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__forjaPrisma = prisma;
}

export default prisma;

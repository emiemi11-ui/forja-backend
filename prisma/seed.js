import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seed: nothing to do.');
  console.log('   Admin user is created/updated by prisma/ensure-launch-admin.js on every deploy.');
  console.log('   All other users register themselves through the app.');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

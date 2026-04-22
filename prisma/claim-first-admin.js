import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function usage() {
  console.log('Usage: node prisma/claim-first-admin.js <email>');
  console.log('Promovează contul existent la ADMIN dacă nu există încă un admin real.');
}

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    usage();
    process.exitCode = 1;
    return;
  }

  const [realAdmin, user] = await Promise.all([
    prisma.user.findFirst({
      where: { role: 'ADMIN', isDemo: false },
      select: { id: true, email: true, name: true },
    }),
    prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, isDemo: true, plan: true },
    }),
  ]);

  if (!user) {
    console.error(`Nu există niciun utilizator cu emailul ${email}.`);
    process.exitCode = 1;
    return;
  }

  if (user.isDemo) {
    console.error('Contul demo nu poate fi promovat la admin real.');
    process.exitCode = 1;
    return;
  }

  if (realAdmin && realAdmin.email !== user.email) {
    console.error(`Există deja un admin real: ${realAdmin.email}.`);
    process.exitCode = 1;
    return;
  }

  if (user.role === 'ADMIN') {
    console.log(`Contul ${user.email} este deja ADMIN.`);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { role: 'ADMIN', plan: 'PRO' },
  });

  console.log(`Contul ${user.email} a fost promovat la ADMIN.`);
  console.log('Reconectează-te în aplicație după această operațiune.');
}

main()
  .catch((error) => {
    console.error('Eroare la promovarea adminului:', error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

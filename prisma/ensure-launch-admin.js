import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@forja.ro';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin1234';
const DEFAULT_ADMIN_NAME = process.env.ADMIN_NAME || 'FORJA Admin';

async function ensureUserGoals(userId) {
  const existingGoals = await prisma.userGoals.findUnique({ where: { userId } });
  if (!existingGoals) {
    await prisma.userGoals.create({ data: { userId } });
  }
}

async function main() {
  const realAdmins = await prisma.user.findMany({
    where: { role: 'ADMIN', isDemo: false },
    select: { id: true, email: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const existingByEmail = await prisma.user.findUnique({ where: { email: DEFAULT_ADMIN_EMAIL } });
  const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);

  if (existingByEmail) {
    const updated = await prisma.user.update({
      where: { id: existingByEmail.id },
      data: {
        name: existingByEmail.name || DEFAULT_ADMIN_NAME,
        password: hashedPassword,
        role: 'ADMIN',
        plan: 'PRO',
        isDemo: false,
        blocked: false,
        avatar: (existingByEmail.avatar || DEFAULT_ADMIN_NAME.charAt(0) || 'A').toUpperCase(),
      },
      select: { id: true, email: true, name: true },
    });
    await ensureUserGoals(updated.id);
    console.log(`✅ Admin pregătit: ${updated.email} (${updated.name})`);
    return;
  }

  if (realAdmins.length > 0) {
    console.log(`ℹ️ Există deja un admin real: ${realAdmins[0].email}. Nu am creat altul.`);
    return;
  }

  const created = await prisma.user.create({
    data: {
      email: DEFAULT_ADMIN_EMAIL,
      password: hashedPassword,
      name: DEFAULT_ADMIN_NAME,
      role: 'ADMIN',
      plan: 'PRO',
      avatar: (DEFAULT_ADMIN_NAME.charAt(0) || 'A').toUpperCase(),
      isDemo: false,
      blocked: false,
    },
    select: { id: true, email: true, name: true },
  });

  await ensureUserGoals(created.id);
  console.log(`✅ Admin creat: ${created.email} (${created.name})`);
}

main()
  .catch((error) => {
    console.error('❌ Nu am putut pregăti adminul de lansare:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

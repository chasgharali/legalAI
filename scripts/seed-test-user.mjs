import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: '.env.local' });
dotenv.config();

const prisma = new PrismaClient();

const TEST_USER_EMAIL = process.env.SEED_TEST_USER_EMAIL ?? 'test@legalai.local';
const TEST_USER_PASSWORD = process.env.SEED_TEST_USER_PASSWORD ?? 'Test1234!';
const TEST_USER_NAME = process.env.SEED_TEST_USER_NAME ?? 'Test User';
const TEST_USER_ROLE = process.env.SEED_TEST_USER_ROLE ?? 'admin';
const TEST_FIRM_NAME = process.env.SEED_TEST_FIRM_NAME ?? 'Demo Legal';
const TEST_FIRM_SLUG = process.env.SEED_TEST_FIRM_SLUG ?? 'demo-legal';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is missing. Set it in .env.local (or your environment) before seeding.'
    );
  }

  const passwordHash = await bcrypt.hash(TEST_USER_PASSWORD, 12);

  let firm = await prisma.firm.findUnique({
    where: { slug: TEST_FIRM_SLUG },
  });

  if (firm) {
    firm = await prisma.firm.update({
      where: { id: firm.id },
      data: { name: TEST_FIRM_NAME },
    });
  } else {
    firm = await prisma.firm.create({
      data: { slug: TEST_FIRM_SLUG, name: TEST_FIRM_NAME },
    });
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: TEST_USER_EMAIL },
  });

  let user;
  if (existingUser) {
    user = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name: TEST_USER_NAME,
        role: TEST_USER_ROLE,
        passwordHash,
        firmId: firm.id,
      },
    });
  } else {
    user = await prisma.user.create({
      data: {
        email: TEST_USER_EMAIL,
        name: TEST_USER_NAME,
        role: TEST_USER_ROLE,
        passwordHash,
        firmId: firm.id,
      },
    });
  }

  console.log('Seed complete.');
  console.log(`Email: ${user.email}`);
  console.log(`Password: ${TEST_USER_PASSWORD}`);
  console.log(`Firm: ${firm.name} (${firm.slug})`);
  console.log(`Role: ${user.role}`);
}

main()
  .catch((error) => {
    console.error('Failed to seed test user:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

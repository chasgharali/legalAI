import { config } from 'dotenv';
config({ path: '.env.local' });

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create firm
  const firm = await prisma.firm.upsert({
    where: { slug: 'legal-ai-demo' },
    update: {},
    create: {
      name: 'Legal AI Demo Firm',
      slug: 'legal-ai-demo',
    },
  });
  console.log(`✅ Firm: ${firm.name}`);

  // Create admin user
  const passwordHash = await bcrypt.hash('Test1234!', 12);
  const user = await prisma.user.upsert({
    where: { email: 'test@legalai.local' },
    update: { passwordHash },
    create: {
      email: 'test@legalai.local',
      name: 'Test User',
      passwordHash,
      role: 'admin',
      firmId: firm.id,
    },
  });
  console.log(`✅ User: ${user.email} / Test1234!`);

  // Create a sample matter (idempotent via deleteMany + create)
  await prisma.matter.deleteMany({ where: { reference: 'MC/2024/001', firmId: firm.id } });
  const matter = await prisma.matter.create({
    data: {
      reference: 'MC/2024/001',
      clientName: 'John Smith',
      clientDob: new Date('1975-06-15'),
      incidentDate: new Date('2023-03-10'),
      claimType: 'clinical_negligence',
      status: 'ready',
      notes: 'Sample matter for demo purposes.',
      firmId: firm.id,
      assignedToId: user.id,
    },
  });
  console.log(`✅ Matter: ${matter.reference} — ${matter.clientName}`);

  console.log('\n🎉 Seed complete.');
  console.log('   Login → http://localhost:3001/login');
  console.log('   Email:    test@legalai.local');
  console.log('   Password: Test1234!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

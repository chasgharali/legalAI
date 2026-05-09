import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  const { name, email, password, firmName, firmSlug } = await req.json();

  if (!name || !email || !password || !firmName) {
    return NextResponse.json({ error: 'All fields required' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const slug = firmSlug || firmName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  let firm = await prisma.firm.findUnique({ where: { slug } });

  if (!firm) {
    firm = await prisma.firm.create({ data: { name: firmName, slug } });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      firmId: firm.id,
      role: 'admin',
    },
  });

  return NextResponse.json(
    { success: true, userId: user.id, firmId: firm.id },
    { status: 201 }
  );
}

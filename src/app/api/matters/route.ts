import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { generateMatterReference } from '@/lib/utils';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const search = searchParams.get('search');

  const where: Record<string, unknown> = {
    firmId: (session.user as { firmId: string }).firmId,
  };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { clientName: { contains: search, mode: 'insensitive' } },
      { reference: { contains: search, mode: 'insensitive' } },
    ];
  }

  const matters = await prisma.matter.findMany({
    where,
    include: {
      assignedTo: { select: { id: true, name: true, email: true } },
      _count: { select: { documents: true, chronology: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json(matters);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const { clientName, clientDob, incidentDate, claimType, notes } = body;

  if (!clientName || !claimType) {
    return NextResponse.json({ error: 'clientName and claimType are required' }, { status: 400 });
  }

  const user = session.user as { id: string; firmId: string };

  // Enforce firm plan & monthly matter limit. Admin can override via the
  // /admin/firms detail page. Super_admin role bypasses the check entirely.
  const firm = await prisma.firm.findUnique({ where: { id: user.firmId } });
  if (!firm) {
    return NextResponse.json({ error: 'Firm not found' }, { status: 404 });
  }
  if (firm.status !== 'active') {
    return NextResponse.json(
      { error: `Firm is ${firm.status}. Contact support to reactivate.` },
      { status: 403 }
    );
  }
  if (
    (session.user as { role?: string }).role !== 'super_admin' &&
    firm.monthlyMatterLimit !== null &&
    firm.mattersUsedThisMonth >= firm.monthlyMatterLimit
  ) {
    return NextResponse.json(
      {
        error: `Monthly matter limit reached (${firm.monthlyMatterLimit}). Upgrade your plan or wait until next month's reset.`,
        code: 'LIMIT_REACHED',
      },
      { status: 402 }
    );
  }

  const matter = await prisma.matter.create({
    data: {
      reference: body.reference || generateMatterReference(),
      clientName,
      clientDob: clientDob ? new Date(clientDob) : null,
      incidentDate: incidentDate ? new Date(incidentDate) : null,
      claimType,
      notes,
      firmId: user.firmId,
      assignedToId: user.id,
      status: 'draft',
    },
  });

  // Increment usage counter.
  await prisma.firm.update({
    where: { id: user.firmId },
    data: { mattersUsedThisMonth: { increment: 1 } },
  });

  return NextResponse.json(matter, { status: 201 });
}

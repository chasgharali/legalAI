import { prisma } from './db/prisma';

export async function logAudit(params: {
  userId: string;
  matterId?: string;
  action: string;
  details?: string;
  ipAddress?: string;
}) {
  try {
    await prisma.auditLog.create({ data: params });
  } catch {
    // Never let audit failures break the main flow
  }
}

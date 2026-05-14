import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function getPrismaDatasourceUrl(): string | undefined {
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl) return undefined;

  // Some local DNS setups (or accidentally exported shell vars) can append
  // ".local" to Atlas hosts, breaking SRV resolution.
  if (!rawUrl.includes('.mongodb.net.local')) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'mongodb+srv:') return rawUrl;
    if (!parsed.hostname.endsWith('.mongodb.net.local')) return rawUrl;

    parsed.hostname = parsed.hostname.replace(/\.local$/, '');
    return parsed.toString();
  } catch {
    // Keep the original value if parsing fails; Prisma will throw a clearer error.
    return rawUrl;
  }
}

function createPrismaClient() {
  return new PrismaClient({
    datasourceUrl: getPrismaDatasourceUrl(),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

function isStaleClient(client: PrismaClient) {
  const withDelegates = client as PrismaClient & {
    conversationMessage?: unknown;
  };
  return typeof withDelegates.conversationMessage === 'undefined';
}

const cachedPrisma = globalForPrisma.prisma;
if (cachedPrisma && isStaleClient(cachedPrisma)) {
  // Hot reload can keep an old Prisma client instance alive in development
  // after schema changes add new delegates (e.g. conversationMessage).
  void cachedPrisma.$disconnect().catch(() => undefined);
  globalForPrisma.prisma = createPrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

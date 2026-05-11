import { config } from 'dotenv';
config({ path: '.env.local' });

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// 1. Demo firm + super-admin user + sample matter
// ---------------------------------------------------------------------------

async function seedDemoFirm() {
  // Older local datasets may contain a demo firm with createdAt = null from
  // before this field was enforced as non-nullable in Prisma.
  // Normalize it first so upsert can safely deserialize the record.
  await prisma.firm.updateMany({
    where: { slug: 'legal-ai-demo' },
    data: { createdAt: new Date() },
  });

  const firm = await prisma.firm.upsert({
    where: { slug: 'legal-ai-demo' },
    update: {},
    create: {
      name: 'Legal AI Demo Firm',
      slug: 'legal-ai-demo',
      plan: 'growth',
      monthlyMatterLimit: 50,
    },
  });
  console.log(`✅ Firm: ${firm.name}`);

  // Demo fee-earner user
  const passwordHash = await bcrypt.hash('Test1234!', 12);
  const user = await prisma.user.upsert({
    where: { email: 'test@legalai.local' },
    update: { passwordHash },
    create: {
      email: 'test@legalai.local',
      name: 'Test User',
      passwordHash,
      role: 'fee_earner',
      firmId: firm.id,
    },
  });
  console.log(`✅ Fee-earner user: ${user.email} / Test1234!`);

  // Super admin user (platform operator). Uses the same firm for foreign-key,
  // but the role grants /admin/* access regardless of firm scope.
  const adminPassword = await bcrypt.hash('Admin1234!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@medchron.ai' },
    update: { passwordHash: adminPassword, role: 'super_admin' },
    create: {
      email: 'admin@medchron.ai',
      name: 'Platform Admin',
      passwordHash: adminPassword,
      role: 'super_admin',
      firmId: firm.id,
    },
  });
  console.log(`✅ Super admin: ${admin.email} / Admin1234!`);

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
}

// ---------------------------------------------------------------------------
// 2. Marketing prospects — imported from uk_clinical_negligence_lawyers.csv
// ---------------------------------------------------------------------------

interface CsvRow {
  firmName: string;
  city: string;
  region: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  side: string;
  specialism: string;
}

/**
 * Minimal RFC-4180-ish CSV parser — handles quoted fields with commas.
 * Sufficient for the file we generated.
 */
function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = parseLine(lines[0]);
  const headerMap: Record<string, number> = {};
  header.forEach((h, i) => {
    headerMap[h.trim().toLowerCase()] = i;
  });

  const idx = (key: string) => headerMap[key.toLowerCase()] ?? -1;

  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const at = (i: number) => (i >= 0 && i < cells.length ? cells[i].trim() : '');
    return {
      firmName: at(idx('Firm Name')),
      city: at(idx('City')),
      region: at(idx('Region')),
      address: at(idx('Full Address')),
      phone: at(idx('Phone')),
      email: at(idx('Email')),
      website: at(idx('Website')),
      side: at(idx('Side')),
      specialism: at(idx('Notable Specialism')),
    };
  });
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"') {
        inQ = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

function icpScoreFor(row: CsvRow): number {
  // Heuristic — AvMA-tier and Chambers Band 1 firms get higher scores.
  let score = 50;
  const s = (row.specialism + ' ' + row.firmName).toLowerCase();
  if (/avma|band\s*1|tier\s*1|legal\s*aid/.test(s)) score += 25;
  if (/birth\s*injury|cerebral\s*palsy|brain\s*injury|spinal/.test(s)) score += 10;
  if (row.side?.toLowerCase() === 'claimant') score += 8;
  if (row.email && !/use\s*enquiry|enquiry\s*form/i.test(row.email)) score += 7;
  return Math.max(0, Math.min(100, score));
}

async function seedProspects() {
  // Look for the CSV next to the project root.
  const candidates = [
    join(process.cwd(), 'uk_clinical_negligence_lawyers.csv'),
    join(process.cwd(), '..', 'uk_clinical_negligence_lawyers.csv'),
  ];
  const csvPath = candidates.find((p) => existsSync(p));
  if (!csvPath) {
    console.log(
      `⚠️  Could not find uk_clinical_negligence_lawyers.csv — skipping prospect import.`
    );
    console.log(`   Tried:\n   ${candidates.join('\n   ')}`);
    return;
  }
  const text = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    if (!row.firmName) continue;
    const emailIsForm = !row.email || /use\s*enquiry|enquiry\s*form/i.test(row.email);
    const cleanEmail = emailIsForm ? null : row.email;

    const existing = await prisma.marketingProspect.findUnique({
      where: { firmName: row.firmName },
    });
    const data = {
      firmName: row.firmName,
      city: row.city || null,
      region: row.region || null,
      address: row.address || null,
      phone: row.phone || null,
      email: cleanEmail,
      website: row.website || null,
      side: row.side || null,
      specialism: row.specialism || null,
      icpScore: icpScoreFor(row),
      source: 'csv-2026-05',
    };
    if (existing) {
      await prisma.marketingProspect.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.marketingProspect.create({ data });
      created++;
    }
  }
  console.log(`✅ Prospects: ${created} created, ${updated} updated (total ${rows.length} rows).`);
}

// ---------------------------------------------------------------------------
// 3. Default email templates + a 4-step cold outreach sequence
// ---------------------------------------------------------------------------

const TEMPLATES: Array<{
  name: string;
  subject: string;
  preheader: string;
  tier: string;
  body: string;
}> = [
  {
    name: 'avma-cold-1-intro',
    subject: 'Cutting chronology time at {{firm_name}}',
    preheader: 'A 15-min look at how AvMA panel firms are using AI for medical chronologies.',
    tier: 'avma',
    body: `Hi {{first_name}},

I'm {{sender_name}} — I've been building **MedChron AI**, a tool that turns a 5,000-page medical bundle into a barrister-ready chronology in minutes, with every entry source-anchored and reviewable by a fee earner.

I reached out because {{firm_name}} is one of the leading {{specialism}} practices in {{city}}, and there's a real fit. Two of your paralegals could verify three chronologies in the time it currently takes them to draft one.

Worth a 15-minute call this week? I can walk you through a real case file and you can decide on the spot whether it's useful.

[See a 90-second preview]({{pitch_url}})

Either way — thank you for the work you do.

{{sender_name}}
{{sender_title}}`,
  },
  {
    name: 'avma-cold-2-followup',
    subject: 'Re: chronologies — quick numbers',
    preheader: 'Time saved per case + how the verification workflow handles SRA risk.',
    tier: 'avma',
    body: `Hi {{first_name}},

Following up on my note about MedChron AI. Two specifics that usually move the conversation:

**Time saved per case.** Beta firms are clocking 6-9 hours saved on a 3,000-page bundle. At paralegal cost that's ~£500 reclaimed per matter.

**SRA risk.** Every AI-extracted entry has a verbatim quote and a real source page. A fee earner clicks "verified" before any bundle is disclosed. Watermarked "AI-Generated — Review Required" until that happens. We built this specifically so panel firms can use AI without compromising professional duty.

Happy to send a deck, or jump on a call — whichever's easier.

{{sender_name}}`,
  },
  {
    name: 'avma-cold-3-case-study',
    subject: 'How one firm cut a 4,800-page bundle to half a day',
    preheader: 'Specific case file walkthrough — birth injury, 4,800 pages, 6 hours.',
    tier: 'avma',
    body: `Hi {{first_name}},

One more — promise. A clinical-negligence practice we work with had a birth-injury matter: 4,800 pages of GP, hospital and consultant records spanning 19 years.

Their paralegal would normally spend ~3 working days on chronology and bundle. With MedChron:
- OCR + extraction: 12 minutes
- Paralegal verification of 340 entries: 4 hours
- Barrister bundle PDF, paginated, source-cited: 1 click

Total: half a day. The fee earner spotted two treatment gaps and one inconsistency that hadn't been caught in the manual review.

If that resonates for {{firm_name}}, even a brief reply tells me whether to keep in touch.

{{sender_name}}`,
  },
  {
    name: 'avma-cold-4-breakup',
    subject: 'Closing the loop',
    preheader: 'No reply needed — just signing off.',
    tier: 'avma',
    body: `Hi {{first_name}},

I won't keep emailing — I know your inbox is full. If chronology workload at {{firm_name}} ever becomes a real bottleneck, my door's open: just reply to this thread and I'll set up a call.

All the best with the work you're doing.

{{sender_name}}`,
  },
];

async function seedTemplatesAndSequence() {
  const created: Record<string, string> = {};
  for (const t of TEMPLATES) {
    const tpl = await prisma.emailTemplate.upsert({
      where: { name: t.name },
      update: { subject: t.subject, body: t.body, preheader: t.preheader, tier: t.tier },
      create: t,
    });
    created[t.name] = tpl.id;
  }
  console.log(`✅ Templates: ${Object.keys(created).length} upserted.`);

  const steps = [
    { stepIndex: 0, templateId: created['avma-cold-1-intro'], delayDays: 0 },
    { stepIndex: 1, templateId: created['avma-cold-2-followup'], delayDays: 3 },
    { stepIndex: 2, templateId: created['avma-cold-3-case-study'], delayDays: 7 },
    { stepIndex: 3, templateId: created['avma-cold-4-breakup'], delayDays: 11 },
  ];

  await prisma.emailSequence.upsert({
    where: { name: 'AvMA cold outreach — 4 touch' },
    update: { steps, isActive: true },
    create: { name: 'AvMA cold outreach — 4 touch', steps, isActive: true },
  });
  console.log(`✅ Sequence: AvMA cold outreach — 4 touch (4 steps).`);
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('🌱 Seeding database...\n');
  await seedDemoFirm();
  console.log('');
  await seedProspects();
  console.log('');
  await seedTemplatesAndSequence();
  console.log('\n🎉 Seed complete.');
  console.log('\n   Customer login:   test@legalai.local / Test1234!');
  console.log('   Super admin:      admin@medchron.ai / Admin1234!');
  console.log('   Admin dashboard:  http://localhost:3000/admin\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

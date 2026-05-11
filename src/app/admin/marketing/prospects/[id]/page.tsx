import { prisma } from '@/lib/db/prisma';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import {
  defaultPersonalizationContext,
  personalize,
  sendEmail,
} from '@/lib/email';

export const dynamic = 'force-dynamic';

async function updateStatus(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? 'cold');
  const notes = String(formData.get('notes') ?? '') || null;
  if (!id) return;
  await prisma.marketingProspect.update({
    where: { id },
    data: { status, notes },
  });
  revalidatePath(`/admin/marketing/prospects/${id}`);
  revalidatePath('/admin/marketing/prospects');
}

async function sendOneOffEmail(formData: FormData) {
  'use server';
  const prospectId = String(formData.get('prospectId') ?? '');
  const templateId = String(formData.get('templateId') ?? '');
  if (!prospectId || !templateId) return;

  const [prospect, template] = await Promise.all([
    prisma.marketingProspect.findUnique({ where: { id: prospectId } }),
    prisma.emailTemplate.findUnique({ where: { id: templateId } }),
  ]);
  if (!prospect || !template) return;
  if (!prospect.email) {
    throw new Error('Prospect has no email address.');
  }

  const ctx = {
    ...defaultPersonalizationContext(),
    firm_name: prospect.firmName,
    city: prospect.city,
    specialism: prospect.specialism,
    side: prospect.side,
    first_name: null,
  };
  const subject = personalize(template.subject, ctx);
  const body = personalize(template.body, ctx);

  const result = await sendEmail({
    to: prospect.email,
    subject,
    bodyText: body,
    tags: { prospectId, templateId },
  });

  await prisma.emailSend.create({
    data: {
      prospectId,
      templateId,
      fromEmail: ctx.sender_email,
      toEmail: prospect.email,
      subject,
      bodyHtml: body,
      status: result.status,
      providerMsgId: result.providerMsgId ?? undefined,
      errorMessage: result.error,
      sentAt: result.status === 'sent' ? new Date() : null,
    },
  });

  await prisma.marketingProspect.update({
    where: { id: prospectId },
    data: {
      lastContactedAt: new Date(),
      firstContactedAt: prospect.firstContactedAt ?? new Date(),
      status:
        prospect.status === 'cold' || prospect.status === 'declined'
          ? 'contacted'
          : prospect.status,
    },
  });

  revalidatePath(`/admin/marketing/prospects/${prospectId}`);
}

async function enrollInSequence(formData: FormData) {
  'use server';
  const prospectId = String(formData.get('prospectId') ?? '');
  const sequenceId = String(formData.get('sequenceId') ?? '');
  if (!prospectId || !sequenceId) return;

  // First step fires immediately.
  await prisma.prospectSequenceState.upsert({
    where: { prospectId_sequenceId: { prospectId, sequenceId } },
    update: { status: 'active', currentStepIndex: 0, nextSendAt: new Date() },
    create: {
      prospectId,
      sequenceId,
      status: 'active',
      currentStepIndex: 0,
      nextSendAt: new Date(),
    },
  });
  revalidatePath(`/admin/marketing/prospects/${prospectId}`);
}

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [prospect, templates, sequences] = await Promise.all([
    prisma.marketingProspect.findUnique({
      where: { id },
      include: {
        sends: { orderBy: { createdAt: 'desc' }, include: { template: true } },
        sequenceState: { include: { sequence: true } },
      },
    }),
    prisma.emailTemplate.findMany({ orderBy: { name: 'asc' } }),
    prisma.emailSequence.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);
  if (!prospect) notFound();

  return (
    <div className="p-8 max-w-5xl">
      <Link href="/admin/marketing/prospects" className="text-xs text-blue-600 hover:underline">
        ← Prospects
      </Link>
      <h1 className="text-3xl font-bold mt-2 mb-1">{prospect.firmName}</h1>
      <p className="text-slate-500 text-sm mb-6">
        {prospect.city} · {prospect.region} · {prospect.specialism ?? 'No specialism noted'}
      </p>

      <div className="grid grid-cols-3 gap-6">
        {/* PROFILE + STATUS */}
        <div className="col-span-1">
          <form action={updateStatus} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <input type="hidden" name="id" value={prospect.id} />
            <h2 className="font-semibold">Status &amp; notes</h2>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Pipeline status
              </label>
              <select
                name="status"
                defaultValue={prospect.status}
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
              >
                {['cold', 'contacted', 'replied', 'demo_scheduled', 'converted', 'declined', 'bounced'].map(
                  (s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  )
                )}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Notes
              </label>
              <textarea
                name="notes"
                defaultValue={prospect.notes ?? ''}
                rows={4}
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                placeholder="What happened on the last call? Who's the decision maker?"
              />
            </div>
            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-2 rounded">
              Save
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-lg p-5 mt-4 space-y-2 text-sm">
            <h2 className="font-semibold mb-2">Contact</h2>
            <Field label="Email" value={prospect.email} mono />
            <Field label="Phone" value={prospect.phone} mono />
            <Field label="Website" value={prospect.website} link />
            <Field label="Address" value={prospect.address} />
            <Field label="ICP score" value={`${prospect.icpScore}/100`} />
            <Field
              label="Source"
              value={prospect.source ?? '—'}
            />
          </div>
        </div>

        {/* COMPOSER + ACTIVITY */}
        <div className="col-span-2 space-y-4">
          {/* Quick send */}
          {prospect.email ? (
            <form
              action={sendOneOffEmail}
              className="bg-white border border-slate-200 rounded-lg p-5 space-y-3"
            >
              <input type="hidden" name="prospectId" value={prospect.id} />
              <h2 className="font-semibold">Send a one-off email</h2>
              {templates.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No templates yet.{' '}
                  <Link href="/admin/marketing/templates" className="text-blue-600 underline">
                    Create one
                  </Link>{' '}
                  to send outreach.
                </p>
              ) : (
                <>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      Template
                    </label>
                    <select
                      name="templateId"
                      className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                      defaultValue={templates[0].id}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} — {t.subject.slice(0, 50)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-2 rounded">
                    Send to {prospect.email}
                  </button>
                </>
              )}
            </form>
          ) : (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-4 text-sm">
              No email address recorded for this firm. Add one before sending outreach.
            </div>
          )}

          {/* Sequence enrol */}
          {sequences.length > 0 && prospect.email ? (
            <form
              action={enrollInSequence}
              className="bg-white border border-slate-200 rounded-lg p-5 space-y-3"
            >
              <input type="hidden" name="prospectId" value={prospect.id} />
              <h2 className="font-semibold">Enrol in follow-up sequence</h2>
              <div>
                <select
                  name="sequenceId"
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                >
                  {sequences.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <button className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-3 py-2 rounded">
                Enrol &amp; send step 1
              </button>
              {prospect.sequenceState.length > 0 ? (
                <p className="text-xs text-slate-500">
                  Currently enrolled in:{' '}
                  {prospect.sequenceState.map((s) => s.sequence.name).join(', ')}
                </p>
              ) : null}
            </form>
          ) : null}

          {/* Email history */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="font-semibold mb-3">Email history ({prospect.sends.length})</h2>
            {prospect.sends.length === 0 ? (
              <p className="text-sm text-slate-500">No emails sent yet.</p>
            ) : (
              <ul className="text-sm divide-y divide-slate-100">
                {prospect.sends.map((s) => (
                  <li key={s.id} className="py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{s.subject}</span>
                      <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {s.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {s.template?.name ?? 'No template'} ·{' '}
                      {s.sentAt
                        ? new Date(s.sentAt).toLocaleString('en-GB')
                        : 'Not sent yet'}
                    </div>
                    {s.errorMessage ? (
                      <div className="text-xs text-red-600 mt-1">Error: {s.errorMessage}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  link,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  link?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={`text-sm ${mono ? 'font-mono text-xs' : ''}`}
        style={{ wordBreak: 'break-word' }}
      >
        {value ? (
          link ? (
            <a href={value} target="_blank" rel="noreferrer" className="text-blue-600 underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          '—'
        )}
      </div>
    </div>
  );
}

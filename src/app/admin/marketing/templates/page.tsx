import { prisma } from '@/lib/db/prisma';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import TemplateEditorClient from '@/components/admin/TemplateEditorClient';

export const dynamic = 'force-dynamic';

async function saveTemplate(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '') || null;
  const name = String(formData.get('name') ?? '').trim();
  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '');
  const preheader = String(formData.get('preheader') ?? '') || null;
  const tier = String(formData.get('tier') ?? '') || null;
  if (!name || !subject || !body) return;

  if (id) {
    await prisma.emailTemplate.update({
      where: { id },
      data: { name, subject, body, preheader, tier },
    });
  } else {
    await prisma.emailTemplate.create({
      data: { name, subject, body, preheader, tier },
    });
  }
  revalidatePath('/admin/marketing/templates');
}

async function deleteTemplate(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await prisma.emailTemplate.delete({ where: { id } }).catch(() => null);
  revalidatePath('/admin/marketing/templates');
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const sp = await searchParams;
  const editId = sp.edit;
  const [templates, editing] = await Promise.all([
    prisma.emailTemplate.findMany({ orderBy: { name: 'asc' } }),
    editId
      ? prisma.emailTemplate.findUnique({ where: { id: editId } })
      : Promise.resolve(null),
  ]);

  if (editId && !editing) notFound();

  const senderName = process.env.OUTREACH_SENDER_NAME ?? 'Asghar';

  return (
    <div className="p-8 max-w-7xl">
      <div className="text-[11px] uppercase tracking-widest text-blue-600 font-semibold mb-2">
        Marketing · Templates
      </div>
      <h1 className="text-3xl font-bold mb-6">Email templates</h1>

      <div className="grid grid-cols-12 gap-6 mb-4">
        {/* LIST */}
        <div className="col-span-3 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <a
              href="/admin/marketing/templates"
              className="text-sm text-blue-600 hover:underline"
            >
              + New template
            </a>
          </div>
          <ul className="divide-y divide-slate-100">
            {templates.length === 0 ? (
              <li className="p-4 text-sm text-slate-500">
                No templates yet. Create your first one →
              </li>
            ) : (
              templates.map((t) => (
                <li
                  key={t.id}
                  className={`p-4 hover:bg-slate-50 ${
                    editing?.id === t.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <a href={`/admin/marketing/templates?edit=${t.id}`} className="block">
                    <div className="font-medium text-sm">{t.name}</div>
                    <div className="text-xs text-slate-500 truncate">{t.subject}</div>
                    {t.tier ? (
                      <span className="text-[10px] uppercase font-semibold text-blue-600">
                        {t.tier}
                      </span>
                    ) : null}
                  </a>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* EDITOR with live spam score */}
        <div className="col-span-9">
          <TemplateEditorClient
            key={editing?.id ?? 'new'}
            initial={{
              id: editing?.id,
              name: editing?.name ?? '',
              subject: editing?.subject ?? '',
              body: editing?.body ?? DEFAULT_BODY,
              preheader: editing?.preheader ?? '',
              tier: editing?.tier ?? '',
            }}
            saveAction={saveTemplate}
            deleteAction={deleteTemplate}
            senderName={senderName}
          />
        </div>
      </div>
    </div>
  );
}

const DEFAULT_BODY = `Hi {{first_name}},

I'm {{sender_name}} — I've been building **MedChron AI**, a tool that turns a 5,000-page medical bundle into a barrister-ready chronology in minutes, with every entry source-anchored and reviewable by a fee earner.

I'm reaching out because {{firm_name}} is one of the leading {{specialism}} firms in {{city}}, and I think there's a real fit. Two of your team could verify three chronologies in the time it currently takes a paralegal to draft one.

Worth a 15-minute call this or next week? I can show you a real case file and you can decide on the spot whether it's useful.

[See a quick preview]({{pitch_url}})

Either way — thank you for the work you do.

{{sender_name}}
{{sender_title}}`;

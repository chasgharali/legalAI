import { prisma } from '@/lib/db/prisma';
import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';

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

  return (
    <div className="p-8 max-w-6xl">
      <div className="text-[11px] uppercase tracking-widest text-blue-600 font-semibold mb-2">
        Marketing · Templates
      </div>
      <h1 className="text-3xl font-bold mb-6">Email templates</h1>

      <div className="grid grid-cols-12 gap-6">
        {/* LIST */}
        <div className="col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <a href="/admin/marketing/templates" className="text-sm text-blue-600 hover:underline">
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

        {/* EDITOR */}
        <div className="col-span-8">
          <form action={saveTemplate} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Name (internal)
              </label>
              <input
                name="name"
                required
                defaultValue={editing?.name ?? ''}
                placeholder="e.g. avma-cold-1-intro"
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Subject (uses {`{{firm_name}}`} etc.)
              </label>
              <input
                name="subject"
                required
                defaultValue={editing?.subject ?? ''}
                placeholder="Quick question about {{firm_name}}'s chronology workflow"
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Body
              </label>
              <textarea
                name="body"
                required
                defaultValue={editing?.body ?? DEFAULT_BODY}
                rows={18}
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm font-mono"
              />
              <p className="text-xs text-slate-500 mt-1">
                Tokens: <code>{`{{firm_name}}`}</code>, <code>{`{{city}}`}</code>,{' '}
                <code>{`{{specialism}}`}</code>, <code>{`{{first_name}}`}</code>,{' '}
                <code>{`{{sender_name}}`}</code>, <code>{`{{calendar_link}}`}</code>,{' '}
                <code>{`{{pitch_url}}`}</code>. Markdown supported: <code>**bold**</code>,{' '}
                <code>[label](url)</code>.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  Preheader (inbox preview)
                </label>
                <input
                  name="preheader"
                  defaultValue={editing?.preheader ?? ''}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  Tier
                </label>
                <select
                  name="tier"
                  defaultValue={editing?.tier ?? ''}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                >
                  <option value="">— Any —</option>
                  <option value="avma">AvMA panel</option>
                  <option value="chambers_band_1">Chambers Band 1</option>
                  <option value="regional">Regional</option>
                  <option value="general">General</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded">
                {editing ? 'Save changes' : 'Create template'}
              </button>
              {editing ? (
                <button
                  formAction={deleteTemplate}
                  className="text-sm text-red-600 hover:underline"
                >
                  Delete template
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_BODY = `Hi {{first_name}},

I'm {{sender_name}} — I've been building MedChron AI, a tool that turns a 5,000-page medical bundle into a barrister-ready chronology in minutes, with every entry source-anchored and reviewable by a fee earner.

I'm reaching out because {{firm_name}} is one of the leading {{specialism}} firms in {{city}}, and I think there's a real fit. Two of your team could verify three chronologies in the time it currently takes a paralegal to draft one.

Worth a 15-minute call this or next week? I can show you a real case file and you can decide on the spot whether it's useful.

[See a quick preview]({{pitch_url}})

Either way — thank you for the work you do.

{{sender_name}}
{{sender_title}}`;

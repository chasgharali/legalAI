import { prisma } from '@/lib/db/prisma';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

interface SequenceStep {
  stepIndex: number;
  templateId: string;
  delayDays: number; // days after the previous step (0 = send immediately on enroll)
}

async function toggleActive(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  const isActive = formData.get('isActive') === 'true';
  if (!id) return;
  await prisma.emailSequence.update({ where: { id }, data: { isActive } });
  revalidatePath('/admin/marketing/sequences');
}

async function createSequence(formData: FormData) {
  'use server';
  const name = String(formData.get('name') ?? '').trim();
  const stepsJson = String(formData.get('steps') ?? '[]');
  let steps: SequenceStep[] = [];
  try {
    steps = JSON.parse(stepsJson);
  } catch {
    return;
  }
  if (!name) return;
  await prisma.emailSequence.create({
    data: { name, steps, isActive: true },
  });
  revalidatePath('/admin/marketing/sequences');
}

export default async function SequencesPage() {
  const [sequences, templates] = await Promise.all([
    prisma.emailSequence.findMany({
      include: { _count: { select: { prospectStates: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.emailTemplate.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const templateMap = Object.fromEntries(templates.map((t) => [t.id, t]));

  return (
    <div className="p-8 max-w-5xl">
      <div className="text-[11px] uppercase tracking-widest text-blue-600 font-semibold mb-2">
        Marketing · Sequences
      </div>
      <h1 className="text-3xl font-bold mb-6">Follow-up sequences</h1>

      <div className="space-y-4 mb-8">
        {sequences.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
            No sequences yet. Run the seed script (creates a default cold-outreach sequence) or
            build one below using template IDs.
          </div>
        ) : (
          sequences.map((s) => {
            const steps = (s.steps as unknown as SequenceStep[]) ?? [];
            return (
              <div
                key={s.id}
                className="bg-white border border-slate-200 rounded-lg p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-semibold">{s.name}</h2>
                    <div className="text-xs text-slate-500">
                      {steps.length} steps · {s._count.prospectStates} prospects enrolled
                    </div>
                  </div>
                  <form action={toggleActive}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="isActive" value={(!s.isActive).toString()} />
                    <button
                      className={`text-xs font-semibold px-3 py-1.5 rounded ${
                        s.isActive
                          ? 'bg-green-100 text-green-800 hover:bg-green-200'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {s.isActive ? 'Active' : 'Paused'} — click to toggle
                    </button>
                  </form>
                </div>
                <ol className="space-y-2">
                  {steps.map((step, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 text-sm border border-slate-100 rounded px-3 py-2"
                    >
                      <span className="text-xs font-mono text-slate-400 w-6">{i + 1}</span>
                      <span className="font-medium">
                        {templateMap[step.templateId]?.name ?? '(template missing)'}
                      </span>
                      <span className="text-xs text-slate-500 ml-auto">
                        {step.delayDays === 0
                          ? 'Send on enrol'
                          : `${step.delayDays} day${step.delayDays === 1 ? '' : 's'} after previous`}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })
        )}
      </div>

      {/* CREATE */}
      <form action={createSequence} className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
        <h2 className="font-semibold">Create new sequence</h2>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Name
          </label>
          <input
            name="name"
            required
            placeholder="AvMA cold outreach — 4 touch"
            className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Steps (JSON)
          </label>
          <textarea
            name="steps"
            rows={8}
            defaultValue={JSON.stringify(
              [
                {
                  stepIndex: 0,
                  templateId: templates[0]?.id ?? 'TEMPLATE_ID_1',
                  delayDays: 0,
                },
                {
                  stepIndex: 1,
                  templateId: templates[1]?.id ?? 'TEMPLATE_ID_2',
                  delayDays: 3,
                },
                {
                  stepIndex: 2,
                  templateId: templates[2]?.id ?? 'TEMPLATE_ID_3',
                  delayDays: 7,
                },
                {
                  stepIndex: 3,
                  templateId: templates[3]?.id ?? 'TEMPLATE_ID_4',
                  delayDays: 11,
                },
              ],
              null,
              2
            )}
            className="w-full border border-slate-200 rounded px-3 py-2 text-xs font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            <code>delayDays</code> is measured from the previous step. Step 0 fires immediately on
            enrol.
          </p>
        </div>
        <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded">
          Create sequence
        </button>
      </form>

      <h2 className="font-semibold mt-8 mb-2">Available templates</h2>
      <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs font-mono space-y-1">
        {templates.map((t) => (
          <div key={t.id} className="flex justify-between">
            <span className="text-slate-500">{t.id}</span>
            <span>{t.name}</span>
          </div>
        ))}
        {templates.length === 0 ? (
          <div className="text-slate-500">No templates yet.</div>
        ) : null}
      </div>
    </div>
  );
}

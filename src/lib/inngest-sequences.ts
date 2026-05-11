import { inngest } from './inngest';
import { prisma } from './db/prisma';
import { defaultPersonalizationContext, personalize, sendEmail } from './email';

interface SequenceStep {
  stepIndex: number;
  templateId: string;
  delayDays: number;
}

// ---------------------------------------------------------------------------
// Cron: every 15 minutes, dispatch any due sequence steps.
// ---------------------------------------------------------------------------

export const dispatchSequenceSteps = inngest.createFunction(
  {
    id: 'dispatch-sequence-steps',
    name: 'Dispatch due email sequence steps',
    concurrency: { limit: 1 }, // Serialise so we never double-send a step.
  },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const now = new Date();

    const dueStates = await step.run('find-due', async () =>
      prisma.prospectSequenceState.findMany({
        where: {
          status: 'active',
          nextSendAt: { lte: now },
        },
        include: {
          prospect: true,
          sequence: true,
        },
        take: 100,
      })
    );

    if (dueStates.length === 0) {
      return { processed: 0 };
    }

    let processed = 0;
    for (const state of dueStates) {
      const steps = (state.sequence.steps as unknown as SequenceStep[]) ?? [];
      const stepDef = steps[state.currentStepIndex];

      if (!stepDef) {
        // No more steps — mark complete.
        await step.run(`complete-${state.id}`, () =>
          prisma.prospectSequenceState.update({
            where: { id: state.id },
            data: { status: 'completed', completedAt: new Date(), nextSendAt: null },
          })
        );
        continue;
      }

      if (!state.prospect.email) {
        await step.run(`skip-${state.id}`, () =>
          prisma.prospectSequenceState.update({
            where: { id: state.id },
            data: { status: 'stopped' },
          })
        );
        continue;
      }

      // Stop sequence if prospect has already replied or converted.
      if (
        state.prospect.status === 'replied' ||
        state.prospect.status === 'demo_scheduled' ||
        state.prospect.status === 'converted' ||
        state.prospect.status === 'declined'
      ) {
        await step.run(`stop-${state.id}`, () =>
          prisma.prospectSequenceState.update({
            where: { id: state.id },
            data: { status: 'stopped' },
          })
        );
        continue;
      }

      const template = await step.run(`load-template-${state.id}`, () =>
        prisma.emailTemplate.findUnique({ where: { id: stepDef.templateId } })
      );
      if (!template) {
        await step.run(`fail-${state.id}`, () =>
          prisma.prospectSequenceState.update({
            where: { id: state.id },
            data: { status: 'stopped' },
          })
        );
        continue;
      }

      const ctx = {
        ...defaultPersonalizationContext(),
        firm_name: state.prospect.firmName,
        city: state.prospect.city,
        specialism: state.prospect.specialism,
        side: state.prospect.side,
        first_name: null,
      };
      const subject = personalize(template.subject, ctx);
      const body = personalize(template.body, ctx);

      const result = await step.run(`send-${state.id}`, async () =>
        sendEmail({
          to: state.prospect.email!,
          subject,
          bodyText: body,
          tags: {
            prospectId: state.prospect.id,
            sequenceId: state.sequence.id,
            stepIndex: String(stepDef.stepIndex),
            templateId: template.id,
          },
        })
      );

      await step.run(`record-${state.id}`, async () => {
        await prisma.emailSend.create({
          data: {
            prospectId: state.prospect.id,
            templateId: template.id,
            fromEmail: ctx.sender_email,
            toEmail: state.prospect.email!,
            subject,
            bodyHtml: body,
            status: result.status,
            providerMsgId: result.providerMsgId ?? undefined,
            errorMessage: result.error,
            sentAt: result.status === 'sent' ? new Date() : null,
          },
        });
        await prisma.marketingProspect.update({
          where: { id: state.prospect.id },
          data: {
            lastContactedAt: new Date(),
            firstContactedAt: state.prospect.firstContactedAt ?? new Date(),
            status: state.prospect.status === 'cold' ? 'contacted' : state.prospect.status,
          },
        });
      });

      // Advance to the next step or mark complete.
      const nextStepIndex = state.currentStepIndex + 1;
      const nextStep = steps[nextStepIndex];
      const nextSendAt = nextStep
        ? new Date(Date.now() + nextStep.delayDays * 24 * 60 * 60 * 1000)
        : null;
      await step.run(`advance-${state.id}`, () =>
        prisma.prospectSequenceState.update({
          where: { id: state.id },
          data: {
            currentStepIndex: nextStepIndex,
            nextSendAt,
            status: nextStep ? 'active' : 'completed',
            completedAt: nextStep ? null : new Date(),
          },
        })
      );

      processed++;
    }

    return { processed };
  }
);

// ---------------------------------------------------------------------------
// Cron: first of each month, reset every firm's monthly matter usage counter.
// ---------------------------------------------------------------------------

export const resetMonthlyMatterUsage = inngest.createFunction(
  {
    id: 'reset-monthly-matter-usage',
    name: 'Reset monthly matter usage counters',
  },
  { cron: '0 0 1 * *' }, // 00:00 on the 1st of each month, UTC
  async ({ step }) => {
    const updated = await step.run('reset-all', async () => {
      const res = await prisma.firm.updateMany({
        data: { mattersUsedThisMonth: 0, monthlyResetAt: new Date() },
      });
      return res.count;
    });
    return { firmsReset: updated };
  }
);

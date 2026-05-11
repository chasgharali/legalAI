import { Inngest } from 'inngest';
import { prisma } from './db/prisma';
import { openai } from './openai';
import { CHRONOLOGY_SYSTEM_PROMPT, buildChronologyUserPrompt } from './prompts/chronology';
import { chunkPages, type PagedChunk } from './chunker';
import { embedMany, embeddingTextFor } from './embeddings';
import type { PageText } from './pdf-extract';

export const inngest = new Inngest({
  id: 'medchron',
  // Inngest will read INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY automatically.
});

// ---------------------------------------------------------------------------
// Event names
// ---------------------------------------------------------------------------

export const EV_CHRONOLOGY_GENERATE = 'chronology/generate.requested';

export interface ChronologyGenerateEvent {
  name: typeof EV_CHRONOLOGY_GENERATE;
  data: {
    matterId: string;
    documentId: string;
    jobId: string;
    userId: string;
  };
}

// ---------------------------------------------------------------------------
// Chronology generation worker
// ---------------------------------------------------------------------------

const ALLOWED_EVENT_TYPES = new Set([
  'gp_visit',
  'hospital_inpatient',
  'hospital_outpatient',
  'ae_attendance',
  'investigation',
  'procedure',
  'operation',
  'prescription',
  'referral',
  'correspondence',
  'sick_note',
  'treatment_gap',
  'inconsistency',
  'other',
]);

const ALLOWED_RELEVANCE_FLAGS = new Set([
  'pre_existing',
  'incident_related',
  'causation_critical',
  'unrelated',
]);

function parseModelEntries(raw: string): Record<string, unknown>[] {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    const direct = JSON.parse(cleaned) as unknown;
    if (Array.isArray(direct)) return direct as Record<string, unknown>[];
    if (
      direct &&
      typeof direct === 'object' &&
      Array.isArray((direct as { entries?: unknown }).entries)
    ) {
      return (direct as { entries: Record<string, unknown>[] }).entries;
    }
  } catch {
    return [];
  }
  return [];
}

interface NormalizedEntry {
  date: string;
  dateApproximate: boolean;
  eventType: string;
  providerName: string;
  providerRole: string;
  specialty: string;
  presentingComplaint: string;
  diagnosis: string;
  treatmentGiven: string;
  followUpPlan: string;
  relevanceFlag: string;
  sourceDocumentTag: string;
  sourcePageNumber: number | null;
  sourcePageStart: number;
  sourcePageEnd: number;
  verbatimExtract: string;
  notes: string;
  verified: boolean;
  editedByUser: boolean;
}

function normalizeEntry(
  entry: Record<string, unknown>,
  documentTag: string,
  chunk: PagedChunk
): NormalizedEntry | null {
  const eventTypeRaw = String(entry.event_type ?? 'other').trim().toLowerCase();
  const relevanceRaw = String(entry.relevance_flag ?? 'unrelated').trim().toLowerCase();

  const eventType = ALLOWED_EVENT_TYPES.has(eventTypeRaw) ? eventTypeRaw : 'other';
  const relevanceFlag = ALLOWED_RELEVANCE_FLAGS.has(relevanceRaw)
    ? relevanceRaw
    : 'unrelated';
  const verbatimExtract = String(entry.verbatim_extract ?? '').trim();
  const presentingComplaint = String(entry.presenting_complaint ?? '').trim();
  const providerName = String(entry.provider_name ?? '').trim();
  const diagnosis = String(entry.diagnosis ?? '').trim();
  const date = String(entry.date ?? 'unknown').trim() || 'unknown';

  // Drop completely empty rows.
  if (!verbatimExtract && !presentingComplaint && !diagnosis && !providerName) {
    return null;
  }

  // Trust the model's page if it sits inside the chunk's real range,
  // otherwise fall back to the chunk's start page.
  const modelPage =
    typeof entry.source_page_number === 'number' ? entry.source_page_number : null;
  const sourcePageNumber =
    modelPage !== null &&
    modelPage >= chunk.startPage &&
    modelPage <= chunk.endPage
      ? modelPage
      : chunk.startPage;

  return {
    date,
    dateApproximate: date.startsWith('circa'),
    eventType,
    providerName,
    providerRole: String(entry.provider_role ?? '').trim(),
    specialty: String(entry.specialty ?? '').trim(),
    presentingComplaint,
    diagnosis,
    treatmentGiven: String(entry.treatment_given ?? '').trim(),
    followUpPlan: String(entry.follow_up_plan ?? '').trim(),
    relevanceFlag,
    sourceDocumentTag: String(entry.source_document_tag ?? documentTag).trim() || documentTag,
    sourcePageNumber,
    sourcePageStart: chunk.startPage,
    sourcePageEnd: chunk.endPage,
    verbatimExtract,
    notes: String(entry.notes ?? '').trim(),
    verified: false,
    editedByUser: false,
  };
}

async function extractChunkEntries(
  chunk: PagedChunk,
  documentTag: string,
  context: { claimType?: string; incidentDate?: string; clientDob?: string }
): Promise<NormalizedEntry[]> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.1,
    max_tokens: 4096,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'chronology_entries',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entries: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  date: { type: 'string' },
                  event_type: { type: 'string' },
                  provider_name: { type: 'string' },
                  provider_role: { type: 'string' },
                  specialty: { type: 'string' },
                  presenting_complaint: { type: 'string' },
                  diagnosis: { type: 'string' },
                  treatment_given: { type: 'string' },
                  follow_up_plan: { type: 'string' },
                  relevance_flag: { type: 'string' },
                  source_document_tag: { type: 'string' },
                  source_page_number: { type: ['number', 'null'] },
                  verbatim_extract: { type: 'string' },
                  notes: { type: 'string' },
                },
                required: [
                  'date',
                  'event_type',
                  'provider_name',
                  'provider_role',
                  'specialty',
                  'presenting_complaint',
                  'diagnosis',
                  'treatment_given',
                  'follow_up_plan',
                  'relevance_flag',
                  'source_document_tag',
                  'source_page_number',
                  'verbatim_extract',
                  'notes',
                ],
              },
            },
          },
          required: ['entries'],
        },
        strict: true,
      },
    },
    messages: [
      { role: 'system', content: CHRONOLOGY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildChronologyUserPrompt(
          documentTag,
          `Pages ${chunk.startPage}–${chunk.endPage}`,
          chunk.text,
          context
        ),
      },
    ],
  });

  const rawJson = completion.choices[0].message.content ?? '{"entries": []}';
  const parsed = parseModelEntries(rawJson);
  return parsed
    .map((entry) => normalizeEntry(entry, documentTag, chunk))
    .filter((entry): entry is NormalizedEntry => entry !== null);
}

export const generateChronology = inngest.createFunction(
  {
    id: 'generate-chronology',
    name: 'Generate medical chronology',
    // Concurrency cap so a single firm can't drain GPT-4o quota.
    concurrency: { limit: 4, key: 'event.data.matterId' },
    retries: 2,
  },
  { event: EV_CHRONOLOGY_GENERATE },
  async ({ event, step }) => {
    const { matterId, documentId, jobId } = event.data as ChronologyGenerateEvent['data'];

    const setup = await step.run('load-and-mark-running', async () => {
      const [document, matter] = await Promise.all([
        prisma.medicalDocument.findUnique({ where: { id: documentId } }),
        prisma.matter.findUnique({ where: { id: matterId } }),
      ]);
      if (!document || !matter) {
        throw new Error('Document or matter not found');
      }
      const pages = (document.pageTexts as PageText[] | null) ?? [];
      const chunks = chunkPages(pages, 12000, 500);

      await prisma.chronologyJob.update({
        where: { id: jobId },
        data: {
          status: 'running',
          startedAt: new Date(),
          totalChunks: chunks.length,
          completedChunks: 0,
        },
      });
      await prisma.medicalDocument.update({
        where: { id: documentId },
        data: { processingStatus: 'pending' },
      });

      return {
        chunks,
        documentTag: document.tag,
        context: {
          claimType: matter.claimType,
          incidentDate: matter.incidentDate?.toISOString().slice(0, 10),
          clientDob: matter.clientDob?.toISOString().slice(0, 10),
        },
      };
    });

    if (setup.chunks.length === 0) {
      await step.run('mark-failed-no-text', async () => {
        await prisma.chronologyJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: 'No extractable text in document',
          },
        });
        await prisma.medicalDocument.update({
          where: { id: documentId },
          data: { processingStatus: 'error' },
        });
      });
      return { entriesCreated: 0 };
    }

    // Process chunks in parallel batches with cap. Each chunk is its own
    // Inngest step so a partial failure doesn't lose completed work.
    const BATCH = 3;
    const allEntries: NormalizedEntry[] = [];

    for (let i = 0; i < setup.chunks.length; i += BATCH) {
      const slice = setup.chunks.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map((chunk, j) =>
          step.run(`chunk-${i + j}`, () =>
            extractChunkEntries(chunk, setup.documentTag, setup.context)
          )
        )
      );
      for (const r of results) allEntries.push(...r);

      await step.run(`update-progress-${i}`, async () => {
        await prisma.chronologyJob.update({
          where: { id: jobId },
          data: { completedChunks: Math.min(i + BATCH, setup.chunks.length) },
        });
      });
    }

    await step.run('persist-entries', async () => {
      // Dedupe within a single run.
      const deduped = Array.from(
        new Map(
          allEntries.map((e) => [
            `${e.date}|${e.eventType}|${e.providerName}|${e.presentingComplaint}|${e.verbatimExtract}`,
            e,
          ])
        ).values()
      );
      deduped.sort((a, b) => a.date.localeCompare(b.date));

      // Replace prior entries from this document. (TODO: switch to a
      // supersededAt pattern so manual verifications survive regen.)
      await prisma.chronologyEntry.deleteMany({ where: { documentId } });

      if (deduped.length === 0) {
        await prisma.chronologyJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: 'Model returned no entries',
            entriesCreated: 0,
          },
        });
        await prisma.medicalDocument.update({
          where: { id: documentId },
          data: { processingStatus: 'error' },
        });
        return;
      }

      // Embed all entries in one batch and write rows with embeddings.
      const embeddings = await embedMany(deduped.map((e) => embeddingTextFor(e)));
      const rows = deduped.map((entry, i) => ({
        matterId,
        documentId,
        ...entry,
        embedding: embeddings[i] ?? [],
      }));

      try {
        await prisma.chronologyEntry.createMany({ data: rows });
      } catch {
        // createMany failed (e.g. unsupported by Mongo connector for some
        // edge cases) — fall back to per-row inserts so partial progress is
        // preserved.
        for (const row of rows) {
          try {
            await prisma.chronologyEntry.create({ data: row });
          } catch (e) {
            console.error('[generate-chronology] single insert failed', e);
          }
        }
      }

      await prisma.chronologyJob.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          entriesCreated: rows.length,
        },
      });
      await prisma.medicalDocument.update({
        where: { id: documentId },
        data: { processingStatus: 'chronologised' },
      });
      await prisma.matter.update({
        where: { id: matterId },
        data: { status: 'ready', updatedAt: new Date() },
      });
    });

    return { entriesCreated: allEntries.length };
  }
);

/**
 * Registered Inngest functions, exposed at /api/inngest by the route handler.
 * Sequence + monthly-reset functions live in inngest-sequences.ts to keep
 * the file size manageable; we re-export them here so the route handler
 * has a single import.
 */
import { dispatchSequenceSteps, resetMonthlyMatterUsage } from './inngest-sequences';
export const inngestFunctions = [
  generateChronology,
  dispatchSequenceSteps,
  resetMonthlyMatterUsage,
];

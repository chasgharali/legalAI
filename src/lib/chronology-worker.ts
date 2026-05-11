import { prisma } from './db/prisma';
import { openai } from './openai';
import { CHRONOLOGY_SYSTEM_PROMPT, buildChronologyUserPrompt } from './prompts/chronology';
import { chunkPages, type PagedChunk } from './chunker';
import { embedMany, embeddingTextFor } from './embeddings';
import type { PageText } from './pdf-extract';

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

const WORKER_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.CHRONOLOGY_WORKER_CONCURRENCY ?? '2', 10) || 2
);
const SWEEP_INTERVAL_MS = 5000;

interface WorkerState {
  booted: boolean;
  draining: boolean;
  runningJobs: Set<string>;
  timer?: NodeJS.Timeout;
}

declare global {
  // eslint-disable-next-line no-var
  var __chronologyWorkerState: WorkerState | undefined;
}

function getWorkerState(): WorkerState {
  if (!globalThis.__chronologyWorkerState) {
    globalThis.__chronologyWorkerState = {
      booted: false,
      draining: false,
      runningJobs: new Set<string>(),
    };
  }
  return globalThis.__chronologyWorkerState;
}

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
  const relevanceFlag = ALLOWED_RELEVANCE_FLAGS.has(relevanceRaw) ? relevanceRaw : 'unrelated';
  const verbatimExtract = String(entry.verbatim_extract ?? '').trim();
  const presentingComplaint = String(entry.presenting_complaint ?? '').trim();
  const providerName = String(entry.provider_name ?? '').trim();
  const diagnosis = String(entry.diagnosis ?? '').trim();
  const date = String(entry.date ?? 'unknown').trim() || 'unknown';

  if (!verbatimExtract && !presentingComplaint && !diagnosis && !providerName) {
    return null;
  }

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

async function markJobFailed(
  jobId: string,
  documentId: string,
  errorMessage: string
): Promise<void> {
  await Promise.all([
    prisma.chronologyJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage,
      },
    }),
    prisma.medicalDocument.update({
      where: { id: documentId },
      data: { processingStatus: 'error' },
    }),
  ]);
}

async function processChronologyJob(jobId: string): Promise<void> {
  const job = await prisma.chronologyJob.findUnique({
    where: { id: jobId },
    select: { id: true, matterId: true, documentId: true, status: true },
  });
  if (!job || job.status !== 'queued') return;

  const claim = await prisma.chronologyJob.updateMany({
    where: { id: jobId, status: 'queued' },
    data: {
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
      completedChunks: 0,
      entriesCreated: 0,
    },
  });
  if (claim.count === 0) return;

  try {
    const [document, matter] = await Promise.all([
      prisma.medicalDocument.findUnique({ where: { id: job.documentId } }),
      prisma.matter.findUnique({ where: { id: job.matterId } }),
    ]);

    if (!document || !matter) {
      await markJobFailed(job.id, job.documentId, 'Document or matter not found');
      return;
    }

    const pages = (document.pageTexts as PageText[] | null) ?? [];
    const chunks = chunkPages(pages, 12000, 500);

    await Promise.all([
      prisma.chronologyJob.update({
        where: { id: job.id },
        data: {
          totalChunks: chunks.length,
          completedChunks: 0,
        },
      }),
      prisma.medicalDocument.update({
        where: { id: job.documentId },
        data: { processingStatus: 'pending' },
      }),
    ]);

    if (chunks.length === 0) {
      await markJobFailed(job.id, job.documentId, 'No extractable text in document');
      return;
    }

    const context = {
      claimType: matter.claimType,
      incidentDate: matter.incidentDate?.toISOString().slice(0, 10),
      clientDob: matter.clientDob?.toISOString().slice(0, 10),
    };
    const BATCH = 3;
    const allEntries: NormalizedEntry[] = [];

    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map((chunk) => extractChunkEntries(chunk, document.tag, context))
      );
      for (const r of results) allEntries.push(...r);

      await prisma.chronologyJob.update({
        where: { id: job.id },
        data: { completedChunks: Math.min(i + BATCH, chunks.length) },
      });
    }

    const deduped = Array.from(
      new Map(
        allEntries.map((entry) => [
          `${entry.date}|${entry.eventType}|${entry.providerName}|${entry.presentingComplaint}|${entry.verbatimExtract}`,
          entry,
        ])
      ).values()
    );
    deduped.sort((a, b) => a.date.localeCompare(b.date));

    await prisma.chronologyEntry.deleteMany({ where: { documentId: job.documentId } });

    if (deduped.length === 0) {
      await markJobFailed(job.id, job.documentId, 'Model returned no entries');
      return;
    }

    const embeddings = await embedMany(deduped.map((entry) => embeddingTextFor(entry)));
    const rows = deduped.map((entry, i) => ({
      matterId: job.matterId,
      documentId: job.documentId,
      ...entry,
      embedding: embeddings[i] ?? [],
    }));

    try {
      await prisma.chronologyEntry.createMany({ data: rows });
    } catch {
      for (const row of rows) {
        try {
          await prisma.chronologyEntry.create({ data: row });
        } catch (error) {
          console.error('[chronology-worker] single insert failed', error);
        }
      }
    }

    await Promise.all([
      prisma.chronologyJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          entriesCreated: rows.length,
        },
      }),
      prisma.medicalDocument.update({
        where: { id: job.documentId },
        data: { processingStatus: 'chronologised' },
      }),
      prisma.matter.update({
        where: { id: job.matterId },
        data: { status: 'ready', updatedAt: new Date() },
      }),
    ]);
  } catch (error) {
    console.error('[chronology-worker] job failed', error);
    await markJobFailed(
      job.id,
      job.documentId,
      error instanceof Error ? error.message : 'Chronology generation failed'
    );
  }
}

async function drainChronologyQueue(): Promise<void> {
  const state = getWorkerState();
  if (state.draining) return;
  state.draining = true;

  try {
    while (state.runningJobs.size < WORKER_CONCURRENCY) {
      const queued = await prisma.chronologyJob.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      if (!queued) break;
      if (state.runningJobs.has(queued.id)) break;

      state.runningJobs.add(queued.id);
      void processChronologyJob(queued.id).finally(() => {
        state.runningJobs.delete(queued.id);
        void drainChronologyQueue();
      });
    }
  } finally {
    state.draining = false;
  }
}

export function bootChronologyWorker(): void {
  const state = getWorkerState();
  if (state.booted) return;
  state.booted = true;

  state.timer = setInterval(() => {
    void drainChronologyQueue();
  }, SWEEP_INTERVAL_MS);
  state.timer.unref?.();

  void drainChronologyQueue();
}

export function enqueueChronologyJob(): void {
  bootChronologyWorker();
  void drainChronologyQueue();
}

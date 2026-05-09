import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { CHRONOLOGY_SYSTEM_PROMPT, buildChronologyUserPrompt } from '@/lib/prompts/chronology';
import { prisma } from '@/lib/db/prisma';
import { chunkText } from '@/lib/chunker';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

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

  const direct = JSON.parse(cleaned) as unknown;
  if (Array.isArray(direct)) return direct as Record<string, unknown>[];
  if (direct && typeof direct === 'object' && Array.isArray((direct as { entries?: unknown }).entries)) {
    return (direct as { entries: Record<string, unknown>[] }).entries;
  }
  return [];
}

function normalizeEntry(entry: Record<string, unknown>, documentTag: string) {
  const eventTypeRaw = String(entry.event_type ?? 'other').trim().toLowerCase();
  const relevanceRaw = String(entry.relevance_flag ?? 'unrelated').trim().toLowerCase();

  const eventType = ALLOWED_EVENT_TYPES.has(eventTypeRaw) ? eventTypeRaw : 'other';
  const relevanceFlag = ALLOWED_RELEVANCE_FLAGS.has(relevanceRaw) ? relevanceRaw : 'unrelated';
  const verbatimExtract = String(entry.verbatim_extract ?? '').trim();
  const presentingComplaint = String(entry.presenting_complaint ?? '').trim();
  const providerName = String(entry.provider_name ?? '').trim();
  const diagnosis = String(entry.diagnosis ?? '').trim();
  const date = String(entry.date ?? 'unknown').trim() || 'unknown';

  // Skip low-signal rows that do not contain any meaningful medical event details.
  if (!verbatimExtract && !presentingComplaint && !diagnosis && !providerName) {
    return null;
  }

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
    sourcePageNumber:
      typeof entry.source_page_number === 'number' ? entry.source_page_number : null,
    verbatimExtract,
    notes: String(entry.notes ?? '').trim(),
    verified: false,
    editedByUser: false,
  };
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { matterId, documentId } = await req.json();

    const document = await prisma.medicalDocument.findUnique({ where: { id: documentId } });
    if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const matter = await prisma.matter.findUnique({ where: { id: matterId } });
    const user = session.user as { firmId: string };
    if (!matter || matter.firmId !== user.firmId || document.matterId !== matterId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!document.extractedText || document.extractedText.trim().length < 50) {
      return NextResponse.json(
        { error: 'Document has insufficient extracted text. Try re-uploading the PDF.' },
        { status: 400 }
      );
    }

    await prisma.medicalDocument.update({
      where: { id: documentId },
      data: { processingStatus: 'pending' },
    });

    const chunks = chunkText(document.extractedText, 12000);
    console.log(`[chronology] doc=${documentId} chunks=${chunks.length} textLen=${document.extractedText.length}`);

    const allEntries: ReturnType<typeof normalizeEntry>[] = [];
    const errors: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const pageRange = `Pages ${i * 15 + 1}–${(i + 1) * 15}`;
      try {
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
              content: buildChronologyUserPrompt(document.tag, pageRange, chunks[i], {
                claimType: matter.claimType,
                incidentDate: matter.incidentDate?.toISOString().slice(0, 10),
                clientDob: matter.clientDob?.toISOString().slice(0, 10),
              }),
            },
          ],
        });

        const rawJson = completion.choices[0].message.content ?? '{"entries": []}';
        console.log(`[chronology] chunk ${i} raw (first 200): ${rawJson.slice(0, 200)}`);
        const parsedEntries = parseModelEntries(rawJson);
        const normalized = parsedEntries
          .map((entry) => normalizeEntry(entry, document.tag))
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
        console.log(`[chronology] chunk ${i} parsed ${normalized.length} entries`);
        allEntries.push(...normalized);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Parse error';
        console.error(`[chronology] chunk ${i} error:`, msg);
        errors.push(`Chunk ${i}: ${msg}`);
      }
    }

    console.log(`[chronology] total entries before save: ${allEntries.length}`);
    const deduped = Array.from(
      new Map(
        allEntries.map((entry) => [
          `${entry?.date}|${entry?.eventType}|${entry?.providerName}|${entry?.presentingComplaint}|${entry?.verbatimExtract}`,
          entry,
        ])
      ).values()
    );
    console.log(`[chronology] deduped entries: ${deduped.length}`);
    deduped.sort((a, b) => String(a?.date ?? '').localeCompare(String(b?.date ?? '')));

    await prisma.chronologyEntry.deleteMany({ where: { documentId } });

    if (deduped.length > 0) {
      const rows = deduped.map((entry) => ({
        matterId,
        documentId,
        date: entry?.date ?? 'unknown',
        dateApproximate: entry?.dateApproximate ?? false,
        eventType: entry?.eventType ?? 'other',
        providerName: entry?.providerName ?? '',
        providerRole: entry?.providerRole ?? '',
        specialty: entry?.specialty ?? '',
        presentingComplaint: entry?.presentingComplaint ?? '',
        diagnosis: entry?.diagnosis ?? '',
        treatmentGiven: entry?.treatmentGiven ?? '',
        followUpPlan: entry?.followUpPlan ?? '',
        relevanceFlag: entry?.relevanceFlag ?? 'unrelated',
        sourceDocumentTag: entry?.sourceDocumentTag ?? document.tag,
        sourcePageNumber: entry?.sourcePageNumber ?? null,
        verbatimExtract: entry?.verbatimExtract ?? '',
        notes: entry?.notes ?? '',
        verified: entry?.verified ?? false,
        editedByUser: entry?.editedByUser ?? false,
      }));

      try {
        const result = await prisma.chronologyEntry.createMany({ data: rows });
        console.log(`[chronology] createMany count: ${result.count}`);
      } catch (dbErr) {
        console.error('[chronology] createMany failed:', dbErr);
        // fallback: create one by one
        let saved = 0;
        for (const row of rows) {
          try {
            await prisma.chronologyEntry.create({ data: row });
            saved++;
          } catch (e) {
            console.error('[chronology] single create failed:', e);
          }
        }
        console.log(`[chronology] fallback created ${saved}/${rows.length}`);
      }
    }

    if (deduped.length === 0) {
      await prisma.medicalDocument.update({
        where: { id: documentId },
        data: { processingStatus: 'error' },
      });
      return NextResponse.json(
        {
          error: 'No chronology entries could be extracted from this document.',
          entriesCreated: 0,
          errors,
        },
        { status: 422 }
      );
    }

    await prisma.medicalDocument.update({
      where: { id: documentId },
      data: { processingStatus: 'chronologised' },
    });

    await prisma.matter.update({
      where: { id: matterId },
      data: { status: 'ready', updatedAt: new Date() },
    });

    return NextResponse.json({ success: true, entriesCreated: deduped.length, errors });
  } catch (err) {
    console.error('[chronology] unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Chronology generation failed' },
      { status: 500 }
    );
  }
}

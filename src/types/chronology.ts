import type { DocumentTag } from './document';

export type EventType =
  | 'gp_visit'
  | 'hospital_inpatient'
  | 'hospital_outpatient'
  | 'ae_attendance'
  | 'investigation'
  | 'procedure'
  | 'operation'
  | 'prescription'
  | 'referral'
  | 'correspondence'
  | 'sick_note'
  | 'treatment_gap'
  | 'inconsistency'
  | 'other';

export type RelevanceFlag =
  | 'pre_existing'
  | 'incident_related'
  | 'causation_critical'
  | 'unrelated';

export interface ChronologyEntry {
  id: string;
  matterId: string;
  documentId: string;
  date: string;
  dateApproximate: boolean;
  eventType: EventType;
  providerName: string;
  providerRole: string;
  specialty: string;
  presentingComplaint: string;
  diagnosis: string;
  treatmentGiven: string;
  followUpPlan: string;
  relevanceFlag: RelevanceFlag;
  sourceDocumentTag: DocumentTag;
  sourcePageNumber: number | null;
  verbatimExtract: string;
  notes: string;
  verified: boolean;
  editedByUser: boolean;
  createdAt: string;
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  gp_visit: 'GP Visit',
  hospital_inpatient: 'Hospital Inpatient',
  hospital_outpatient: 'Hospital Outpatient',
  ae_attendance: 'A&E Attendance',
  investigation: 'Investigation',
  procedure: 'Procedure',
  operation: 'Operation',
  prescription: 'Prescription',
  referral: 'Referral',
  correspondence: 'Correspondence',
  sick_note: 'Fit Note',
  treatment_gap: 'Treatment Gap',
  inconsistency: 'Inconsistency',
  other: 'Other',
};

export const RELEVANCE_FLAG_LABELS: Record<RelevanceFlag, string> = {
  pre_existing: 'Pre-existing',
  incident_related: 'Incident Related',
  causation_critical: 'Causation Critical',
  unrelated: 'Unrelated',
};

export const EVENT_TYPE_COLOURS: Record<EventType, string> = {
  gp_visit: 'bg-blue-100 text-blue-800',
  hospital_inpatient: 'bg-purple-100 text-purple-800',
  hospital_outpatient: 'bg-indigo-100 text-indigo-800',
  ae_attendance: 'bg-red-100 text-red-800',
  investigation: 'bg-yellow-100 text-yellow-800',
  procedure: 'bg-orange-100 text-orange-800',
  operation: 'bg-red-200 text-red-900',
  prescription: 'bg-green-100 text-green-800',
  referral: 'bg-cyan-100 text-cyan-800',
  correspondence: 'bg-gray-100 text-gray-800',
  sick_note: 'bg-teal-100 text-teal-800',
  treatment_gap: 'bg-amber-100 text-amber-800',
  inconsistency: 'bg-rose-100 text-rose-800',
  other: 'bg-slate-100 text-slate-800',
};

export const RELEVANCE_COLOURS: Record<RelevanceFlag, string> = {
  pre_existing: 'bg-slate-100 text-slate-700 border-slate-200',
  incident_related: 'bg-blue-50 text-blue-700 border-blue-200',
  causation_critical: 'bg-red-50 text-red-700 border-red-300',
  unrelated: 'bg-gray-50 text-gray-600 border-gray-200',
};

export type DocumentTag =
  | 'gp_notes'
  | 'hospital_inpatient'
  | 'hospital_outpatient'
  | 'ae_records'
  | 'consultant_report'
  | 'radiology'
  | 'pharmacy'
  | 'correspondence'
  | 'expert_report'
  | 'other';

export type ProcessingStatus = 'pending' | 'extracted' | 'chronologised' | 'error';

export interface MedicalDocument {
  id: string;
  matterId: string;
  fileName: string;
  fileUrl: string;
  tag: DocumentTag;
  pageCount: number;
  extractedText: string;
  processingStatus: ProcessingStatus;
  uploadedAt: string;
}

export const DOCUMENT_TAG_LABELS: Record<DocumentTag, string> = {
  gp_notes: 'GP Notes',
  hospital_inpatient: 'Hospital Inpatient',
  hospital_outpatient: 'Hospital Outpatient',
  ae_records: 'A&E Records',
  consultant_report: 'Consultant Report',
  radiology: 'Radiology',
  pharmacy: 'Pharmacy',
  correspondence: 'Correspondence',
  expert_report: 'Expert Report',
  other: 'Other',
};

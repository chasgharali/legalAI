export type ClaimType =
  | 'personal_injury'
  | 'clinical_negligence'
  | 'employer_liability'
  | 'public_liability';

export type MatterStatus = 'draft' | 'uploading' | 'processing' | 'ready' | 'archived';

export type UserRole = 'admin' | 'partner' | 'fee_earner' | 'paralegal';

export interface Matter {
  id: string;
  reference: string;
  clientName: string;
  clientDob: string | null;
  incidentDate: string | null;
  claimType: ClaimType;
  status: MatterStatus;
  firmId: string;
  assignedToId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    documents: number;
    chronology: number;
  };
  assignedTo?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface CreateMatterInput {
  reference: string;
  clientName: string;
  clientDob?: string;
  incidentDate?: string;
  claimType: ClaimType;
  notes?: string;
}

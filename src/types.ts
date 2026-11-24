import type { Timestamp } from 'firebase/firestore';

export type Role = 'JOB_SEEKER' | 'EMPLOYER' | 'SUPER_ADMIN' | 'ADMIN' | 'TEAM_MANAGER' | 'JOB_VERIFICATION_OFFICER' | 'EMPLOYER_VERIFICATION_OFFICER' | 'RECRUITMENT_OFFICER' | 'CUSTOMER_SUPPORT' | 'FINANCE_OFFICER' | 'CONTENT_MANAGER';
export type PaymentStatus = 'PENDING_VERIFICATION' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'RESUBMISSION_REQUIRED' | 'CANCELLED';

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  phone?: string;
  accountType: 'JOB_SEEKER' | 'EMPLOYER';
  roles: Role[];
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface Job {
  id: string;
  title: string;
  employerName: string;
  countryId: string;
  countryName?: string;
  cityId: string;
  cityName?: string;
  categoryId: string;
  categoryName?: string;
  salaryMin: number;
  salaryMax: number;
  currency: string;
  experience: string;
  education: string;
  skills: string[];
  description: string;
  benefits: string[];
  vacancies: number;
  accommodation: boolean;
  transportation: boolean;
  medical: boolean;
  visa: boolean;
  workingHours: string;
  applicationDeadline: Timestamp;
  applicationAccessFee: number;
  feeCurrency: string;
  status: string;
  verificationStatus: string;
  verificationReference?: string;
  createdAt?: Timestamp;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban?: string;
  branchName?: string;
  branchCode?: string;
  accountType?: string;
  country: string;
  currency: string;
  instructions?: string;
  logoUrl?: string;
  status: 'ACTIVE' | 'INACTIVE';
  displayOrder: number;
}

export interface Payment {
  paymentId: string;
  userId: string;
  userEmail: string;
  jobId: string;
  jobTitle: string;
  requiredAmount: number;
  amountPaid: number;
  currency: string;
  bankName: string;
  transactionId: string;
  referenceNumber?: string;
  proofPath: string;
  status: PaymentStatus;
  submissionDate: Timestamp;
  rejectionReason?: string;
  adminNote?: string;
}

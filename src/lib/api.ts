import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { BankAccount } from '../types';

export async function callApi<TInput, TOutput>(name: string, data: TInput): Promise<TOutput> {
  const callable = httpsCallable<TInput, TOutput>(functions, name);
  const result = await callable(data);
  return result.data;
}

export const api = {
  bootstrapProfile: (data: { accountType: 'JOB_SEEKER' | 'EMPLOYER'; fullName: string; phone?: string }) => callApi<typeof data, { ok: boolean; roles: string[]; refreshToken: boolean }>('bootstrapProfile', data),
  listActiveBankAccounts: () => callApi<Record<string, never>, { accounts: BankAccount[] }>('listActiveBankAccounts', {}),
  submitPayment: (data: Record<string, unknown>) => callApi<Record<string, unknown>, { ok: boolean; paymentId: string; status: string }>('submitPayment', data),
  reviewPayment: (data: { paymentId: string; action: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION'; note: string }) => callApi<typeof data, { ok: boolean; status: string }>('reviewPayment', data),
  getPaymentProofUrl: (paymentId: string) => callApi<{ paymentId: string }, { url: string }>('getPaymentProofUrl', { paymentId }),
  getProtectedJob: (jobId: string) => callApi<{ jobId: string }, Record<string, unknown>>('getProtectedJob', { jobId }),
  getReceipt: (paymentId: string) => callApi<{ paymentId: string }, Record<string, unknown>>('getReceipt', { paymentId }),
  saveBankAccount: (data: Record<string, unknown>) => callApi<Record<string, unknown>, { ok: boolean; id: string }>('saveBankAccount', data),
  submitEmployerJob: (data: Record<string, unknown>) => callApi<Record<string, unknown>, { ok: boolean; jobId: string; status: string }>('submitEmployerJob', data),
  reviewJob: (data: { jobId: string; action: string; note: string }) => callApi<typeof data, { ok: boolean; status: string }>('reviewJob', data),
  registerTeamMember: (data: Record<string, unknown>) => callApi<Record<string, unknown>, { ok: boolean; status: string }>('registerTeamMember', data),
  setUserRoles: (data: { userId: string; roles: string[]; status: string }) => callApi<typeof data, { ok: boolean }>('setUserRoles', data),
  adminStats: () => callApi<Record<string, never>, Record<string, number>>('adminDashboardStats', {}),
  seedDemoData: () => callApi<Record<string, never>, { ok: boolean; countries: number; categories: number; note: string }>('seedDemoData', {}),
  aiJobMatch: (query: string) => callApi<{ query: string }, { extracted: Record<string, unknown>; matches: Array<Record<string, unknown>> }>('aiJobMatch', { query }),
  aiCareerTool: (data: { tool: string; content: string; jobId?: string }) => callApi<typeof data, { title: string; result: string; warnings: string[]; suggestions: string[] }>('aiCareerTool', data),
};

import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, describe, it } from 'vitest';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-gulf-job-works',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'jobs/job-1'), { title: 'Accountant', status: 'PUBLISHED', employerId: 'employer-1' });
    await setDoc(doc(db, 'jobs/job-1/private/application'), { applicationUrl: 'https://employer.example/apply' });
    await setDoc(doc(db, 'payments/pay-1'), { userId: 'user-a', status: 'APPROVED' });
    await setDoc(doc(db, 'bankAccounts/bank-1'), { bankName: 'Private Bank', status: 'ACTIVE' });
  });
});

afterAll(async () => env.cleanup());

const userDb = (uid: string, roles: string[] = ['JOB_SEEKER']) => env.authenticatedContext(uid, { email_verified: true, roles }).firestore();

describe('backend data boundaries', () => {
  it('allows public users to read only published job previews', async () => {
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'jobs/job-1')));
  });

  it('never exposes protected application fields directly', async () => {
    await assertFails(getDoc(doc(userDb('user-a'), 'jobs/job-1/private/application')));
  });

  it('prevents users reading another user payment', async () => {
    await assertSucceeds(getDoc(doc(userDb('user-a'), 'payments/pay-1')));
    await assertFails(getDoc(doc(userDb('user-b'), 'payments/pay-1')));
  });

  it('prevents frontend payment status changes', async () => {
    await assertFails(setDoc(doc(userDb('user-a'), 'payments/pay-1'), { status: 'APPROVED' }, { merge: true }));
  });

  it('prevents employer direct job publishing', async () => {
    await assertFails(setDoc(doc(userDb('employer-1', ['EMPLOYER']), 'jobs/job-2'), { status: 'PUBLISHED', employerId: 'employer-1' }));
  });

  it('prevents normal users from editing bank accounts', async () => {
    await assertFails(setDoc(doc(userDb('user-a'), 'bankAccounts/bank-1'), { status: 'INACTIVE' }, { merge: true }));
  });

  it('allows finance staff to read payments', async () => {
    await assertSucceeds(getDoc(doc(userDb('finance-1', ['FINANCE_OFFICER']), 'payments/pay-1')));
  });
});

describe('private payment proofs', () => {
  it('allows owner upload, denies another user, allows finance reviewer', async () => {
    const ownerStorage = env.authenticatedContext('user-a', { roles: ['JOB_SEEKER'] }).storage();
    const path = 'paymentProofs/user-a/PAY_1234567890_abcd/proof.png';
    await assertSucceeds(uploadBytes(ref(ownerStorage, path), new Uint8Array([137,80,78,71]), { contentType: 'image/png' }));
    await assertFails(getBytes(ref(env.authenticatedContext('user-b', { roles: ['JOB_SEEKER'] }).storage(), path)));
    await assertSucceeds(getBytes(ref(env.authenticatedContext('finance-1', { roles: ['FINANCE_OFFICER'] }).storage(), path)));
  });
});

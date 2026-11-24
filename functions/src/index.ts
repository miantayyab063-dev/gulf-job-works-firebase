import { initializeApp } from 'firebase-admin/app';
import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { z } from 'zod';

initializeApp();
const db = getFirestore();
const bucket = getStorage().bucket();
const REGION = 'asia-south1';
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const INITIAL_ADMIN_EMAIL = defineString('INITIAL_ADMIN_EMAIL', { default: '' });
const GEMINI_MODEL = defineString('GEMINI_MODEL', { default: 'gemini-2.5-flash' });

type Role = 'JOB_SEEKER' | 'EMPLOYER' | 'SUPER_ADMIN' | 'ADMIN' | 'TEAM_MANAGER' |
  'JOB_VERIFICATION_OFFICER' | 'EMPLOYER_VERIFICATION_OFFICER' | 'RECRUITMENT_OFFICER' |
  'CUSTOMER_SUPPORT' | 'FINANCE_OFFICER' | 'CONTENT_MANAGER';

const REVIEW_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'];
const JOB_REVIEW_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'TEAM_MANAGER', 'JOB_VERIFICATION_OFFICER'];
const ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN'];

function authUser(request: { auth?: { uid: string; token: Record<string, unknown> } }) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in to continue.');
  return request.auth;
}

function requireVerified(request: { auth?: { uid: string; token: Record<string, unknown> } }) {
  const auth = authUser(request);
  if (auth.token.email_verified !== true) throw new HttpsError('failed-precondition', 'Verify your email before continuing.');
  return auth;
}

function tokenRoles(token: Record<string, unknown>): Role[] {
  return Array.isArray(token.roles) ? token.roles.filter((v): v is Role => typeof v === 'string') : [];
}

function requireRole(request: { auth?: { uid: string; token: Record<string, unknown> } }, allowed: Role[]) {
  const auth = authUser(request);
  if (!tokenRoles(auth.token).some((role) => allowed.includes(role))) throw new HttpsError('permission-denied', 'You do not have permission for this action.');
  return auth;
}

async function audit(actorId: string, actorRoles: Role[], action: string, targetType: string, targetId: string, before: unknown = null, after: unknown = null) {
  await db.collection('auditLogs').add({ actorId, actorRoles, action, targetType, targetId, previousValue: before, newValue: after, createdAt: FieldValue.serverTimestamp() });
}

async function rateLimit(uid: string, action: string, limit: number, seconds: number) {
  const slot = Math.floor(Date.now() / (seconds * 1000));
  const ref = db.doc(`rateLimits/${uid}_${action}_${slot}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? Number(snap.data()?.count || 0) : 0;
    if (count >= limit) throw new HttpsError('resource-exhausted', 'Too many requests. Please wait and try again.');
    tx.set(ref, { count: count + 1, expiresAt: Timestamp.fromMillis(Date.now() + seconds * 2000) }, { merge: true });
  });
}

const profileSchema = z.object({
  accountType: z.enum(['JOB_SEEKER', 'EMPLOYER']),
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).optional().default(''),
});

export const bootstrapProfile = onCall({ region: REGION }, async (request) => {
  const auth = requireVerified(request);
  const input = profileSchema.parse(request.data);
  const email = String(auth.token.email || '').toLowerCase();
  const isInitialAdmin = email && email === INITIAL_ADMIN_EMAIL.value().toLowerCase();
  const roles: Role[] = isInitialAdmin ? ['SUPER_ADMIN'] : [input.accountType];
  const ref = db.doc(`users/${auth.uid}`);
  const existing = await ref.get();
  if (!existing.exists) {
    await ref.set({ uid: auth.uid, email, fullName: input.fullName, phone: input.phone, accountType: input.accountType, roles, status: 'ACTIVE', emailVerified: true, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await getAuth().setCustomUserClaims(auth.uid, { roles });
    await audit(auth.uid, roles, 'USER_PROFILE_CREATED', 'user', auth.uid, null, { accountType: input.accountType });
  }
  return { ok: true, roles, refreshToken: !existing.exists };
});

export const registerTeamMember = onCall({ region: REGION }, async (request) => {
  const auth = requireVerified(request);
  const input = z.object({ fullName: z.string().min(2).max(100), phone: z.string().min(7).max(30), identification: z.string().min(4).max(80), city: z.string().min(2).max(80), designation: z.string().min(2).max(80), department: z.string().min(2).max(80), experience: z.string().max(500), reason: z.string().min(20).max(1000), assignedRegion: z.string().max(80), documents: z.array(z.string()).max(10).default([]) }).parse(request.data);
  await db.doc(`teamMembers/${auth.uid}`).set({ userId: auth.uid, email: auth.token.email || '', ...input, status: 'PENDING', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await audit(auth.uid, tokenRoles(auth.token), 'TEAM_REGISTRATION_SUBMITTED', 'teamMember', auth.uid);
  return { ok: true, status: 'PENDING' };
});

export const listActiveBankAccounts = onCall({ region: REGION }, async (request) => {
  requireVerified(request);
  const snap = await db.collection('bankAccounts').where('status', '==', 'ACTIVE').orderBy('displayOrder', 'asc').get();
  return { accounts: snap.docs.map((doc) => ({ id: doc.id, ...doc.data(), accountNumber: doc.data().accountNumber, iban: doc.data().iban })) };
});

const paymentSchema = z.object({
  paymentId: z.string().regex(/^[A-Za-z0-9_-]{10,64}$/),
  jobId: z.string().min(3).max(128),
  bankAccountId: z.string().min(3).max(128),
  amountPaid: z.number().positive().max(10_000_000),
  transactionId: z.string().trim().min(4).max(120),
  referenceNumber: z.string().trim().max(120).optional().default(''),
  paymentDate: z.string().date(),
  senderName: z.string().trim().max(100).optional().default(''),
  senderBank: z.string().trim().max(100).optional().default(''),
  senderLast4: z.string().regex(/^\d{4}$/).or(z.literal('')).optional().default(''),
  proofPath: z.string().min(10).max(500),
  additionalNote: z.string().trim().max(1000).optional().default(''),
});

export const submitPayment = onCall({ region: REGION }, async (request) => {
  const auth = requireVerified(request);
  await rateLimit(auth.uid, 'submitPayment', 5, 600);
  const input = paymentSchema.parse(request.data);
  if (!input.proofPath.startsWith(`paymentProofs/${auth.uid}/${input.paymentId}/`)) throw new HttpsError('permission-denied', 'Invalid payment proof path.');

  const [jobSnap, bankSnap, proofExists, proofMetadata] = await Promise.all([
    db.doc(`jobs/${input.jobId}`).get(),
    db.doc(`bankAccounts/${input.bankAccountId}`).get(),
    bucket.file(input.proofPath).exists(),
    bucket.file(input.proofPath).getMetadata(),
  ]);
  if (!jobSnap.exists || jobSnap.data()?.status !== 'PUBLISHED') throw new HttpsError('failed-precondition', 'This job is not available for payment.');
  const job = jobSnap.data()!;
  if (job.applicationDeadline?.toMillis?.() < Date.now()) throw new HttpsError('failed-precondition', 'This job has expired.');
  if (!bankSnap.exists || bankSnap.data()?.status !== 'ACTIVE') throw new HttpsError('failed-precondition', 'The selected bank account is unavailable.');
  if (!proofExists[0]) throw new HttpsError('failed-precondition', 'Payment screenshot was not uploaded.');
  const proofType = String(proofMetadata[0].contentType || '');
  const proofSize = Number(proofMetadata[0].size || 0);
  if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(proofType) || proofSize <= 0 || proofSize > 8 * 1024 * 1024) throw new HttpsError('invalid-argument', 'Payment proof type or size is not allowed.');

  const txId = input.transactionId.toUpperCase().replace(/\s+/g, '');
  const refNo = input.referenceNumber.toUpperCase().replace(/\s+/g, '');
  const key = (value: string) => createHash('sha256').update(value).digest('hex');
  const transactionKeyRef = db.doc(`paymentDuplicateKeys/tx_${key(`${input.bankAccountId}:${txId}`)}`);
  const referenceKeyRef = refNo ? db.doc(`paymentDuplicateKeys/ref_${key(`${input.bankAccountId}:${refNo}`)}`) : null;
  const paymentRef = db.doc(`payments/${input.paymentId}`);
  await db.runTransaction(async (tx) => {
    const duplicateTx = await tx.get(transactionKeyRef);
    if (duplicateTx.exists) throw new HttpsError('already-exists', 'This transaction/reference number has already been submitted.');
    if (referenceKeyRef && (await tx.get(referenceKeyRef)).exists) throw new HttpsError('already-exists', 'This transaction/reference number has already been submitted.');
    const previous = await tx.get(db.collection('payments').where('userId', '==', auth.uid).where('jobId', '==', input.jobId).where('status', 'in', ['PENDING_VERIFICATION', 'UNDER_REVIEW', 'APPROVED']).limit(1));
    if (!previous.empty) throw new HttpsError('already-exists', 'You already have an active payment request for this job.');
    tx.create(paymentRef, {
      paymentId: input.paymentId,
      userId: auth.uid,
      userEmail: auth.token.email || '',
      jobId: input.jobId,
      jobTitle: job.title,
      requiredAmount: Number(job.applicationAccessFee),
      amountPaid: input.amountPaid,
      currency: job.feeCurrency || 'PKR',
      bankAccountId: input.bankAccountId,
      bankName: bankSnap.data()?.bankName,
      transactionId: input.transactionId,
      transactionKey: `${input.bankAccountId}:${txId}`,
      referenceNumber: input.referenceNumber,
      referenceKey: refNo ? `${input.bankAccountId}:${refNo}` : '',
      paymentDate: Timestamp.fromDate(new Date(`${input.paymentDate}T12:00:00Z`)),
      senderName: input.senderName,
      senderBank: input.senderBank,
      senderLast4: input.senderLast4,
      proofPath: input.proofPath,
      additionalNote: input.additionalNote,
      status: 'PENDING_VERIFICATION',
      submissionDate: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(transactionKeyRef, { paymentId: input.paymentId, bankAccountId: input.bankAccountId, createdAt: FieldValue.serverTimestamp() });
    if (referenceKeyRef) tx.create(referenceKeyRef, { paymentId: input.paymentId, bankAccountId: input.bankAccountId, createdAt: FieldValue.serverTimestamp() });
    tx.set(db.collection('notifications').doc(), { userId: auth.uid, type: 'PAYMENT_SUBMITTED', title: 'Payment submitted', message: `Payment ${input.paymentId} is pending verification.`, read: false, createdAt: FieldValue.serverTimestamp() });
  });
  await audit(auth.uid, tokenRoles(auth.token), 'PAYMENT_SUBMITTED', 'payment', input.paymentId, null, { jobId: input.jobId, amount: input.amountPaid });
  return { ok: true, paymentId: input.paymentId, status: 'PENDING_VERIFICATION' };
});

export const getPaymentProofUrl = onCall({ region: REGION }, async (request) => {
  const auth = authUser(request);
  const paymentId = z.string().min(10).max(64).parse(request.data?.paymentId);
  const payment = await db.doc(`payments/${paymentId}`).get();
  if (!payment.exists) throw new HttpsError('not-found', 'Payment not found.');
  const data = payment.data()!;
  const staff = tokenRoles(auth.token).some((r) => REVIEW_ROLES.includes(r));
  if (data.userId !== auth.uid && !staff) throw new HttpsError('permission-denied', 'You cannot view this payment proof.');
  const [url] = await bucket.file(data.proofPath).getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60 * 1000 });
  return { url, expiresInSeconds: 300 };
});

export const reviewPayment = onCall({ region: REGION }, async (request) => {
  const auth = requireRole(request, REVIEW_ROLES);
  const input = z.object({ paymentId: z.string().min(10).max(64), action: z.enum(['APPROVE', 'REJECT', 'REQUEST_RESUBMISSION']), note: z.string().trim().max(1000).default('') }).parse(request.data);
  if (input.action !== 'APPROVE' && input.note.length < 5) throw new HttpsError('invalid-argument', 'A clear review reason is required.');
  const paymentRef = db.doc(`payments/${input.paymentId}`);
  let owner = '';
  let jobId = '';
  let before: unknown = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(paymentRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Payment not found.');
    const payment = snap.data()!;
    before = { status: payment.status };
    owner = payment.userId;
    jobId = payment.jobId;
    if (owner === auth.uid) throw new HttpsError('permission-denied', 'You cannot review your own payment.');
    if (!['PENDING_VERIFICATION', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED'].includes(payment.status)) throw new HttpsError('failed-precondition', 'This payment has already been finalized.');
    if (input.action === 'APPROVE' && Number(payment.amountPaid) !== Number(payment.requiredAmount)) throw new HttpsError('failed-precondition', 'Amount paid does not match the required amount. Reject or request resubmission.');
    const status = input.action === 'APPROVE' ? 'APPROVED' : input.action === 'REJECT' ? 'REJECTED' : 'RESUBMISSION_REQUIRED';
    tx.update(paymentRef, { status, reviewedBy: auth.uid, reviewedAt: FieldValue.serverTimestamp(), adminNote: input.note, rejectionReason: input.action === 'APPROVE' ? '' : input.note, updatedAt: FieldValue.serverTimestamp() });
    if (input.action === 'APPROVE') {
      const entitlementId = `${owner}_${jobId}`;
      tx.set(db.doc(`jobAccess/${entitlementId}`), { id: entitlementId, userId: owner, jobId, paymentId: input.paymentId, status: 'UNLOCKED', unlockedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });
      tx.set(db.doc(`receipts/${input.paymentId}`), { receiptId: input.paymentId, paymentId: input.paymentId, userId: owner, jobId, jobTitle: payment.jobTitle, amountPaid: payment.amountPaid, currency: payment.currency, bankName: payment.bankName, transactionId: payment.transactionId, referenceNumber: payment.referenceNumber, paymentDate: payment.paymentDate, verificationDate: FieldValue.serverTimestamp(), status: 'VERIFIED', createdAt: FieldValue.serverTimestamp() });
      tx.set(db.collection('transactions').doc(), { paymentId: input.paymentId, userId: owner, jobId, type: 'JOB_ACCESS', amount: payment.amountPaid, currency: payment.currency, status: 'VERIFIED', createdAt: FieldValue.serverTimestamp() });
    }
    tx.set(db.collection('notifications').doc(), { userId: owner, type: `PAYMENT_${status}`, title: input.action === 'APPROVE' ? 'Payment verified' : 'Payment update', message: input.action === 'APPROVE' ? 'Your application access is now unlocked.' : input.note, read: false, createdAt: FieldValue.serverTimestamp() });
  });
  await audit(auth.uid, tokenRoles(auth.token), `PAYMENT_${input.action}`, 'payment', input.paymentId, before, { note: input.note });
  return { ok: true, status: input.action === 'APPROVE' ? 'APPROVED' : input.action === 'REJECT' ? 'REJECTED' : 'RESUBMISSION_REQUIRED' };
});

export const getProtectedJob = onCall({ region: REGION }, async (request) => {
  const auth = requireVerified(request);
  const jobId = z.string().min(3).max(128).parse(request.data?.jobId);
  const access = await db.doc(`jobAccess/${auth.uid}_${jobId}`).get();
  if (!access.exists || access.data()?.status !== 'UNLOCKED') throw new HttpsError('permission-denied', 'Approved payment is required to access application details.');
  const [job, privateInfo] = await Promise.all([db.doc(`jobs/${jobId}`).get(), db.doc(`jobs/${jobId}/private/application`).get()]);
  if (!job.exists || !privateInfo.exists) throw new HttpsError('not-found', 'Application information is unavailable.');
  return { jobId, title: job.data()?.title, deadline: job.data()?.applicationDeadline, ...privateInfo.data() };
});

export const getReceipt = onCall({ region: REGION }, async (request) => {
  const auth = authUser(request);
  const paymentId = z.string().min(10).max(64).parse(request.data?.paymentId);
  const snap = await db.doc(`receipts/${paymentId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Receipt not found.');
  const data = snap.data()!;
  if (data.userId !== auth.uid && !tokenRoles(auth.token).some((r) => REVIEW_ROLES.includes(r))) throw new HttpsError('permission-denied', 'You cannot view this receipt.');
  return { id: snap.id, ...data };
});

export const saveBankAccount = onCall({ region: REGION }, async (request) => {
  const auth = requireRole(request, ADMIN_ROLES);
  const input = z.object({ id: z.string().max(128).optional(), bankName: z.string().min(2).max(100), accountTitle: z.string().min(2).max(120), accountNumber: z.string().min(4).max(80), iban: z.string().max(80).default(''), branchName: z.string().max(120).default(''), branchCode: z.string().max(40).default(''), accountType: z.string().max(50).default(''), country: z.string().min(2).max(80), currency: z.string().min(3).max(5), instructions: z.string().max(1000).default(''), logoUrl: z.string().url().or(z.literal('')).default(''), status: z.enum(['ACTIVE', 'INACTIVE']), displayOrder: z.number().int().min(0).max(999) }).parse(request.data);
  const ref = input.id ? db.doc(`bankAccounts/${input.id}`) : db.collection('bankAccounts').doc();
  const before = (await ref.get()).data() || null;
  await ref.set({ ...input, id: ref.id, updatedBy: auth.uid, updatedAt: FieldValue.serverTimestamp(), createdAt: before ? before.createdAt : FieldValue.serverTimestamp() }, { merge: true });
  await audit(auth.uid, tokenRoles(auth.token), before ? 'BANK_ACCOUNT_UPDATED' : 'BANK_ACCOUNT_CREATED', 'bankAccount', ref.id, before, { ...input, accountNumber: 'REDACTED' });
  return { ok: true, id: ref.id };
});

export const deleteBankAccount = onCall({ region: REGION }, async (request) => {
  const auth = requireRole(request, ['SUPER_ADMIN']);
  const id = z.string().min(3).max(128).parse(request.data?.id);
  const ref = db.doc(`bankAccounts/${id}`);
  const before = (await ref.get()).data();
  if (!before) throw new HttpsError('not-found', 'Bank account not found.');
  await ref.delete();
  await audit(auth.uid, tokenRoles(auth.token), 'BANK_ACCOUNT_DELETED', 'bankAccount', id, { ...before, accountNumber: 'REDACTED' }, null);
  return { ok: true };
});

export const submitEmployerJob = onCall({ region: REGION }, async (request) => {
  const auth = requireRole(request, ['EMPLOYER']);
  const input = z.object({ jobId: z.string().max(128).optional(), title: z.string().min(3).max(150), countryId: z.string().min(2).max(80), cityId: z.string().min(2).max(80), categoryId: z.string().min(2).max(80), vacancies: z.number().int().positive().max(10000), salaryMin: z.number().nonnegative(), salaryMax: z.number().nonnegative(), currency: z.string().min(3).max(5), experience: z.string().max(200), education: z.string().max(300), skills: z.array(z.string().max(80)).max(30), description: z.string().min(50).max(10000), benefits: z.array(z.string().max(120)).max(30), accommodation: z.boolean(), transportation: z.boolean(), medical: z.boolean(), visa: z.boolean(), workingHours: z.string().max(120), applicationDeadline: z.string().date(), applicationAccessFee: z.number().nonnegative(), feeCurrency: z.string().min(3).max(5), applicationUrl: z.string().url(), applicationInstructions: z.string().min(20).max(5000) }).parse(request.data);
  const employer = await db.doc(`employers/${auth.uid}`).get();
  if (!employer.exists || employer.data()?.status !== 'VERIFIED') throw new HttpsError('failed-precondition', 'Employer verification is required before submitting jobs.');
  const ref = input.jobId ? db.doc(`jobs/${input.jobId}`) : db.collection('jobs').doc();
  const existing = await ref.get();
  if (existing.exists && existing.data()?.employerId !== auth.uid) throw new HttpsError('permission-denied', 'You cannot edit this job.');
  const { applicationUrl, applicationInstructions, ...publicJob } = input;
  const batch = db.batch();
  batch.set(ref, { ...publicJob, id: ref.id, employerId: auth.uid, employerName: employer.data()?.companyName, status: 'SUBMITTED', sourceType: 'GULF_JOB_WORKS', verificationStatus: 'UNDER_REVIEW', submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdAt: existing.exists ? existing.data()?.createdAt : FieldValue.serverTimestamp() }, { merge: true });
  batch.set(db.doc(`jobs/${ref.id}/private/application`), { applicationUrl, applicationInstructions, authorizedContact: '', referenceNumber: '', requiredDocuments: [], gulfJobWorksNotes: '', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(db.collection(`jobs/${ref.id}/reviewHistory`).doc(), { action: 'SUBMITTED', by: auth.uid, note: '', createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  await audit(auth.uid, tokenRoles(auth.token), 'JOB_SUBMITTED', 'job', ref.id);
  return { ok: true, jobId: ref.id, status: 'SUBMITTED' };
});

export const reviewJob = onCall({ region: REGION }, async (request) => {
  const auth = requireRole(request, JOB_REVIEW_ROLES);
  const input = z.object({ jobId: z.string().min(3).max(128), action: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES', 'PAUSE', 'ARCHIVE']), note: z.string().trim().max(2000).default('') }).parse(request.data);
  if (input.action !== 'APPROVE' && input.note.length < 5) throw new HttpsError('invalid-argument', 'A review note is required.');
  const ref = db.doc(`jobs/${input.jobId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Job not found.');
  const status = input.action === 'APPROVE' ? 'PUBLISHED' : input.action === 'REQUEST_CHANGES' ? 'REQUEST_CHANGES' : input.action === 'PAUSE' ? 'PAUSED' : input.action === 'ARCHIVE' ? 'ARCHIVED' : 'REJECTED';
  const batch = db.batch();
  batch.update(ref, { status, verificationStatus: input.action === 'APPROVE' ? 'APPROVED' : status, verifiedBy: input.action === 'APPROVE' ? auth.uid : null, verificationDate: input.action === 'APPROVE' ? FieldValue.serverTimestamp() : null, verificationReference: input.action === 'APPROVE' ? `GJW-${input.jobId}-${Date.now()}` : '', verificationNotes: input.note, updatedAt: FieldValue.serverTimestamp() });
  batch.set(db.collection(`jobs/${input.jobId}/reviewHistory`).doc(), { action: input.action, status, by: auth.uid, note: input.note, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  await audit(auth.uid, tokenRoles(auth.token), `JOB_${input.action}`, 'job', input.jobId, { status: snap.data()?.status }, { status, note: input.note });
  return { ok: true, status };
});

export const setUserRoles = onCall({ region: REGION }, async (request) => {
  const auth = requireRole(request, ['SUPER_ADMIN']);
  const input = z.object({ userId: z.string().min(8).max(128), roles: z.array(z.enum(['JOB_SEEKER','EMPLOYER','SUPER_ADMIN','ADMIN','TEAM_MANAGER','JOB_VERIFICATION_OFFICER','EMPLOYER_VERIFICATION_OFFICER','RECRUITMENT_OFFICER','CUSTOMER_SUPPORT','FINANCE_OFFICER','CONTENT_MANAGER'])).min(1), status: z.enum(['ACTIVE', 'SUSPENDED']) }).parse(request.data);
  if (input.userId === auth.uid && input.status === 'SUSPENDED') throw new HttpsError('failed-precondition', 'You cannot suspend your own account.');
  await Promise.all([getAuth().setCustomUserClaims(input.userId, { roles: input.roles, suspended: input.status === 'SUSPENDED' }), db.doc(`users/${input.userId}`).set({ roles: input.roles, status: input.status, updatedAt: FieldValue.serverTimestamp() }, { merge: true })]);
  await audit(auth.uid, tokenRoles(auth.token), 'USER_ROLES_UPDATED', 'user', input.userId, null, input);
  return { ok: true };
});

export const adminDashboardStats = onCall({ region: REGION }, async (request) => {
  requireRole(request, [...ADMIN_ROLES, 'TEAM_MANAGER', 'FINANCE_OFFICER']);
  const count = async (collection: string, field?: string, opValue?: unknown) => {
    const query = field ? db.collection(collection).where(field, '==', opValue) : db.collection(collection);
    return (await query.count().get()).data().count;
  };
  const [users, seekers, employers, team, pendingJobs, verifiedJobs, activeJobs, expiredJobs, pendingPayments, approvedPayments, rejectedPayments] = await Promise.all([
    count('users'), count('users', 'accountType', 'JOB_SEEKER'), count('employers'), count('teamMembers', 'status', 'APPROVED'), count('jobs', 'status', 'SUBMITTED'), count('jobs', 'verificationStatus', 'APPROVED'), count('jobs', 'status', 'PUBLISHED'), count('jobs', 'status', 'EXPIRED'), count('payments', 'status', 'PENDING_VERIFICATION'), count('payments', 'status', 'APPROVED'), count('payments', 'status', 'REJECTED')
  ]);
  const approved = await db.collection('payments').where('status', '==', 'APPROVED').get();
  const totalRevenue = approved.docs.reduce((sum, doc) => sum + Number(doc.data().amountPaid || 0), 0);
  return { users, seekers, employers, team, pendingJobs, verifiedJobs, activeJobs, expiredJobs, pendingPayments, approvedPayments, rejectedPayments, totalRevenue };
});

export const seedDemoData = onCall({ region: REGION }, async (request) => {
  const auth = requireRole(request, ['SUPER_ADMIN']);
  const countries = [
    ['saudi-arabia','Saudi Arabia'],['united-arab-emirates','United Arab Emirates'],['qatar','Qatar'],['kuwait','Kuwait'],['bahrain','Bahrain'],['oman','Oman']
  ];
  const categories = ['Accounting & Finance','Engineering','IT & Software','Healthcare','Construction','Hospitality','Security','Drivers','Sales & Marketing','Administration','HR','Education','Mechanical','Electrical','Technical Trades','Oil & Gas','Telecom','Logistics','Warehouse','Retail','Management'];
  const batch = db.batch();
  countries.forEach(([id,name], displayOrder) => batch.set(db.doc(`countries/${id}`), { id, name, active: true, displayOrder, demo: true }));
  categories.forEach((name, displayOrder) => { const id=name.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); batch.set(db.doc(`jobCategories/${id}`), { id, name, active: true, displayOrder, demo: true }); });
  const settings: Record<string, unknown> = { public: true, defaultApplicationAccessFee: 0, currency: 'PKR', allowedProofFormats: ['image/jpeg','image/png','image/webp','application/pdf'], maximumProofSizeMb: 8, paymentVerificationMode: 'MANUAL_BANK_TRANSFER_ONLY', demo: true };
  batch.set(db.doc('settings/public'), settings);
  const legal: Record<string,string> = {
    terms: 'Gulf Job Works provides verified job information and career support services. Paying an access fee does not guarantee employment. Users must provide accurate account and payment information.',
    privacy: 'Personal information is used to provide account, recruitment, payment verification and support services. Private payment proofs are restricted to the account owner and authorized finance or administration staff.',
    refund: 'Refund eligibility depends on the configured service terms and the status of the accessed service. Manual payment records are reviewed individually. Employment outcomes are not refundable guarantees.',
    disclaimer: 'Gulf Job Works verifies listings according to its internal process. External jobs are identified separately. Employer or recruiter decisions remain independent. Visa issuance is not guaranteed unless explicitly stated for a separate service.',
    'employer-agreement': 'Employers must submit genuine and lawful vacancies. Employers cannot publish directly and accept internal verification, change requests, pausing and removal controls.',
    'job-seeker-agreement': 'Job seekers must provide accurate information. Payment verification is manual. Access fees do not guarantee interviews, selection, employment or visa issuance.'
  };
  Object.entries(legal).forEach(([id, content]) => batch.set(db.doc(`cmsPages/${id}`), { title: id.replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase()), content, status: 'PUBLISHED', demo: true, updatedAt: FieldValue.serverTimestamp() }));
  await batch.commit();
  await audit(auth.uid, tokenRoles(auth.token), 'DEMO_DATA_SEEDED', 'system', 'demo-data');
  return { ok: true, countries: countries.length, categories: categories.length, note: 'Demo/test configuration created. No bank account or fee was hard-coded.' };
});

async function callGemini(system: string, user: string) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL.value()}:generateContent?key=${GEMINI_API_KEY.value()}`;
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.25, responseMimeType: 'application/json' } }) });
  if (!response.ok) throw new HttpsError('internal', 'AI service is temporarily unavailable.');
  const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new HttpsError('internal', 'AI service returned no result.');
  return JSON.parse(text);
}

export const aiJobMatch = onCall({ region: REGION, secrets: [GEMINI_API_KEY] }, async (request) => {
  const auth = requireVerified(request);
  await rateLimit(auth.uid, 'aiJobMatch', 20, 3600);
  const queryText = z.string().min(8).max(1000).parse(request.data?.query);
  const jobs = await db.collection('jobs').where('status', '==', 'PUBLISHED').limit(100).get();
  const records = jobs.docs.map((doc) => { const d = doc.data(); return { id: doc.id, title: d.title, country: d.countryName, city: d.cityName, salaryMin: d.salaryMin, salaryMax: d.salaryMax, currency: d.currency, experience: d.experience, education: d.education, skills: d.skills, category: d.categoryName }; });
  const output = await callGemini('You match candidates only to the supplied verified active jobs. Never invent a job, employer, salary, URL, qualification or status. Return JSON: {extracted:{profession,country,city,minSalary,experience,skills,education,employmentType},matches:[{jobId,matchPercentage,experienceMatch,locationMatch,salaryMatch,skillsMatch,reason}]}. Use only jobId values in the dataset.', JSON.stringify({ userQuery: queryText, verifiedJobs: records }));
  await db.collection('aiRequests').add({ userId: auth.uid, type: 'JOB_MATCH', input: queryText, outputJobIds: Array.isArray(output.matches) ? output.matches.map((m: { jobId?: string }) => m.jobId).filter(Boolean) : [], createdAt: FieldValue.serverTimestamp() });
  return output;
});

export const aiCareerTool = onCall({ region: REGION, secrets: [GEMINI_API_KEY] }, async (request) => {
  const auth = requireVerified(request);
  await rateLimit(auth.uid, 'aiCareerTool', 30, 3600);
  const input = z.object({ tool: z.enum(['IMPROVE_SUMMARY', 'REWRITE_EXPERIENCE', 'COVER_LETTER', 'ATS_REVIEW', 'MISSING_SKILLS', 'EXPLAIN_REQUIREMENTS']), content: z.string().min(20).max(15000), jobId: z.string().max(128).optional() }).parse(request.data);
  let job: Record<string, unknown> | null = null;
  if (input.jobId) { const snap = await db.doc(`jobs/${input.jobId}`).get(); if (!snap.exists || snap.data()?.status !== 'PUBLISHED') throw new HttpsError('not-found', 'Verified job not found.'); const d = snap.data()!; job = { id: snap.id, title: d.title, description: d.description, experience: d.experience, education: d.education, skills: d.skills }; }
  const output = await callGemini('You are the Gulf Job Works career assistant. Improve only supplied facts. Never fabricate experience, qualifications, employers, job listings, salaries, URLs or verification. Return JSON: {title,result,warnings:string[],suggestions:string[]}.', JSON.stringify({ tool: input.tool, candidateContent: input.content, verifiedJob: job }));
  await db.collection('aiRequests').add({ userId: auth.uid, type: input.tool, jobId: input.jobId || null, createdAt: FieldValue.serverTimestamp() });
  return output;
});

export const expireJobs = onSchedule({ region: REGION, schedule: 'every day 00:15', timeZone: 'Asia/Karachi' }, async () => {
  const snap = await db.collection('jobs').where('status', '==', 'PUBLISHED').where('applicationDeadline', '<', Timestamp.now()).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.update(doc.ref, { status: 'EXPIRED', updatedAt: FieldValue.serverTimestamp() }));
  await batch.commit();
});

# GULF JOB WORKS

**YOUR TALENT. GLOBAL OPPORTUNITIES.**

A Firebase-first, TypeScript recruitment platform prepared for Google AI Studio Build mode. The project includes public verified-job search, job seeker and employer accounts, internal roles, manual bank-transfer verification, private payment proofs, admin approval, backend-protected job access, AI career tools, CV profiles, notifications, support, CMS, audit logs and responsive dashboards.

## Security-critical flow

1. A verified user opens a published job.
2. The payment page requests active bank accounts from a callable backend function.
3. The user transfers money manually, enters the transaction data and uploads proof to a user-owned private path.
4. `submitPayment` validates the job, bank, amount data, upload path and duplicate transaction/reference.
5. Submission creates `PENDING_VERIFICATION`; it does **not** create job access.
6. An authorized `SUPER_ADMIN`, `ADMIN` or `FINANCE_OFFICER` reviews the private proof.
7. `reviewPayment(APPROVE)` atomically updates the payment, creates `jobAccess`, receipt, transaction, notification and audit records.
8. `getProtectedJob` checks the authenticated user and an `UNLOCKED` entitlement before returning the private application document.

No payment gateway, card checkout, PayPal, Stripe, JazzCash API or EasyPaisa API is included.

## Google AI Studio + Firebase setup

1. Open Google AI Studio Build mode and import this project folder, or connect the Git repository containing it.
2. Create/attach a Firebase project.
3. Enable Authentication providers:
   - Email/Password
   - Google
4. Create Firestore Database and Cloud Storage in the Firebase console.
5. Copy `.env.example` to `.env` and add the Firebase web-app configuration.
6. Copy `functions/.env.example` to `functions/.env` and set `INITIAL_ADMIN_EMAIL` to the first Super Admin email.
7. Configure the Gemini server secret:

   ```bash
   firebase functions:secrets:set GEMINI_API_KEY
   ```

8. Deploy rules, indexes, functions and hosting:

   ```bash
   npm install
   npm --prefix functions install
   npm run build
   npm --prefix functions run build
   firebase use YOUR_FIREBASE_PROJECT_ID
   firebase deploy
   ```

9. Sign in with the exact `INITIAL_ADMIN_EMAIL`, complete onboarding, then refresh the ID token by signing out/in.
10. In Admin:
    - add at least one real bank account;
    - configure payment instructions and fees;
    - optionally seed clearly marked demo countries, categories and legal starter text;
    - approve internal staff and assign least-privilege roles.

## Local development

```bash
cp .env.example .env
npm install
npm --prefix functions install
npm run emulators
npm run dev
```

Set `VITE_USE_EMULATORS=true` in `.env` for local Firebase emulators.

## Required production configuration

- Firebase App Check should be enabled for production callable functions and Storage.
- Add authorized domains for Google sign-in.
- Configure a real email sender/template for authentication and operational notices.
- Replace the placeholder Firebase project selection before deployment.
- Add actual bank accounts only through the Admin interface.
- Review legal text with qualified local counsel for every operating jurisdiction.
- Do not place private application fields in public `jobs` documents. Keep them in `jobs/{jobId}/private/application`.

## Roles

- `JOB_SEEKER`
- `EMPLOYER`
- `SUPER_ADMIN`
- `ADMIN`
- `TEAM_MANAGER`
- `JOB_VERIFICATION_OFFICER`
- `EMPLOYER_VERIFICATION_OFFICER`
- `RECRUITMENT_OFFICER`
- `CUSTOMER_SUPPORT`
- `FINANCE_OFFICER`
- `CONTENT_MANAGER`

Role decisions are enforced in callable functions and Firebase Security Rules. The frontend never decides approval or access.

## Data storage

- Firestore: structured accounts, roles, jobs, payments, entitlements, receipts, CV data, support, notifications, CMS and audit records.
- Cloud Storage: private payment proofs and user documents.
- Firebase Auth: Google and verified email/password identities.
- Cloud Functions: payment/job approval, protected access, duplicate detection, AI calls, statistics and scheduled expiration.

## Validation commands

```bash
npm run build
npm --prefix functions run build
npm run test:rules
```

Security tests cover direct access to protected job fields, cross-user payment access, frontend payment-status mutation, direct employer publishing, bank-account mutation and private proof access.

## Important collection split

Public job data lives in `jobs/{jobId}`. Protected fields live in `jobs/{jobId}/private/application` and are never directly readable from the client. They are returned only by `getProtectedJob` after entitlement verification.

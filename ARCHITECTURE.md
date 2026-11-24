# Architecture

```mermaid
flowchart TD
  UI[Responsive React / TypeScript UI] --> AUTH[Firebase Authentication]
  UI --> FS[Firestore public and user-owned data]
  UI --> FN[Callable Cloud Functions]
  UI --> ST[Private Cloud Storage upload]
  FN --> FS
  FN --> ST
  FN --> AI[Gemini API via server secret]
  FN --> AUDIT[Immutable audit records]
```

## Payment approval transaction

```mermaid
sequenceDiagram
  participant U as Job Seeker
  participant S as Secure Backend
  participant F as Finance Reviewer
  participant D as Firestore
  U->>S: Submit transfer data + private proof path
  S->>D: Validate job, bank, duplicate keys
  S->>D: Create PENDING_VERIFICATION
  F->>S: APPROVE with reviewer identity
  S->>D: Atomic approval + entitlement + receipt + audit
  U->>S: Request protected application details
  S->>D: Verify UNLOCKED entitlement
  S-->>U: Return private application fields
```

## Mobile application readiness

The browser application uses Firebase Auth and callable/backend APIs. Future Android and iOS applications can reuse the same identity, jobs, payments, job access, CV, AI and notification services without duplicating business rules.

## Trust boundaries

- Public job previews never include application URLs or private recruiter data.
- Storage proof objects are owner/staff restricted.
- Custom claims accelerate role checks; Firestore retains auditable role state.
- Payment and job approval happen only in privileged server functions.
- AI receives only verified active job records and explicit candidate content.
- Bank accounts, prices, categories and legal pages are database-configured.

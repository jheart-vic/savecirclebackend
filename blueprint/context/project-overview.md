# SaveCircle - Project Overview

<!-- blueprint:source-hash 08b5ce2b8d81f02bed10a571b20830e8c2eee599eea187cf44474567b0f0fb11 -->

> Backend API for SaveCircle: collections and payout software that MFBs,
> banks, and cooperatives run their ajo and thrift products on. Money moves
> only through each organisation's own licensed accounts, never SaveCircle's.

> **Generated file. Don't hand-edit.** Change `blueprint/project-plan.md` or
> `blueprint/build-plan.md`, then re-run `/overview`. Full rule tables live in
> the project plan; this is the compact contract.

## Problem

Savings groups and MFB contribution products run on paper, cash, and
spreadsheet reconciliation. SaveCircle gives each member an account number,
matches payments automatically, shows one shared ledger, and pays out by
transfer with approvals. Informal groups keep a free ledger-only tier.

## Users

- **Organisation** (MFB, bank, cooperative, business, informal) - the
  customer; brings its own rails.
- **Staff roles** per organisation (client design + Owner): Owner (creator),
  Admin (full access), Treasurer (contributions, payouts, reports; checker),
  Branch manager (branch; first approval), Field officer (groups, members,
  cash; maker).
- **Member** - no account; phone-wide PIN to view, PIN + fresh OTP for money
  actions.

Maker and checker are always different people. One user can hold roles in
several organisations and switches after sign-in.

## Usage model

- **Pilot:** 8 weeks; one cooperative in gateway mode, one MFB design partner.
- **Reachability:** internet-facing API that receives provider webhooks.
- **Tenancy:** Organisation -> Branch (optional) -> Group -> Member. Every
  tenant row has `organisation_id`, enforced by PostgreSQL RLS set per
  request. Cross-organisation access only for SaveCircle support, logged.
- **Regulatory:** no SaveCircle custody or pooled accounts. Live gateway-mode
  money waits for a written legal opinion; fallback is bank-hosted only.
- **Data protection:** BVN/NIN hashed with consent records (NDPA).
- **Audit:** money tables append-only; every approval, hold, override, and
  reversal logged with person and reason. Money instructions are cancelled or
  reversed, never edited.
- **Out of scope:** SaveCircle holding funds, loans, interest, cards.

## Features

Build-plan order. Phase 0 (legal, gateway account, fees, Termii quote, Meta
templates, data protection lead, design-partner MFB) runs in parallel.

Phase 1 - Tenancy and v3 core

1. **Staff auth** - phone + OTP, sessions, AuthEvent.
2. **Organisations, roles, and isolation** - Owner, invites, RLS, per-org
   session lifetime.
3. **Groups and members** - rotating and thrift, CSV upload.
4. **Rotation setup and start** - order, first due date, cycles.
5. **Cash logging and allocation engine** - split across groups, credit.
6. **Reversals** - reasoned, re-allocation within 7 days.
7. **Shared ledger and derived balances** (headline) - arrears, status,
   thrift and credit balances.
8. **Who's next and cash payouts** - completion and restart.
9. **Thrift cycle rollover**. 10. **Inactive members and gap resolution**.
11. **Rotation pause, close, and dissolve**.
12. **Job queue and Notifier** (BullMQ, Termii). 13. **Reminders**.
14. **SMS fallback**. 15. **Member invites and PIN access**.

Phase 2 - Onboarding: 16 **Organisation onboarding** (client's four-step
flow), 17 **PaymentProvider and Paystack adapter**, 18 **Member verification
and account numbers**.

Phase 3 - Collections: 19 **Webhook ingress and auto-allocation**, 20
**Unmatched queue**, 21 **Cash in hand**.

Phase 4 - Disbursements: 22 **Payout accounts** (name enquiry, 24h cooling),
23 **Approvals** (maker-checker), 24 **Withdrawal notices**, 25 **Transfer
engine**, 26 **Automatic rotating payouts** (plus refunds, buy-ins,
settlements), 27 **Early-payout risk controls**.

Phase 5: 28 **Nightly reconciliation**, 29 **Statement export**, 30
**Hardening**.

Later: 31 Flutterwave adapter, 32 branches and dashboard, 33 bank-hosted
adapter, 34 white-label branding, 35 savings-history export, 36 monetization.

## Business rules

### Money modes (per organisation)

- **Bank-hosted** (MFBs, banks): funds in the bank's books; accounts from its
  core-banking API via a per-bank adapter.
- **Gateway-hosted** (cooperatives, businesses): funds in the organisation's
  own Paystack/Flutterwave balance; dedicated virtual accounts; keys stored
  encrypted per organisation.
- **Ledger-only** (informal, and any organisation before rails connect): v3
  manual logging.

### Auth and access

- Staff OTP: 6 digits, hashed, 10 minutes, 5 attempts, 3 requests per phone
  per hour. Sessions revocable; 30 days by default, per-organisation lifetime
  set by its admin. AuthEvent on every OTP and session event. Sign-up and
  sign-in come before onboarding.
- Member PIN: 4 to 6 digits, hashed, one per phone across all groups and
  organisations; set or confirmed on invite accept; reset by re-invite only;
  5 failures lock 30 minutes; rate-limited by IP and phone. Lookup shows only
  accepted-invite groups. A selected group sets its organisation for RLS.
- Invites: single-purpose, 7 days, revocable.

### Accounts and verification

- Onboarding (client design, each step "save and continue later"):
  **Organisation** (name, type, required contact email and phone, suggested
  money mode) -> **KYB** -> **Payment Rails** (Paystack, Flutterwave, or Bank
  API, then key entry, no redirect; only Paystack live, others "coming soon"
  until features 31 and 33; collection account on success) -> **Setup**
  (policies, team, first group). Ledger-only until the collection account is
  issued. Automatic withdrawals need the gateway to allow API transfers.
- KYB uploads (PDF, JPG, PNG, max 5 MB): certificate of incorporation,
  MEMART, directors' ID (NIN or passport), TIN, premises evidence, optional
  extras.
- Member KYC: consented BVN or NIN. Unverified members pay cash only.
- One account number per member per organisation, issued asynchronously,
  retried with back-off, officer fix-and-retry after 3 failures, blocked (not
  deleted) when the member leaves.

### Collections and allocation

- Webhook: verify signature with the organisation's secret, drop duplicates by
  provider reference, re-verify with the provider, create Payment, allocate,
  receipt by WhatsApp/SMS, cancel pending reminders. Target under 1 minute.
- Allocation across the member's groups in the organisation: oldest past-due
  shortfall first; then existing cycles by due date (ties: preferred group,
  then oldest group); thrift takes any amount; excess becomes MemberCredit,
  auto-applied to the next due cycle or refunded on request. Never into an
  unstarted rotation.
- Unmatched queue: payments to the collection account or blocked accounts;
  officer assigns or marks for refund; escalate after 3 days.
- Cash: channel `cash`, tagged with the officer; cash-in-hand = logged -
  deposited; flag after 48 hours; members get cash receipts.
- Escalations to a branch manager go to admins when there are no branches.
- Nightly reconciliation of provider settlement vs ledger opens exceptions;
  nothing fixed silently.

### Arrears and balances

```text
arrears(member) = sum over owed, past-due cycles of
  max(0, cycle.amount_due - net contributions for member and cycle)
thrift balance  = deposits - completed withdrawals - fees
```

Owed unless cancelled, or due after `inactive_from` while not yet paid out
this rotation. Status: `paid` (net >= due), `partial`, `missed` (net = 0 and
past due). All balances derived, never stored.

### Withdrawals

- Only thrift balances and member credit can be withdrawn. A contribution
  allocated to a rotating cycle belongs to that pot and is locked. Rotating
  leavers use the leaver flow, never a withdrawal notice.
- Policy per organisation, overridable per group: allow member withdrawals,
  require approval, notice period, instant limit, lock-in, minimum balance,
  early-withdrawal fee, monthly count, two-person threshold. All values set by
  the organisation. Approval off = no withdrawal needs a human (checks still
  run); payouts, refunds, buy-ins, settlements, and transfer-funded reversals
  always need maker + checker.
- Every notice passes automatic policy checks. Below the instant limit:
  same-day, no human approval. Up to the two-person threshold: notice period,
  no human approval. Above it: maker + checker before the due date;
  unapproved notices escalate 2 days before and never execute.
- Lifecycle: submitted -> approved -> scheduled (member can cancel) ->
  executing (09:00 WAT, re-check balance, payout name, float; one transfer
  with the withdrawal ID as idempotency key) -> completed or failed (back to
  scheduled, retry next morning, max 3).
- Float short: hold all of the day's withdrawals, alert treasurer, pay in
  due-date order once funded; never partial without consent.
- Payout accounts: name must match verified identity; 24-hour cooling with a
  phone alert. Daily caps per member and organisation; overs held for the
  treasurer.

### Rotation

- Draft order from join order, reorderable until start. Start takes
  `first_due_date` (today or later, default one period ahead); cycle n due
  `first_due_date + (n - 1) x frequency`; monthly days 29 to 31 fall back to
  month end. The formula only generates dates; stored `due_date` is truth.
- Payout: auto-created when a cycle is fully funded and approved like a
  withdrawal. Short cycle: officer chooses pay-and-top-up or wait (recorded).
  Transfer success sets `paid_out`; cash payouts are confirmed manually as a
  cash Transfer with the amount.
- Completes when every slot is `paid_out` or `skipped`; restart same or
  reshuffled.
- Pause: rotation `paused` + RotationPause; no reminders or due dates; on
  resume not-yet-due cycles shift by the pause length. `Group.status`
  `paused` is for thrift groups only.
- Close after completion any time. Dissolve mid-rotation: future cycles
  cancelled, rotation `dissolved`, settlement (paid in - sum of payout
  transfers) paid by approved transfers, ledger read-only.
- Leaver refunds, buy-ins, and settlements go through approval and the
  transfer engine but not withdrawal policy (notice, lock-in, monthly count).

### Early-payout risk controls (optional policies, off by default)

- Early slot = position in the first half of the rotation.
- **History ordering:** draft order suggested by on-time share of past cycles
  in the organisation (ties by join order; no history last); officer can
  reorder.
- **Guarantor:** an early slot can't be paid out until a guarantor is
  recorded: another active member of the organisation not in an early slot
  of the same rotation. A named record only; no automatic collection.
- **Holdback:** a percentage of an early payout stays in the organisation's
  account; released by transfer when the member has no remaining owed cycles;
  if they leave or the rotation dissolves first, applied to their arrears and
  the rest refunded through the leaver flow.

### Inactive members

- Already paid out: still owes remaining cycles, flagged. Not paid out: owes
  nothing further, refunded by transfer through the leaver flow, slot becomes
  a flagged `gap`.
- Gap resolution (AuditLog + `resolution`): **skip** (cycle cancelled; later
  cycles move one period earlier only if skipped before its due date);
  **reassign** (suggested buy-in = leaver's net contributions this rotation,
  editable; paid to the replacement's account number; leaver refunded once it
  lands); **hold** (payout and refund wait).
- Return: held slot -> reactivate, back to `scheduled`, missed cycles become
  arrears; paid out -> clear flag; skipped or reassigned -> next rotation.

### Thrift cycles

`start_date` is the first due date; current and next cycle always exist; the
rollover job creates the one after next; pause stops new cycles; frequency
changes apply to newly created cycles.

### Reminders

- Offsets: 2 days before, due-date morning, 1 day after if unpaid or partial
  (partial states the amount owed and the account number). Alternatives: due
  date only, or add 5 days before. Sent 08:00 to 19:00 WAT.
- Skip paid members, credit-covered cycles, paused rotations.
- WhatsApp first; SMS immediately on hard failure, after 2 hours if not
  delivered (Termii delivery reports); after 19:00 defer to 08:00.

### Reversals

Negative Contribution with `reverses_id` and required `reason`; officers
within their groups; transfer-funded rows need a checker; re-allocation within
7 days; all members see "corrected" pairs.

## Data model

PostgreSQL via Prisma. Amounts are integer kobo; phones E.164; `?` =
nullable. Tenant tables carry `organisation_id` under RLS. Money tables are
append-only.

**Platform (not tenant-scoped)**

- **User** - `id`, `name`, `phone_number` (unique), `created_at`
- **OtpChallenge** - `id`, `phone_number`, `code_hash`, `expires_at`,
  `attempts`, `consumed_at?`
- **Session** - `id`, `user_id`, `token_hash`, `expires_at`, `revoked_at?`
- **AuthEvent** - `id`, `user_id?`, `phone_number`, `event` (enum), `ip`,
  `created_at`
- **PhoneAccess** - `phone_number` (PK), `pin_hash`, `failed_attempts`,
  `locked_until?`, `created_at`, `updated_at`

**Organisation**

- **Organisation** - `id`, `name`, `type` (enum), `contact_email`,
  `contact_phone`, `money_mode` (bank | gateway | ledger), `provider`,
  `kyb_status`, `onboarding_step`, `branding` (json), `policy` (json:
  `default_frequency`, `withdrawals_enabled`, `withdrawal_approval_required`,
  notice, limits, fees, `session_ttl_days`), `created_at`
- **KybDocument** - `id`, `organisation_id`, `kind` (enum), `file_key`,
  `file_name`, `content_type`, `size_bytes`, `uploaded_by`, `created_at`
- **Branch** - `id`, `organisation_id`, `name`, `manager_user_id?`
- **OrgMembership** - `id`, `organisation_id`, `user_id`, `role` (enum),
  `branch_id?`, `status`
- **ProviderCredential** - `id`, `organisation_id`, `provider`,
  `encrypted_keys`, `webhook_secret_ref`
- **VirtualAccount** - `id`, `organisation_id`, `owner_type` (organisation |
  member), `owner_id`, `provider`, `bank_name`, `account_number` (unique),
  `account_name`, `status` (pending | active | blocked), `provider_ref`
- **MemberIdentity** - `id`, `organisation_id`, `phone_number`, `id_type`
  (bvn | nin), `id_hash`, `verified_name`, `verified_at`, `consent_at`
- **PayoutAccount** - `id`, `organisation_id`, `phone_number`, `bank_code`,
  `account_number`, `resolved_name`, `usable_from`, `status`

**Groups**

- **Group** - `id`, `organisation_id`, `branch_id?`, `name`, `type`
  (rotating | fixed), `contribution_amount`, `frequency`, `start_date?`,
  `status` (active | paused | closed), `reminder_offsets` (int[]),
  `withdrawal_policy?` (json), `created_by`, `created_at`
- **Member** - `id`, `organisation_id`, `group_id`, `name`, `phone_number`,
  `join_order`, `status`, `inactive_from?`
- **Invite** - `id`, `organisation_id`, `group_id`, `member_id`,
  `token_hash`, `expires_at`, `accepted_at?`, `revoked_at?`
- **Rotation** - `id`, `organisation_id`, `group_id`, `rotation_number`,
  `status` (draft | active | paused | completed | dissolved),
  `first_due_date?`, `started_at?`, `completed_at?`
- **RotationPause** - `id`, `organisation_id`, `rotation_id`, `paused_at`,
  `resumed_at?`, `paused_by`
- **RotationSlot** - `id`, `organisation_id`, `rotation_id`, `member_id`,
  `position`, `status` (scheduled | paid_out | gap | held | skipped),
  `paid_out_at?`, `flagged_at?`, `resolution?`, `resolved_by?`,
  `resolved_at?`, `guarantor_member_id?`, `holdback_amount` (default 0),
  `holdback_released_at?`
- **Cycle** - `id`, `organisation_id`, `group_id`, `rotation_id?`,
  `cycle_number`, `due_date`, `amount_due`, `payout_slot_id?`,
  `cancelled_at?`

**Money**

- **Payment** - `id`, `organisation_id`, `virtual_account_id?`,
  `member_id?`, `channel` (transfer | cash), `amount`, `provider_ref`
  (unique), `sender_name?`, `narration?`, `received_at`, `logged_by?`,
  `match_status`
- **Contribution** - `id`, `organisation_id`, `cycle_id`, `member_id`,
  `amount` (negative for reversals), `paid_at`, `logged_by`, `payment_id` ->
  Payment, `reverses_id?`, `reason?`
- **MemberCredit** - `id`, `organisation_id`, `member_id`, `amount` (+/-),
  `source_payment_id?`, `applied_to_cycle_id?`, `created_at`
- **WithdrawalNotice** - `id`, `organisation_id`, `member_id`, `group_id`,
  `amount`, `full_exit`, `payout_account_id`, `due_date`, `status` (enum),
  `fee`, `created_by`
- **Approval** - `id`, `organisation_id`, `subject_type` (withdrawal | payout
  | reversal), `subject_id`, `stage` (maker | checker), `user_id`,
  `decision`, `reason`, `created_at`
- **Transfer** - `id`, `organisation_id`, `subject_type`, `subject_id`,
  `channel` (transfer | cash), `amount`, `idempotency_key`, `provider_ref?`,
  `status` (pending | success | failed | reversed), `attempts`
- **CashRemittance** - `id`, `organisation_id`, `officer_user_id`, `amount`,
  `payment_id`, `created_at`
- **ReconciliationException** - `id`, `organisation_id`, `date`, `kind`,
  `provider_ref?`, `detail`, `resolved_by?`
- **ReminderLog** - `id`, `organisation_id`, `cycle_id`, `member_id`,
  `channel`, `offset`, `sent_at`, `status`, `provider_message_id?`; unique
  (`cycle_id`, `member_id`, `offset`, `channel`)
- **AuditLog** - `id`, `organisation_id`, `group_id?`, `actor_id`, `action`,
  `before`, `after`, `created_at`

> Locked shapes: `Organisation`, `Group`, `Member`, `Cycle`, `Payment`,
> `Contribution`, `Transfer` feed every later money feature. Change them only
> with a migration and a check of every later feature.

## Tech stack

- **Node.js + Express + TypeScript** - the API and webhook ingress
- **Neon PostgreSQL + Prisma 7** (`@prisma/adapter-pg`) - app on the pooled
  URL, migrations on the direct URL; RLS via a per-request transaction that
  sets the organisation transaction-locally; the app role must not bypass RLS
- **zod, libphonenumber-js, cors, express-rate-limit** - validation, E.164
  phones, frontend origin, per-IP limits; hashing via built-in `crypto`;
  `axios` for every outbound API call
- **PaymentProvider interface** - Paystack first, Flutterwave later, then
  per-bank adapters
- **Termii behind `Notifier`** - WhatsApp and SMS, delivery reports
- **BullMQ on Redis** - idempotent jobs and repeatable schedules (replaces
  `node-cron`)
- **AES-256-GCM** - per-organisation secrets under an env master key
- **pdf-lib** - statements
- **Object storage** - KYB uploads; provider not chosen (feature 16)
- **Frontend (separate repo)** - Next.js PWA, TanStack Query

## Monetization

Not in this build; the pilot is free. Feature 36 decides the model.

## UI/UX

No UI here. The API must serve member views (account number, balance,
arrears, payout date, ledger, withdrawals), the officer exceptions list, the
admin dashboard, the treasurer approval digest, and the client's four-step
onboarding design.

> TODO: no routes are named in the plans. Each feature spec defines its
> endpoints.

## Deployment

- **Render:** web service (API + webhooks), background worker (BullMQ), Key
  Value (Redis). **Neon** for PostgreSQL.
- **Migrations:** `prisma migrate deploy` before start
- **Env vars:** `DATABASE_URL` (pooled), `DIRECT_URL` (direct), Redis URL,
  Termii credentials, master key, session/OTP secret. Gateway keys live
  encrypted in the database, never in env.
- **Build:** `npm ci && npm run db:generate && npm run build`
- **Start (web):** `npm run db:deploy && npm run start`; health check `/health`

> TODO: the worker's start command, once feature 12 adds the BullMQ worker.

## Open questions

> Resolve in the plans, then re-run `/overview`.

- **Needs outside input:** legal opinion on gateway mode, gateway fees and
  transfer limits, Termii WhatsApp quote and template submission,
  design-partner MFB. None blocks Phase 1.
- **KYB object storage provider** - decide in the feature 16 spec.

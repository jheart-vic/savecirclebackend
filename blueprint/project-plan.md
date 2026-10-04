# Project Plan

> Source: `SaveCircle - Product Documentation v4` (1 October 2026), which builds
> on the v3 MVP documentation. Every v3 rule that v4 does not change still
> stands and is kept below. Answers to all open questions are recorded in
> section 10. This repo is the backend API only; the Next.js PWA frontend lives
> elsewhere.

## 1. Problem - What problem are we solving?

Ajo, esusu, and cooperative thrift groups run on paper registers and WhatsApp
messages: no shared record of who paid or whose turn it is, disputes with no
trail, one treasurer carrying everything. Banks and microfinance banks (MFBs)
that offer daily or weekly contribution savings have the same problem at
scale, plus their own:

- **Cash collection is expensive and leaky.** Field officers collect cash in
  markets; agents collecting and not remitting is a known loss; every naira is
  reconciled by hand at the branch.
- **Reconciliation is manual.** Transfers land in a pooled account with a
  narration like "ajo mama T" and are matched in a spreadsheet days later.
- **Withdrawals are slow and opaque.** Branch queues; notice periods enforced
  on paper or not at all.
- **Savings history is invisible to lending.** Good savers still can't borrow.
- **Groups are hard to bank.** Ajo groups and cooperatives move large sums
  outside formal accounts.

**Solution:** SaveCircle is software an organisation runs its contribution
products on. Each member pays into their own dedicated account number. The
payment is matched to the member and cycle automatically, everyone sees the
same ledger, and payouts and withdrawals go out by transfer on schedule with
approvals.

**SaveCircle never holds money.** Funds sit in the organisation's own bank or
gateway account. SaveCircle sends instructions and keeps the record. Informal
groups keep a free ledger-only tier that works like v3.

## 2. Users - Who is this for?

| User | What they need |
|---|---|
| MFB / bank (organisation) | Lower collection cost, real-time reconciliation, deposit growth, savings data for lending, audit trail |
| Cooperative society | Member contributions, notice-based withdrawals, transparent records for the AGM |
| Branch manager / field officer | See their groups, chase arrears, log cash where it is still used |
| Group treasurer | Know who paid without chasing; payouts that go out on time |
| Member | Pay by transfer from any bank app, see their balance, request a withdrawal from their phone |

### Roles

| Role | Scope | Can |
|---|---|---|
| Owner | Organisation | Everything, including money settings, gateway keys, deleting the organisation |
| Admin | Organisation | Full access to features and settings: branches, staff, groups, policies; approve withdrawals above the officer limit |
| Treasurer | Organisation | Manages contributions, payouts, and reports; second approval (checker) on payouts and withdrawals |
| Branch manager | Branch | Oversees branch operations and groups; first approval on withdrawals |
| Field officer | Assigned groups | Handles group activities and member support: add members, log cash, raise reversals, initiate payouts (maker) |
| Member | Own records | Pay, view, request withdrawals and payouts to a verified account |

These are the roles from the client's onboarding design ("Add Your Team"),
plus Owner for the organisation's creator.

No one approves their own request: maker and checker are always different
people. One person can belong to several organisations with different roles
and switches between them after sign-in.

### Organisation admin flow

1. Signs up with phone + OTP and creates the organisation.
2. Completes KYB and connects rails; receives the organisation's collection
   account number on approval.
3. Sets policies, adds branches if needed, invites staff with roles.
4. Watches a dashboard: collections today, arrears, cash in hand per officer,
   unmatched payments, withdrawals due this week, reconciliation exceptions.
5. Exports statements and reports at any time.

### Field officer flow

1. Creates a group (rotating or thrift), sets amount and frequency, adds
   members by name and phone (or bulk CSV upload).
2. Members get an invite; those who verify get account numbers automatically.
   For members without a smartphone, the officer captures BVN/NIN on a field
   visit with consent.
3. Confirms the rotation order and first due date.
4. Works day to day from an exceptions list: unpaid members, unmatched
   payments, cash to bank, notices awaiting approval.
5. Initiates payouts and withdrawals on members' behalf; approvals go to a
   branch manager, admin, or treasurer.

### Member flow

1. Gets an invite link by WhatsApp/SMS and sets a PIN (one PIN per phone).
2. Verifies BVN or NIN once; receives a personal account number by message.
3. Pays by transfer from any bank app, or cash to the officer. Gets a receipt
   within a minute either way.
4. Sees balance, arrears, payout date, and the shared group ledger.
5. Adds a payout account (name-checked, 24-hour cooling period).
6. Requests a withdrawal: picks the amount, sees the arrival date, confirms
   with PIN + OTP. Gets updates when it is approved and when it lands.

Viewing needs the PIN. Withdrawals, payout-account changes, and cancellations
also need a fresh OTP. Members who never open the link still get reminders.

### Treasurer flow

1. Gets a daily digest of withdrawals and payouts awaiting second approval,
   with each member's history beside the request.
2. Approves or rejects with a reason.
3. Clears reconciliation exceptions and float shortfalls.

## 3. Features - What does the product need?

| # | Feature | Priority |
|---|---|---|
| 1 | Organisations, roles, row-level isolation | Must |
| 2 | Organisation onboarding with KYB and resumable steps | Must |
| 3 | Gateway-hosted mode with one gateway | Must |
| 4 | Member BVN/NIN verification and automatic account numbers | Must |
| 5 | Webhook ingress, auto-allocation, receipts, member credit | Must |
| 6 | Unmatched queue and cash-in-hand tracking | Must |
| 7 | Withdrawal notices with policy, maker-checker, and scheduled transfers | Must |
| 8 | Automatic rotating payouts | Must |
| 9 | Nightly reconciliation | Must |
| 10 | v3 core: groups, rotation, ledger, arrears, reminders, inactive members, thrift groups | Must |
| 11 | Second gateway adapter | Should |
| 12 | Branches and org dashboard | Should |
| 13 | Bank-hosted adapter for a design-partner MFB | Should (after pilot) |
| 14 | White-label branding and sender ID | Should |
| 15 | Savings-history export for loan underwriting | Could |

v4 marks the v3 core as "built". Nothing is built yet in this repo, so the v3
core is built directly on the v4 tenancy model (every table carries
`organisation_id` from the first migration). No v3-to-v4 migration is needed.

**Out of scope:** SaveCircle holding funds, loans and interest, cards, and any
pooled account in SaveCircle's name.

## 4. Money model, identity, and tenancy rules

### Money modes (chosen per organisation)

| Mode | For | Where funds sit | Account numbers from |
|---|---|---|---|
| Bank-hosted | MFBs and banks | The bank's own books | The bank's core banking API, through a per-bank adapter |
| Gateway-hosted | Cooperatives and registered businesses | The organisation's own Paystack or Flutterwave balance, settling to its bank | Dedicated virtual accounts under the organisation's gateway business |
| Ledger-only | Informal groups (free tier) | Off-app, as in v3 | None; manual logging |

SaveCircle is a technology provider, not a financial institution. Pooling
savings in its own gateway balance would be deposit-taking and need a CBN
licence, so each organisation brings its own licensed rails ("bring your own
keys"). Gateway keys are stored encrypted and scoped to the organisation.
Gateway collection fees are paid by the organisation.

### Identity

- **Organisation (KYB):** document uploads, per the client's design:
  Certificate of Incorporation, Memorandum and Articles of Association,
  directors' identification (NIN or passport, for all directors), Tax
  Identification Number (TIN) document, business premises evidence (utility
  bill or letter of address), and optional additional documents. PDF, JPG, or
  PNG, at most 5 MB each.
- **Member (KYC):** BVN or NIN, collected with consent, is required for a
  permanent account number. Members without BVN or NIN stay in the system and
  pay cash to an officer, as in v3, until they verify.
- **Payout accounts** are verified by name enquiry before first use; the name
  must match the member's verified identity.
- Identity numbers are stored hashed with consent records (Nigeria Data
  Protection Act).

### Tenancy and isolation

- Hierarchy: Organisation -> Branch (optional) -> Group -> Member. Every
  tenant record belongs to exactly one organisation.
- Every tenant table carries `organisation_id`, enforced by PostgreSQL
  row-level security set from the session, not only by application code.
- Gateway keys, webhook secrets, and bank adapter credentials are encrypted
  per organisation.
- Webhooks are routed to an organisation by account number (or by transfer
  reference for outbound events), then the signature is checked with that
  organisation's secret.
- Exports, search, and reports run inside one organisation. A cross-
  organisation view exists only for SaveCircle support staff, with every
  access written to a platform audit log.
- Platform-level tables (not tenant-scoped): `User`, `OtpChallenge`,
  `Session`, `AuthEvent`, `PhoneAccess`, platform audit log.

### Organisation onboarding

The client's design has four steps after sign-up or sign-in (phone + OTP):
Organisation, KYB Verification, Payment Rails, Setup & Complete.

1. **Organisation:** name, type, contact email, and contact phone, all
   required and stored on the organisation (not used for sign-in). SaveCircle
   suggests a money mode from the type (MFB or bank -> bank-hosted;
   cooperative or business -> gateway-hosted; informal -> ledger-only).
2. **KYB Verification:** uploads the KYB documents ("Verification in
   progress").
3. **Payment Rails:** picks Paystack, Flutterwave, or Bank API, then enters
   that provider's keys (a bank enters core-banking credentials with
   SaveCircle's integration team). There is no redirect to the provider.
   Only Paystack works at first; Flutterwave and Bank API show as coming soon
   until their adapters ship. SaveCircle registers the webhook and checks
   that API-initiated transfers are allowed before enabling automatic
   withdrawals. On success it issues the organisation's collection account
   and shows bank, number, and name with copy and share buttons.
4. **Setup & Complete:** organisation policies (default contribution
   frequency for new groups, withdrawal notice period, allow member
   withdrawals, require approval for withdrawals), add the team (Admin,
   Treasurer, Branch manager, Field officer), and create the first group.

Every step has "Save and continue later"; the flow is resumable. Until the
collection account is issued, the organisation works in ledger-only mode.

### Member account numbers

- One account number per member per organisation, not per group.
- Issued automatically when the member verifies BVN or NIN, at invite
  acceptance or by an officer on a field visit.
- Account name is the organisation's name plus the member's name.
- Issuance is asynchronous: the member sees "Setting up your account number"
  and gets the number by SMS/WhatsApp when ready.
- Failures retry with back-off; after 3 failures the officer sees the reason
  (for example, BVN name mismatch) and a fix-and-retry button.
- Inactive or removed members keep their number blocked, not deleted, so a
  late transfer still identifies the sender.
- The organisation collection account takes payments that can't be tied to a
  member; they go to the Unmatched queue.

### Treasurer and staff auth (from v3)

- OTP: 6 digits, stored hashed, valid 10 minutes, 5 attempts, max 3 requests
  per phone per hour.
- Sessions are revocable. Default lifetime 30 days; each organisation's
  admin can change it for sessions acting in that organisation.
- Every OTP request, failure, sign-in, sign-out, and revocation writes an
  `AuthEvent` row.

### Member access (from v3, extended)

- One PIN per phone (`PhoneAccess`, 4 to 6 digits, hashed) across every group
  and organisation it belongs to.
- Accepting an invite on a phone with no PIN sets one; on a phone with a PIN,
  the member enters it to link the new group.
- Lookup lists only groups where an invite for that phone was accepted. One
  linked group opens directly; several show a picker.
- No staff-set PIN. Reset is by re-invite only.
- 5 failed attempts lock that phone for 30 minutes; all attempts are
  rate-limited by IP and phone.
- Invites are single-purpose, expire in 7 days, and are revocable.
- Money actions (withdrawal, payout-account change, cancellation) need PIN
  plus a fresh OTP.

## 5. Collections and reconciliation rules

### Inbound transfer flow

1. Member transfers from any bank app to their account number.
2. The provider sends a webhook. SaveCircle checks the signature with the
   organisation's secret and drops duplicates by provider reference.
3. SaveCircle re-verifies the transaction with the provider's API.
4. A `Payment` row is created (channel transfer, amount, provider reference,
   sender name).
5. The allocation engine splits it into Contribution rows sharing the
   `payment_id`.
6. The member gets a receipt by WhatsApp/SMS showing what each part paid and
   what is still owed. Pending reminders for those cycles are cancelled.

Target: matched, split, and receipted within a minute, with no officer action.

### Allocation

The v3 split rule, extended across all the member's groups in the
organisation:

1. Oldest past-due shortfall first, across all groups.
2. Then current and future existing cycles in due-date order; ties go to the
   member's preferred group, then the oldest group.
3. Thrift groups take any amount as a deposit to the member's savings balance.
4. Anything left becomes a **member credit** (a bank transfer can't be
   rejected). Credit is applied automatically to the next cycle that falls
   due, or refunded to the member's verified account on request.

Nothing carries into a rotation that hasn't started. Officers can re-allocate a
payment within 7 days by reversal with a reason; the money itself never moves.

### Unmatched payments

Transfers to the organisation account, or to a blocked member account, land in
an Unmatched queue with sender name and narration. An officer assigns each one
to a member (AuditLog) or marks it for refund. Items older than 3 days
escalate to the branch manager (or to the organisation admins when the
organisation has no branches).

### Cash and officer control

- Officers log cash as in v3: channel `cash`, tagged with the officer.
- Each officer has a cash-in-hand balance: cash logged minus cash deposited.
  Depositing it to the organisation account clears it automatically.
- Cash in hand older than 48 hours is flagged to the branch manager (or
  admins without branches).
- Members get a receipt for cash too.

### Daily reconciliation

Each night a job compares the provider's settlement report with the ledger for
the day. Any mismatch (missed webhook, provider reversal) opens an exception
for the treasurer; nothing is fixed silently.

## 6. Payouts and withdrawals rules

### Withdrawal policy (per organisation, overridable per group)

Withdrawal notices apply only to thrift balances and member credit. Rotating
groups follow the rules in "Rotating groups and early-payout risk" below.

| Setting | Example default | Notes |
|---|---|---|
| Allow member withdrawals | On | Off = members cannot request withdrawals |
| Require approval for withdrawals | On | Off = no withdrawal needs human approval at any amount; policy checks still run. Withdrawals only: rotating payouts, refunds, buy-ins, settlements, and transfer-funded reversals always need maker and checker |
| Notice period | 3 days | 0 = same-day, for small amounts under the instant limit |
| Instant limit | 20,000 NGN | Below this, notice period and second approval are skipped |
| Lock-in | 90 days from first deposit | No withdrawals before it ends |
| Minimum balance | 0 NGN | Must stay unless the member is leaving |
| Early-withdrawal fee | Off | % or flat; only if the member asks to shorten notice |
| Withdrawals per month | 2 | Further requests wait for next month |
| Two-person approval above | 100,000 NGN | Maker + checker, never the same person |

All figures are placeholders for the organisation to set.

### Withdrawal notice lifecycle

1. **Submitted.** Member (or officer on their behalf) enters an amount or
   "full balance" and picks a verified payout account. The app shows the
   arrival date. Available balance = savings balance - pending withdrawals.
2. **Approved.** See the approval answer in section 10: auto-approved when
   policy checks pass and the amount is at or below the two-person threshold;
   above it, maker and checker approval before the due date (unless the
  organisation turned off "Require approval for withdrawals"). Unapproved
   notices escalate 2 days before the due date and never execute unapproved.
3. **Scheduled.** The member can cancel until execution starts. A full-balance
   notice also schedules the member's exit from the group.
4. **Executing.** On the due date at 09:00 WAT the job re-checks balance,
   payout-account name, and the organisation's float, then sends one transfer
   with the withdrawal ID as the idempotency key.
5. **Completed or failed.** On the success webhook, a negative withdrawal entry
   is posted and the member gets a receipt. On failure or reversal, the notice
   returns to Scheduled, the officer is told why, and it retries next morning
   (max 3).

If the organisation's balance can't cover the day's withdrawals, all are held,
finance is alerted, and they go out in due-date order once funded. Nothing is
paid partially without the member's consent.

### Rotating payouts

- When a cycle's payout date arrives and the cycle is fully funded, the payout
  to that slot's member is created automatically and goes through approval
  like a withdrawal.
- If the cycle is short, the officer chooses: pay what's collected now and top
  up automatically as arrears arrive, or wait until fully funded. The choice
  is recorded.
- On transfer success the slot becomes `paid_out` with `paid_out_at`. Manual
  confirmation remains only for cash payouts, and the officer enters the cash
  amount paid.
- Leaver refunds and dissolve settlements become real transfers instead of
  AuditLog notes. They go through the approval flow and the transfer engine,
  but not through withdrawal policy (notice period, lock-in, monthly count).

### Rotating groups and early-payout risk

In a rotating group the money belongs to the cycle, so contributions are
protected differently from thrift balances.

**Withdrawals in rotating groups**

- Once a contribution is allocated to a cycle, it belongs to that cycle's pot
  and cannot be withdrawn.
- Withdrawal notices apply only to thrift balances and member credit.
- A member leaving a rotating group goes through the leaver flow (buy-in
  replacement, or a refund after the hold is resolved), never a normal
  withdrawal. That protects the other participants.

**Default after payout**

In ajo, losses usually come from a member who collects early and then stops
contributing, not from early withdrawals. To reduce that risk:

- Order payout slots by each member's payment history.
- Require a guarantor for early slots.
- Hold back part of an early payout until that member's remaining
  contributions are paid.

How these work is recorded in section 10.

### Fraud controls

- A newly added or changed payout account can't receive money for 24 hours,
  and the member is alerted.
- Daily caps per member and per organisation; anything over is held for the
  treasurer.
- Every approval, hold, and override is written to the AuditLog with the
  person and reason.
- An instruction to move money is never edited, only cancelled or reversed,
  with the person and reason logged.

## 7. Group, ledger, and reminder rules (v3, updated by v4)

### Group types

- **Rotating (ROSCA-style ajo):** fixed contribution each cycle; one member
  collects the pool per cycle until everyone has collected.
- **Thrift (fixed):** shipped in v4 because withdrawals are now recorded.
  Thrift balance = deposits - completed withdrawals - fees.

### Thrift group cycles

- A thrift group has a `start_date`, set at creation; the first cycle is due
  on it.
- Rolling horizon: the current and next cycle always exist. When a cycle's due
  date passes, the rollover job creates the one after next, dated by
  frequency.
- No end date. The officer can pause the group (no new cycles) or close it.
- A frequency change applies from the next cycle the job creates.

### Arrears (single source of truth)

```text
Arrears for a member = sum, over the member's owed cycles that are past due,
  of max(0, Cycle.amount_due - net Contribution.amount for that member and cycle)
```

A cycle is **owed** by a member unless it is cancelled, or it is due after the
member's `inactive_from` and the member has not yet been paid out in that
rotation. Contributions come from transfers, cash, and member credit alike.

- Cycle status is derived: `paid` (net >= due), `partial` (0 < net < due),
  `missed` (net = 0 and past due).
- Changing the contribution amount affects future cycles only.
- Balances and arrears are always derived, never stored.

### Payout scheduling (rotating)

1. On creation, a draft Rotation is seeded from join order; it can be
   reordered until the first cycle starts.
2. Starting locks positions, asks for the first due date, and generates one
   Cycle per slot, dated by frequency.
3. The rotation completes when every slot is `paid_out` or `skipped`. A new
   Rotation can start in the same or reshuffled order; earlier rotations stay
   in the ledger.

**First due date.** Picked at start; today or later; defaults to one period
after the start. Cycle n is due on `first_due_date + (n - 1) x frequency`.
Monthly groups anchor on a day of the month; days 29 to 31 fall back to the
last day in shorter months. The formula is only used to generate dates; after
that the stored `due_date` is the truth (see section 10).

**Pause.** The rotation becomes `paused` and a `RotationPause` row opens. No
reminders go out and no cycle falls due. On resume, every cycle not yet due
moves forward by the pause length; past-due cycles and their arrears stay.

**Close.** After a completed rotation, the group can be closed any time.
Mid-rotation (dissolve): every future cycle gets `cancelled_at`, the rotation
becomes `dissolved`, and the app shows a per-member settlement summary (paid
in minus received as payout). The settlement becomes a batch of withdrawals
through the normal approval flow. The ledger is then read-only.

### Inactive members

Marking a member inactive sets `inactive_from` and writes an AuditLog entry.

| Situation | Obligations after `inactive_from` | Slot |
|---|---|---|
| Already paid out this rotation | Still owes every remaining cycle; arrears keep accruing and the member is flagged prominently | Unchanged (`paid_out`) |
| Not yet paid out | Owes nothing further; past arrears remain; past contributions are refunded by transfer through the leaver flow | Set to `gap` and flagged until resolved |

A gap is never resolved silently. The officer picks one option, recorded in
`RotationSlot.resolution` and the AuditLog:

| Resolution | Cycle | Due dates | Contributions |
|---|---|---|---|
| Skip | Slot's cycle gets `cancelled_at`; slot becomes `skipped` | Skipped before its due date: every later cycle moves one period earlier. On or after it: nothing moves, the period is left empty | Rows on the cancelled cycle stay; the officer reverses or re-applies them |
| Reassign | Slot's `member_id` changes to an existing or new member; old value kept in the AuditLog | Unchanged | New member owes cycles from the reassignment onward and pays a buy-in |
| Hold | Slot becomes `held`; cycle stays | Unchanged | Contributions still collected; payout and the leaver's refund wait until skip, reassign, or the member returns |

**Buy-in on reassign.** The app suggests the departing member's net
contributions in this rotation; the officer can edit it or set it to zero. The
replacement pays the buy-in to their own account number, and the leaver's
refund is released once it lands.

**Returning members.** Held slot: reactivate, clear `inactive_from`, slot back
to `scheduled`, AuditLog entry; cycles missed while away become arrears.
Already paid out: only the flag clears. Skipped or reassigned: the member
rejoins in the next rotation.

### Reminders

Default schedule per cycle, sent between 08:00 and 19:00 WAT:

- 2 days before the due date
- On the due date (morning)
- 1 day after, if unpaid or partial; partial reminders state the amount still
  owed and the account number to pay into

The organisation or group may switch to due-date-only or add a 5-day-before
nudge.

- **Skips:** members already paid for the cycle, members whose credit covers
  it, and paused rotations.
- **Channels:** WhatsApp first. On a hard failure (not on WhatsApp, invalid
  number) the SMS goes immediately; if sent but not delivered, after 2 hours.
  "Delivered" is enough. A fallback after 19:00 WAT goes at 08:00 next day.
- **Deduplication:** unique (`cycle_id`, `member_id`, `offset`, `channel`).

### Reversals and visibility

- Corrections are new negative Contribution rows with `reverses_id` and a
  required `reason`. Nothing is edited or deleted.
- All members see reversals as a linked "corrected" pair with reason, actor,
  and time.
- Officers reverse within their groups. Reversals of transfer-funded rows need
  a checker.

## 8. Data - What are we storing?

All phone numbers are E.164. Every tenant table has `organisation_id` under
row-level security. Money tables (`Payment`, `Contribution`, `MemberCredit`,
`Transfer`) are append-only.

### Platform (not tenant-scoped)

- **User:** id, name, phone_number (unique), created_at
- **OtpChallenge:** id, phone_number, code_hash, expires_at, attempts,
  consumed_at
- **Session:** id, user_id, token_hash, expires_at, revoked_at
- **AuthEvent:** id, user_id (nullable), phone_number, event
  (otp_requested/otp_failed/signed_in/signed_out/session_revoked), ip,
  created_at
- **PhoneAccess:** phone_number (PK), pin_hash, failed_attempts, locked_until,
  created_at, updated_at

### Organisation

- **Organisation:** id, name, type (mfb/bank/cooperative/business/informal),
  contact_email, contact_phone, money_mode (bank/gateway/ledger), provider
  (paystack/flutterwave/bank_x), kyb_status, onboarding_step, branding,
  policy (json: default_frequency, withdrawals_enabled,
  withdrawal_approval_required, notice, limits, fees, session_ttl_days),
  created_at
- **KybDocument:** id, organisation_id, kind (certificate_of_incorporation/
  memart/director_id/tin/premises_evidence/additional), file_key, file_name,
  content_type, size_bytes, uploaded_by, created_at
- **Branch:** id, organisation_id, name, manager_user_id
- **OrgMembership:** id, organisation_id, user_id, role, branch_id
  (nullable), status
- **ProviderCredential:** id, organisation_id, provider, encrypted_keys,
  webhook_secret_ref
- **VirtualAccount:** id, organisation_id, owner_type (organisation/member),
  owner_id, provider, bank_name, account_number (unique), account_name,
  status (pending/active/blocked), provider_ref
- **MemberIdentity:** id, organisation_id, phone_number, id_type (bvn/nin),
  id_hash, verified_name, verified_at, consent_at
- **PayoutAccount:** id, organisation_id, phone_number, bank_code,
  account_number, resolved_name, usable_from (created_at + 24h), status

### Groups (from v3, with organisation_id)

- **Group:** + organisation_id, branch_id, withdrawal_policy override; type
  (rotating/fixed), contribution_amount, frequency, start_date, status
  (active/paused/closed), reminder_offsets, created_by, created_at
- **Member:** id, group_id, name, phone_number, join_order, status,
  inactive_from
- **Invite:** id, group_id, member_id, token_hash, expires_at, accepted_at,
  revoked_at
- **Rotation:** id, group_id, rotation_number, status
  (draft/active/paused/completed/dissolved), first_due_date, started_at,
  completed_at
- **RotationPause:** id, rotation_id, paused_at, resumed_at, paused_by
- **RotationSlot:** id, rotation_id, member_id, position, status
  (scheduled/paid_out/gap/held/skipped), paid_out_at, flagged_at, resolution,
  resolved_by, resolved_at, guarantor_member_id (nullable), holdback_amount
  (default 0), holdback_released_at (nullable)
- **Cycle:** id, group_id, rotation_id (nullable), cycle_number, due_date,
  amount_due, payout_slot_id (nullable), cancelled_at

### Money

- **Payment:** id, organisation_id, virtual_account_id (nullable), member_id
  (nullable), channel (transfer/cash), amount, provider_ref (unique),
  sender_name, narration, received_at, logged_by (cash only), match_status
- **Contribution:** + organisation_id; id, cycle_id, member_id, amount,
  paid_at, logged_by, payment_id (references Payment), reverses_id, reason
- **MemberCredit:** id, organisation_id, member_id, amount (+/-),
  source_payment_id, applied_to_cycle_id, created_at
- **WithdrawalNotice:** id, organisation_id, member_id, group_id, amount,
  full_exit, payout_account_id, due_date, status (submitted/approved/
  scheduled/executing/completed/failed/cancelled/held), fee, created_by
- **Approval:** id, organisation_id, subject_type (withdrawal/payout/
  reversal), subject_id, stage (maker/checker), user_id, decision, reason,
  created_at
- **Transfer:** id, organisation_id, subject_type, subject_id, channel
  (transfer/cash), amount, idempotency_key, provider_ref, status
  (pending/success/failed/reversed), attempts
- **CashRemittance:** id, organisation_id, officer_user_id, amount,
  payment_id, created_at
- **ReconciliationException:** id, organisation_id, date, kind, provider_ref,
  detail, resolved_by
- **ReminderLog:** + organisation_id; id, cycle_id, member_id, channel,
  offset, sent_at, status, provider_message_id; unique (cycle_id, member_id,
  offset, channel)
- **AuditLog:** + organisation_id; group_id now nullable for org-level
  actions; actor_id, action, before, after, created_at

## 9. Tech - What stack are we using?

This repo:

- **Backend:** Node.js + Express, TypeScript
- **Database:** Neon PostgreSQL with row-level security, accessed through
  Prisma 7 with the `@prisma/adapter-pg` driver adapter. The app uses Neon's
  pooled connection; migrations use the direct connection. Each request runs
  its queries in a transaction that sets the current organisation for RLS
  (transaction-local, because Neon's pooler is in transaction mode). The
  app's database role must not bypass RLS.
- **Libraries:** `zod` for validation, `libphonenumber-js` for E.164 phone
  normalization, `cors` for the frontend origin, `express-rate-limit` for
  per-IP limits, `bullmq` with `ioredis` for jobs. Hashing uses Node's
  built-in `crypto`; `axios` makes every outbound API call (Paystack,
  Termii, and later providers).
- **Payments:** a `PaymentProvider` interface (`createCustomer`,
  `verifyIdentity`, `issueAccount`, `verifyTransaction`,
  `resolveAccountName`, `transfer`, `fetchSettlement`). First adapter:
  Paystack. Later: Flutterwave, then one adapter per partner bank.
- **Notifications:** Termii for WhatsApp and SMS, behind a `Notifier`
  interface.
- **Jobs:** BullMQ on Redis for account issuance, allocation, transfers,
  retries, and scheduled jobs (reminders, fallback, rollover, withdrawals,
  reconciliation) as repeatable jobs. Every job is idempotent.
- **Webhook ingress:** receives provider events, routes them to the
  organisation, verifies the signature, stores the raw event, enqueues.
- **Secrets:** per-organisation gateway keys and webhook secrets encrypted with
  AES-256-GCM using a master key from the environment.
- **Statement export:** `pdf-lib`
- **KYB file storage:** object storage for uploaded documents. Provider not
  chosen yet (decide in the onboarding feature spec).

Separate frontend (not in this repo): Next.js, TypeScript, Tailwind, TanStack
Query, PWA-first.

## 10. Decisions and answers to open questions

### v4 open questions

- **Which gateway first?** Paystack, unless the pilot cooperative already runs
  on Flutterwave, in which case use that. Paystack's dedicated virtual
  accounts are documented and listed at 1% capped at 300 NGN per transaction.
  Confirm current fees and transfer limits for both in Phase 0 before quoting.
- **Is withdrawal approval required for every amount?** No. Every notice
  passes automatic policy checks (balance, lock-in, minimum balance, monthly
  count, cooling period, caps). Below the instant limit it is same-day with no
  human approval. From the instant limit up to the two-person threshold it
  needs the notice period but no human approval. Above the two-person
  threshold it needs maker and checker. If the organisation turns off
  "Require approval for withdrawals", no withdrawal needs human approval;
  the automatic policy checks still apply.
- **Should member credit expire into a refund?** No. Sending money nobody
  asked for to a payout account adds risk, and the member may not have a
  verified payout account. Credit stays and auto-applies to the next due
  cycle. It is refunded on request, and automatically as part of a
  full-balance exit. Credit unused for 90 days is shown on the officer's
  exceptions list.
- **Pricing?** Not decided and not in this build. The pilot is free;
  monetization stays a later feature (per the earlier decision). Gateway fees
  are paid by the organisation either way.
- **Which MFB is the design partner?** A business decision only the founders
  can make. It does not block anything until after the pilot, because the
  bank-hosted adapter is built after it.
- **Legal opinion on gateway-hosted mode.** Needs a lawyer; it can't be
  answered here. Build and test gateway mode in test mode during Phase 0;
  don't take live money in gateway mode until the written opinion arrives. If
  it says gateway mode needs a licence, fall back to bank-hosted mode through
  a licensed MFB partner.

### Early-payout risk controls (v4 section 6.5)

v4 lists the three controls but not how they work. Decisions:

- **Early slot:** a slot in the first half of the rotation (position at or
  below half the slot count, rounded down).
- **Settings:** each control is an organisation policy, overridable per
  group, and off by default so a small cooperative isn't forced into them.
- **Order by payment history:** when a draft rotation is created, the app
  suggests an order with the most reliable payers first (share of past cycles
  in this organisation paid on time, ties by join order). Members with no
  history go last. The officer can still reorder before start.
- **Guarantor:** when required, an early slot can't be paid out until a
  guarantor is recorded: another active member of the same organisation who
  is not themselves in an early slot of the same rotation. The guarantor is a
  named record for the organisation to act on; the app does not collect from
  the guarantor automatically.
- **Holdback:** a percentage of an early payout is kept back in the
  organisation's account. It is released by transfer once the member has no
  remaining owed cycles in the rotation. If the member leaves or the rotation
  is dissolved first, the holdback is applied to their arrears, and anything
  left is refunded through the leaver flow.

### Earlier questions (from the v3 review)

- **How much did each person collect?** Every payout is a `Transfer` row,
  including cash payouts (channel `cash`, amount entered by the officer).
  "Received as payout" in a settlement is the sum of that member's successful
  payout transfers.
- **Pattern date or saved date?** The stored `Cycle.due_date` is always the
  truth. The first-due-date formula is only used to generate dates; pauses
  and skips move stored dates and nothing recalculates from the formula.
- **How do we know WhatsApp wasn't delivered?** Termii delivery reports
  through the same webhook ingress used for payments; a WhatsApp reminder
  still not delivered after 2 hours triggers the SMS.
- **Where does "paused" live?** Rotating groups pause on the `Rotation`.
  `Group.status` `paused` is for thrift groups (no new cycles). `closed`
  applies to both.

### Decisions forced by v4

- **Scheduler:** BullMQ repeatable jobs replace `node-cron`. v4 already needs
  Redis and BullMQ, and `node-cron` would fire on every running instance and
  double-send.
- **Secrets store:** Render has no managed KMS, so per-organisation secrets
  are encrypted in the app with a master key held in a Render environment
  variable. Move to a cloud KMS if a bank partner requires it.
- **Members across organisations:** a member's PIN session can see groups in
  several organisations. The member picks a group, and the request sets that
  group's organisation for RLS, as staff requests do.
- **No branches:** escalations that go to a branch manager go to the
  organisation's admins instead.

### Still open (needs outside input)

- Termii quote for Nigerian WhatsApp utility templates, and whether Termii
  submits templates on SaveCircle's behalf.
- Paystack and Flutterwave current fees and transfer limits.
- The legal opinion and the design-partner MFB (above).

## 11. Monetize - How will this make money?

Not in this build; the pilot is free. Options for later: per active member per
month, per organisation, or a share of collection fees.

## 12. UI/UX - How should this look and feel?

This repo has no UI. The API serves a mobile-first PWA and must support:

- Members: account number with copy/share, balance, arrears, payout date,
  shared ledger with "corrected" pairs, withdrawal requests with arrival date
- Officers: an exceptions list (unpaid members, unmatched payments, cash to
  bank, notices awaiting approval)
- Admins: a dashboard (collections today, arrears, cash in hand, unmatched,
  withdrawals due, reconciliation exceptions)
- Treasurers: a daily approval digest with member history
- Organisation onboarding: the client's four-step design (see section 4)

## 13. Deployment - Where and how will this ship?

Host: Render for the app, Neon for the database.

- Render web service for the API (including webhook ingress)
- Render background worker running the BullMQ workers and repeatable jobs
- Render Key Value (Redis) for BullMQ
- Neon PostgreSQL (pick a region close to the Render region)
- `prisma migrate deploy` runs before the app starts on each deploy
- Env vars: `DATABASE_URL` (Neon pooled), `DIRECT_URL` (Neon direct, for
  migrations), Redis URL, Termii credentials, master encryption key,
  session/OTP secret. Gateway keys are per organisation in the database,
  encrypted, never in env vars.

- Build command: `npm ci && npm run db:generate && npm run build`
- Start command (web service): `npm run db:deploy && npm run start`
- Health check path: `/health`

> TODO: the worker's start command, once feature 12 adds the BullMQ worker.

## 14. Usage model and constraints (optional)

- **Pilot:** 8 weeks. One cooperative in gateway-hosted mode; one MFB as
  design partner for bank-hosted mode.
- **Operation:** internet-facing API; receives provider webhooks.
- **Tenancy:** multi-tenant by organisation with database-enforced isolation.
- **Regulatory:** no SaveCircle custody; legal opinion required before live
  gateway-mode money.
- **Data protection:** BVN, NIN, and account data under the Nigeria Data
  Protection Act; identity numbers hashed, consent recorded, a data
  protection lead appointed before the pilot.
- **Audit:** append-only money records; every approval, hold, override, and
  reversal logged with person and reason.

### Pilot success metrics

- Share of collections arriving by transfer instead of cash
- Time from payment to reconciled ledger entry (target under 1 minute)
- Officer hours on reconciliation and chasing, before vs after
- Age of cash in hand and amount never remitted
- Withdrawals paid on their due date; complaints per 100 withdrawals
- Cost to collect 1,000 NGN, before vs after
- v3 metrics: missed payments, disputes, paper records abandoned

### Risks

- **Licensing:** fall back to bank-hosted only if gateway mode needs a licence.
- **Verification friction:** members may resist sharing BVN/NIN; explain why,
  keep cash as a path, measure drop-off.
- **Organisation float:** automatic withdrawals fail if the balance is short;
  hold-and-alert prevents partial or silent failures.
- **Provider outages and lost webhooks:** covered by re-verification and
  nightly reconciliation.
- **Default after payout:** still the main ajo loss. Payment-history ordering,
  guarantors, and holdbacks reduce it; SaveCircle still cannot recover money
  from a member who stops paying.
- **Bank integrations are slow:** bank mode follows the pilot.
- **WhatsApp approval lead time:** if Meta approval slips, reminders launch
  SMS-only.

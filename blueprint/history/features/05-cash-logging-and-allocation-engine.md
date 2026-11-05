# Feature: Cash logging and allocation engine

**From build-plan:** feature 5
**Build attempt:** 1
**Branch:** feature/cash-logging-and-allocation-engine
**Status:** verified

## Goal

An officer logs cash a member handed over as a `Payment`. The allocation
engine splits it across that person's groups in the organisation: cycle
shortfalls in due-date order (oldest past-due first), then any thrift deposit,
and turns whatever is left into member credit. Every split is an append-only
`Contribution` row linked to the payment.

## In scope

- `Payment`, `Contribution`, `MemberCredit` tenant tables under RLS, append-only
  (SELECT and INSERT policies only)
- `POST .../groups/:groupId/members/:memberId/cash` to log cash
- The allocation engine as a pure function plus the transaction that applies it
- Serialising allocations per person so two payments cannot fill the same
  shortfall twice

## Out of scope

- Transfers, webhooks, virtual accounts (17-19); unmatched queue (20)
- Receipts by SMS/WhatsApp and the handover code (21a); cash in hand (21a)
- Reversals and re-allocation (6); ledger, arrears, and status views (7)
- Applying existing member credit to later cycles, and refunds of credit
  (a later job; credit only accrues here)
- Thrift cycle creation (9): until then thrift groups have no cycles to take a
  deposit, so the thrift step does nothing
- A "preferred group" setting (no field exists yet; ties use the oldest group)

## Build loop

Autopilot run: build all steps without pausing, then one review packet.
`checkpointCommits` is `disabled`. Model - Service - Controller - Route
layering, money rules (integer kobo, append-only money tables, multi-row
writes in one transaction), and tenancy rules from `coding-standards.md`
apply. New code goes in `src/payments/`.

## Build steps

- [x] 1. **Money schema with append-only RLS.** Enums `PaymentChannel`
  (`transfer`, `cash`), `MatchStatus` (`matched`, `unmatched`); models
  `Payment`, `Contribution`, `MemberCredit` (see Data). Create with
  `--create-only`, add RLS with SELECT and INSERT policies only, apply.
  **Done when:** migration applies; RLS on all three tables; `pg_policies`
  shows only SELECT and INSERT for them; an UPDATE or DELETE attempted as
  `savecircle_app` inside the organisation's context changes no rows;
  migrate status in sync; typecheck passes.
- [x] 2. **Allocation engine (pure).** `src/payments/allocation.ts` exports
  `allocate(amount, cycles, thriftCycle)` returning contribution lines and
  the credit left over (see Data).
  **Done when:** a direct script shows: shortfalls filled in due-date order
  with ties by oldest group; partially paid cycles take only the remainder;
  fully paid cycles take nothing; the rest goes to the thrift cycle when one
  exists, else to credit; the parts always sum to the amount; an empty cycle
  list gives all credit; typecheck passes.
- [x] 3. **Log cash.** The endpoint, the service transaction (lock the
  person, load their cycles across the organisation, run the engine, insert
  the Payment, Contributions, and MemberCredit), validation, permissions.
  **Done when:** logging cash for a member with two started rotations in
  different groups fills the past-due cycle first, then the earlier due date,
  across both groups; an amount larger than all shortfalls ends as credit;
  a member with no started rotation gets all credit and no contributions;
  cycles of an unstarted (draft) rotation get nothing; parts sum to the
  amount; two parallel payments for the same person never fill one cycle
  beyond its amount due; an amount of 0, a fraction, or over the cap gives
  400; a treasurer gets 403; an unassigned field officer or another group's
  member gives 404; typecheck and build pass.

## Files / areas

- `prisma/schema.prisma`, `prisma/migrations/<ts>_payments/`
- `src/payments/` - `payments.routes.ts`, `.controller.ts`, `.service.ts`,
  `.model.ts`, `.validation.ts`, `allocation.ts`
- `src/organisations/organisations.routes.ts` (mount)
- `src/groups/groups.service.ts` (reuse `visibleGroup`, `assertManagesMembers`)

## Data / contracts

**Enums:** `PaymentChannel`: `transfer`, `cash`. `MatchStatus`: `matched`,
`unmatched` (cash is always `matched`).

**Models** (all with `organisation_id`; amounts are integer kobo)

- `Payment` (`payments`): `id`, `organisationId`, `virtualAccountId` uuid
  nullable (no FK until 17), `memberId` FK nullable (null only for unmatched
  transfers later), `channel`, `amount` int > 0, `providerRef` text nullable,
  unique (null for cash), `senderName` nullable, `narration` nullable (the
  officer's note for cash), `receivedAt` timestamptz, `loggedBy` uuid FK User
  nullable (set for cash), `matchStatus`, `createdAt`. Index
  (`organisationId`, `receivedAt`).
- `Contribution` (`contributions`): `id`, `organisationId`, `cycleId` FK,
  `memberId` FK (the member row in that cycle's group), `amount` int (negative
  only for reversals, feature 6), `paidAt` timestamptz (the payment's
  `receivedAt`), `loggedBy` uuid FK User nullable, `paymentId` FK, `reversesId`
  FK self nullable, `reason` text nullable, `createdAt`. Index (`cycleId`,
  `memberId`), index (`paymentId`).
- `MemberCredit` (`member_credits`): `id`, `organisationId`, `memberId` FK,
  `amount` int (+ accrues, - later spends), `sourcePaymentId` FK nullable,
  `appliedToCycleId` FK nullable, `createdAt`. Index (`memberId`).

**RLS:** each table ENABLE RLS with SELECT and INSERT on
`organisation_id = app_current_org()`; no UPDATE or DELETE policy, so money
rows are append-only at the database.

**Who is "the member":** a Member row belongs to one group; the same person in
several groups of an organisation shares one E.164 `phoneNumber`. Allocation
covers every Member row in the organisation with the payment member's phone.

**Candidate cycles:** every non-cancelled cycle of those members' groups that
belongs to a started rotation (rotation cycles only exist after start) or to a
thrift group, where the member is that group's member. Shortfall = `amountDue -
sum(contributions.amount)` for that member and cycle; only shortfalls > 0
count.

**Engine (`allocate`)**

1. Sort candidates by `dueDate`, then the group's `createdAt` (oldest group
   first), then `groupId`, then `cycleNumber`. Past-due shortfalls come first
   because they have the earliest dates.
2. Fill each shortfall in order until the amount runs out.
3. Any remainder goes to the thrift cycle when one is given: the member's
   oldest thrift group's latest cycle due on or before today (Lagos), else its
   earliest cycle. Thrift takes any amount.
4. Any remainder becomes credit.

Output: lines `{ cycleId, memberId, amount }` (amount > 0) and `credit` >= 0,
with `sum(lines) + credit = amount`. Pure: no I/O, deterministic.

**Transaction (log cash):** inside `withOrg`, `visibleGroup`,
`assertManagesMembers`, load the member (in this group; else 404
`member_not_found`), take `pg_advisory_xact_lock(hashtext('allocation:' ||
organisationId || ':' || phoneNumber))`, load candidates, run the engine,
insert the Payment, its Contributions, and the MemberCredit row (when credit
> 0), all in the same transaction.

**Validation:** `amount` integer 1 to 2 000 000 000 kobo; `note` optional,
trimmed, at most 200 characters.

**Permissions:** Owner, Admin, or a field officer assigned to the member's
group; Treasurer and Branch manager get 403; hidden group 404.

**Endpoint** (under `/organisations/:orgId`)

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/groups/:groupId/members/:memberId/cash` | `{ "amount": 500000, "note"? }` | 201 `{ "payment": { "id", "amount", "channel": "cash", "receivedAt" }, "allocations": [{ "cycleId", "groupId", "groupName", "cycleNumber", "dueDate", "amount" }], "credit": 0 }` |

Errors: `invalid_body`, `invalid_params` 400; `forbidden` 403;
`group_not_found`, `member_not_found` 404.

## Testing

No test runner. The engine is checked directly with a tsx script; the endpoint
with scratch scripts against Neon under the app role (Termii blank, Bash only),
reading contributions and credits back through the owner connection, and
cleanup in FK order (member_credits, contributions, payments, then feature 4's
order). Features 3 and 4 scripts are rerun as regression.

## Notes for the AI

- Decisions recorded (2026-11-05, Autopilot), reversible, open to change at
  review: officers who can add members can log cash (Treasurer and Branch
  manager cannot); the payment is attached to the member row in the group it
  was logged from, and credit goes to that row; ties go to the oldest group
  until a "preferred group" exists; existing credit is not spent here; cash
  `providerRef` is null; no client idempotency key yet (a double-logged
  payment is corrected by reversal, feature 6).
- Arrears, statuses, and balances stay derived (7); nothing here stores a
  balance.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":8887,"specSha256":"18ebb3e5935383e368d3b8607b90ae27cef1bae9dc65094b423ac27b225e46ad","branch":"refs/heads/feature/cash-logging-and-allocation-engine","head":"c4693229e23b89956bd2333392bcc4c96cb31d9e","baseRef":"refs/heads/main","baseCommit":"ecbdee2639e79871176e18914827dba705d7f1dd","sourceTree":"290c5e9b188531113bd4f47bcb9663c9dec07e1c","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** c4693229e23b89956bd2333392bcc4c96cb31d9e
**Base commit:** ecbdee2639e79871176e18914827dba705d7f1dd
**Base ref:** refs/heads/main
**Spec hash:** 18ebb3e5935383e368d3b8607b90ae27cef1bae9dc65094b423ac27b225e46ad
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-05T12:35:28Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-05T12:38:33Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `git rev-parse HEAD`, `git merge-base refs/heads/main HEAD`, `sha256sum blueprint/context/current-feature.md`, `git status --porcelain --untracked-files=all`: pass (HEAD, base, and spec hash match the request; only review.md modified)
- `npm run typecheck`: pass
- `npm run build`: pass
- `node <scratchpad>/engine.mjs` (pure engine against built dist/payments/allocation.js, no database): pass (ordering, ties, partial fills, thrift merge, credit, no input mutation, 20 000 randomized sum-invariant cases with 0 failures)
- Test runner: unavailable (none configured)
- Lint: unavailable (none configured)
- Verify command: unavailable (none configured)

## Evidence

- Reviewed the full ecbdee2..c469322 delta: payments migration and schema, src/payments/* (routes, controller, service, model, validation, allocation), organisations.routes.ts mount, plus callers src/tenancy.ts, src/groups/groups.service.ts, src/rotations/rotations.service.ts, and earlier RLS/grant migrations.
- RLS: all three money tables ENABLE RLS with SELECT and INSERT policies only on app_current_org(); app role is not owner, so UPDATE/DELETE grants affect zero rows.
- Tenancy: every read/write runs in withOrg's transaction; raw SQL uses tagged-template parameters (no string interpolation into SQL; the lock key string is a bound parameter) and also filters members by organisation_id.
- Candidate query: person = all org member rows with the phone; cancelled cycles excluded; rotation cycles only for non-draft rotations where the member has a slot; per-(cycle, member) shortfall. Only draft/active rotation statuses are reachable in current code.
- Concurrency: advisory xact lock on hashtext('allocation:' || org || ':' || phone) is taken before shortfalls are read; READ COMMITTED gives later statements a fresh snapshot; the transaction takes no other row locks before the lock, so no lock-order cycle with feature 4's group FOR UPDATE.
- Permissions: visibleGroup (404 hidden/unknown) then assertManagesMembers (403 treasurer/branch manager) then member-in-URL-group (404), matching the spec; params validated before body.
- Bounds: amount 1..2e9 fits int; lines and credit are each at most the amount; response groupName/cycleNumber/dueDate come from the queried rows.
- Spec Notes decisions (permissions, payment/credit on the URL member row, oldest-group ties, no credit spend, null providerRef, no idempotency key) are implemented as stated and consistent with the documented allocation rules.

## Findings

- F-19 [P3] open - shortfall int cast can overflow once thrift cycles take large deposits (latent until feature 9)
- F-20 [P3] open - ON DELETE SET NULL / ON UPDATE CASCADE on money-table FKs can rewrite append-only rows via referential actions
- F-21 [P3] open - payments.amount > 0 not enforced by a CHECK constraint

## Remaining risk

- No test runner, lint, or Verify command is configured; the engine has no committed unit tests.
- Endpoint behaviour, RLS append-only enforcement, and parallel-payment serialisation were not re-run against the database in this review (database access not permitted); relied on code reading.
- Future rotation statuses (paused, completed, dissolved) and closed/paused groups would still receive allocations under `status <> 'draft'`; decide when those transitions are built.
- Double-logged cash has no idempotency key by design; correction depends on reversals (feature 6), which must take the same per-person lock.

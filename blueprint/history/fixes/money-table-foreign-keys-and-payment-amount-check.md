# Fix: Money-table foreign keys and payment amount check

**Type:** Fix
**Status:** verified
**Branch:** fix/money-table-foreign-keys-and-payment-amount-check
**Fixes:** F-20, F-21

## The problem

The money tables (`payments`, `contributions`, `member_credits`) are
append-only for the app role: their RLS has only SELECT and INSERT policies.
Two gaps in the database contract remain, both from migration
`20261105112753_payments`:

- **F-20:** six foreign keys are `ON DELETE SET NULL` (`payments.member_id`,
  `payments.logged_by`, `contributions.logged_by`, `contributions.reverses_id`,
  `member_credits.source_payment_id`, `member_credits.applied_to_cycle_id`),
  and all thirteen money-table foreign keys are `ON UPDATE CASCADE`.
  Referential actions run regardless of RLS, so deleting or re-keying a
  referenced user, member, payment, or cycle (by the owner role, or a later
  feature that allows it) would silently rewrite money rows that are meant to
  never change.
- **F-21:** the spec says `payments.amount > 0`, but only request validation
  enforces it. Later writers (webhooks, unmatched queue, features 17-20) could
  insert a zero or negative payment.

Nothing reachable through the API triggers either today; this hardens the
database before reversals (6) and later money features build on these tables.

## The fix

1. In `prisma/schema.prisma`, set `onDelete: Restrict, onUpdate: Restrict` on
   every relation field of `Payment`, `Contribution`, and `MemberCredit` (all
   thirteen foreign keys). A referenced row can then not be deleted or have its
   id changed while a money row points at it.
2. Create a new migration with `npm run db:migrate -- --create-only --name
   money_fk_restrict` (the applied payments migration is not edited), check it
   only drops and re-adds those foreign keys, then add by hand:
   `ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK
   ("amount" > 0);`. Existing rows all have positive amounts (validation has
   always required 1 or more), so the constraint applies cleanly.
3. Apply with `npm run db:migrate`.

Must not break: cash logging (feature 5) and every earlier flow; no data
changes; RLS policies unchanged; `contributions.amount` and
`member_credits.amount` stay signed (reversals and credit spends are negative).

## Build steps

- [x] 1. **Restrict money foreign keys and check payment amounts.** Schema
  change, new migration with the hand-added CHECK, apply.
  **Done when:** the migration applies and `migrate status` is in sync;
  `pg_constraint` shows all thirteen money-table foreign keys with delete and
  update action `r` (restrict) and the `payments_amount_positive` check;
  an owner-connection INSERT of a payment with amount 0 is rejected; deleting a
  member that a payment references is rejected; the feature 5 script still
  passes; F-20 and F-21 are marked `fixed`; typecheck and build pass.

## Verify

- Read-only: `SELECT conname, confdeltype, confupdtype FROM pg_constraint WHERE
  conrelid IN ('payments'::regclass, 'contributions'::regclass,
  'member_credits'::regclass) AND contype = 'f'` shows `r`/`r` for all rows.
- The feature 5 API script (cash logging) passes unchanged.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":3197,"specSha256":"45e6ebded5b32ed303835d02e410606b95cda863ade0324e22b895e2bf42fff9","branch":"refs/heads/fix/money-table-foreign-keys-and-payment-amount-check","head":"fd1ad3d9845336c44d72539e406c1d54ef37c1f2","baseRef":"refs/heads/main","baseCommit":"022e6577ecff8df37ef54fba06098c6019258db4","sourceTree":"578b3fd760ea72140f8a411bc985d1fab474d72e","absentOptional":[]} -->

## Findings

### money-table-foreign-keys-and-payment-amount-check/F-20 [P3] closed - Some money-table foreign keys use ON DELETE SET NULL, which lets a referential action rewrite append-only rows

**File:** prisma/migrations/20261105112753_payments/migration.sql:75
**Found:** 2026-11-05 by /audit independent (scope: current; lens: security, quality)
**Why it matters:** The RLS design makes `payments`, `contributions`, and `member_credits` append-only for the app role (no UPDATE/DELETE policy). But `payments.member_id` (line 75), `payments.logged_by` (78), `contributions.logged_by` (90), `contributions.reverses_id` (96), `member_credits.source_payment_id` (105), and `member_credits.applied_to_cycle_id` (108) are `ON DELETE SET NULL`, and every FK is `ON UPDATE CASCADE`. Referential actions run regardless of the money tables' RLS, so deleting a referenced user or member (for example by the owner role or a later feature that allows deletes; `users` has no RLS and the app role holds DELETE on it) would silently null who logged the cash or which member a payment belongs to, an UPDATE to money rows that the append-only rule forbids. Not reachable through the API today: members have no DELETE policy and users are held by RESTRICT FKs from sessions and memberships. The other money FKs in the same migration already use RESTRICT, so the set is inconsistent.
**Suggested fix:** In this unshipped migration (or a follow-up), make the money-table FKs `ON DELETE RESTRICT ON UPDATE RESTRICT` (Prisma: `onDelete: Restrict, onUpdate: Restrict` on those relations). No current requirement is lost.
**Resolution:** Fixed 2026-11-06 by fix/money-table-foreign-keys-and-payment-amount-check: all 13 money-table relations in prisma/schema.prisma use `onDelete: Restrict, onUpdate: Restrict`, applied by migration 20261106100504_money_fk_restrict (drops and re-adds only those foreign keys). Checked against Neon: `pg_constraint` shows `r`/`r` for all 13; owner-connection deletes of a referenced member, user, and cycle and an id change of a referenced payment fail with 23001 restrict_violation; the payment row is unchanged. Awaiting an `/audit` re-review to close.
Closed 2026-11-06 by /audit independent (scope: current; all lenses) on fd1ad3d: the migration drops and re-adds exactly the 13 FKs created by 20261105112753_payments (same names, columns, and targets), now `ON DELETE RESTRICT ON UPDATE RESTRICT`; no other table's FK, no RLS policy, and no data changes. The schema diff touches only the 13 relation fields of `Payment`, `Contribution`, and `MemberCredit` and matches the migration. No code in src/ deletes or re-keys users, members, cycles, payments, contributions, or organisations, and the build plan keeps money rows and members never deleted, so nothing relies on the old SET NULL or CASCADE actions. Organisation deletes were already RESTRICT and are unchanged.

### money-table-foreign-keys-and-payment-amount-check/F-21 [P3] closed - payments.amount > 0 from the spec is enforced only by request validation

**File:** prisma/migrations/20261105112753_payments/migration.sql:14
**Found:** 2026-11-05 by /audit independent (scope: current; lens: quality)
**Why it matters:** The spec's Data section states `Payment.amount int > 0`. The cash endpoint enforces 1 to 2 000 000 000 in `logCashBody` (payments.validation.ts:9), but the table has no CHECK constraint, so the planned webhook and unmatched paths (features 17-20) can insert a zero or negative payment if their own validation slips. Contributions and credits legitimately go negative (reversals, spends), but payments never should.
**Suggested fix:** Add `ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK (amount > 0);` to the migration. No current requirement is lost.
**Resolution:** Fixed 2026-11-06 by fix/money-table-foreign-keys-and-payment-amount-check: migration 20261106100504_money_fk_restrict adds `payments_amount_positive CHECK ("amount" > 0)` (contribution and credit amounts stay signed). Checked against Neon: owner-connection inserts of amount 0 and -5 fail with 23514 check_violation; cash logging (feature 5 script, 28/28) still passes. Awaiting an `/audit` re-review to close.
Closed 2026-11-06 by /audit independent (scope: current; all lenses) on fd1ad3d: `payments_amount_positive CHECK ("amount" > 0)` matches the spec and applies only to `payments`; the only payment writer (`logCash`, payments.service.ts:29) takes `amount` from `logCashBody` (`int().min(1)`), so valid existing data satisfies it and a fresh database applies it to an empty table after 20261105112753_payments. Prisma does not model CHECK constraints, so it causes no schema drift.

## Independent review

**Status:** passed
**Target commit:** fd1ad3d9845336c44d72539e406c1d54ef37c1f2
**Base commit:** 022e6577ecff8df37ef54fba06098c6019258db4
**Base ref:** refs/heads/main
**Spec hash:** 45e6ebded5b32ed303835d02e410606b95cda863ade0324e22b895e2bf42fff9
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-06T10:33:26Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-06T10:41:56Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `git rev-parse HEAD`: pass (equals Target commit)
- `git merge-base refs/heads/main HEAD`: pass (equals Base commit)
- `sha256sum blueprint/context/current-feature.md`: pass (equals Spec hash)
- `git status --porcelain --untracked-files=all`: pass (only blueprint/context/review.md modified)
- `npm run typecheck`: pass
- `npm run build`: pass
- Test, lint, and Verify commands: unavailable (none configured)

## Evidence

- Delta 022e657..fd1ad3d: prisma/schema.prisma, prisma/migrations/20261106100504_money_fk_restrict/migration.sql, blueprint/context/current-feature.md, blueprint/context/findings.md.
- The migration drops and re-adds exactly the 13 FKs created in 20261105112753_payments (payments 3, contributions 6, member_credits 4) with identical names, columns, and targets, now ON DELETE RESTRICT ON UPDATE RESTRICT; it adds only `payments_amount_positive CHECK ("amount" > 0)`. No data change, no RLS or grant change, no other table touched.
- Schema diff changes only the 13 relation fields of Payment, Contribution, and MemberCredit to `onDelete: Restrict, onUpdate: Restrict`, matching the migration; Prisma does not model CHECK constraints, so no drift.
- No src/ code deletes or re-keys users, members, cycles, payments, contributions, or organisations; the build plan and project plan keep money rows and members never deleted. Nothing relies on the old SET NULL or CASCADE actions.
- The only payment writer takes `amount` from `logCashBody` (`int().min(1)`), so the CHECK cannot reject valid data; on a fresh database it runs after the payments migration on an empty table.

## Findings

- F-20 [P3] fixed -> closed
- F-21 [P3] fixed -> closed
- No new findings

## Remaining risk

- No test runner, lint, or Verify command exists; no automated tests cover the constraints.
- Database behaviour (constraint actions, migration apply, `migrate status` sync) was not re-verified by this reviewer; the database was not contacted per review boundaries, so runtime evidence relies on the builder's recorded Neon checks.
- The planned owner "delete the organisation" capability (project-plan.md) is blocked by RESTRICT FKs from money and other tables; this predates the fix and will need an explicit design when that feature is built.

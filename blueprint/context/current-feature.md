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

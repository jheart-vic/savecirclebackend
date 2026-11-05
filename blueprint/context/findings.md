# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to merge while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-10 [P3] open - Parallel OTP requests for different phones can overshoot the global daily SMS cap

**File:** src/auth/auth.service.ts:56
**Found:** 2026-10-17 by /audit independent (scope: current; lens: security, performance)
**Why it matters:** The spec says at most `OTP_DAILY_LIMIT` texted challenges in 24 hours. `requestCode` counts texted challenges (line 56) and inserts the new one (line 65) inside a transaction that holds only the per-phone advisory lock (line 46). Requests for different phones do not serialise, and under PostgreSQL's default READ COMMITTED each concurrent transaction sees the same count before any of them commits, so N parallel requests made while the count is at `OTP_DAILY_LIMIT - 1` all pass and all send an SMS. The overshoot is bounded by how many requests are in flight at once (pool size, per-IP limiter, one Turnstile token each), so this is a soft overrun of the spend cap, not an unbounded one, hence P3. Not reproduced at runtime; confirmed from the code path.
**Suggested fix:** Needs a user decision (fix or accept). Smallest fix: take one fixed global advisory lock (for example `pg_advisory_xact_lock(<constant>)`) just before the cap count, so the count-and-insert for texted codes is serialised platform-wide; at pilot volume the extra wait is small. Alternatively accept a small overshoot and record why. No current requirement is lost.
**Resolution:**

### F-12 [P3] open - "The one withOrg call with no membership check" comment is now false

**File:** src/organisations/organisations.service.ts:19
**Found:** 2026-11-02 by /audit independent (scope: current; lens: quality)
**Why it matters:** The coding standards (coding-standards.md:93) say `withOrg` runs only after `requireOrgMember`, and the comment at organisations.service.ts:19-20 records `createOrganisation` as "the one withOrg call with no membership check". This feature adds two more such calls (`acceptInvite` and `declineInvite`, src/staff/staff.service.ts:91-114). The spec's tenancy rules ask for that exception to be noted "beside the existing exception in `organisations.service.ts`"; it was noted only in staff.service.ts, so the comment that a future reviewer would use to enumerate unchecked `withOrg` calls now undercounts them. The `withOrg` docstring at src/tenancy.ts:16-17 states the same rule without exceptions. No behaviour or isolation defect: both new calls take the organisation id from an invite that RLS and the `phoneNumber` filter already bind to the caller, and re-check it in the conditional update.
**Suggested fix:** Reword the organisations.service.ts:19-20 comment to name the exceptions (create organisation; accept/decline invite in staff.service.ts) instead of "the one", and optionally add "except the invite-holder paths in staff.service.ts" to the tenancy.ts docstring. Comment-only; no current requirement is lost.
**Resolution:**

### F-13 [P3] open - connect_timeout on DATABASE_URL is ignored by the app's pg driver, so the comment overstates it

**File:** .env.example:7
**Found:** 2026-11-03 by /audit independent (scope: current; lens: quality)
**Why it matters:** The comment says `connect_timeout=30` "on both URLs gives a sleeping Neon compute time to wake". That holds for `DIRECT_URL`, which the Prisma CLI's schema engine reads (prisma.config.ts:13) and where `connect_timeout` is a supported seconds parameter with a short default. It does not hold for `DATABASE_URL`: the app connects through `@prisma/adapter-pg` (src/db.ts:10), which builds a node-postgres `Pool`. node-postgres 8.23.1 uses only `connectionTimeoutMillis` for its connect timer (node_modules/pg/lib/client.js:116), and the URL's `connect_timeout` is used only when building a libpq string for the native driver (node_modules/pg/lib/connection-parameters.js:150), which this project does not use. The parameter is not sent in the startup message, so it is harmless, and the app already has no client-side connect timeout by default. The only cost is a misleading comment that a future reader might rely on when tuning app connection timeouts.
**Suggested fix:** Either drop `&connect_timeout=30` from the `DATABASE_URL` example and say the parameter is for the migration (`DIRECT_URL`) connection, or keep it and reword the comment to say it affects only the Prisma CLI. Comment/example-only; no current requirement is lost.
**Resolution:**

### F-15 [P3] open - Service member-role check duplicates the route guard and is unreachable

**File:** src/groups/groups.service.ts:135
**Found:** 2026-11-04 by /audit independent (scope: current; lens: quality)
**Why it matters:** Both member endpoints are already behind `createsGroups = requireOrgRole("owner", "admin", "field_officer")` (src/groups/groups.routes.ts:9, 18-19), so `MANAGES_MEMBERS` (groups.service.ts:13) and the `forbidden()` branch in `insertMembers` can never fire through HTTP. Two copies of the same role list can drift; the guard name `createsGroups` on the member routes also hides that it is the member-management rule. A side effect of the route-level check is that a treasurer or branch manager posting to an unknown group id gets 403 rather than the spec's 404 for a group that does not exist; no existence is leaked because the 403 is role-only.
**Suggested fix:** Keep one source of truth: either drop `MANAGES_MEMBERS`/`forbidden` from the service (the route guard already enforces the spec table), or keep the service check and remove the route guard from the two member routes if 404-before-403 for unknown ids is wanted. Optionally rename the route guard to something like `managesGroups`. No current requirement is lost.
**Resolution:** Re-examined 2026-11-05 by /audit independent (feature 4 review, target 59f49a5). The evidence changed in part: the check moved into exported `assertManagesMembers` (groups.service.ts:30-32), which the rotation routes now rely on with no route guard (src/rotations/rotations.routes.ts:7-9, called at src/rotations/rotations.service.ts:47), so `MANAGES_MEMBERS` is now live and reachable and must stay. Dropping it from the service is no longer a valid fix. The call inside `insertMembers` (groups.service.ts:135) is still unreachable behind the member routes' `createsGroups` guard, so the duplicate role list and the 403-before-404 ordering on the member routes remain, and member routes and rotation routes now order 403/404 differently for the same role rule. Status stays open at P3; the remaining fix is to remove `createsGroups` from the two member routes so both paths use `assertManagesMembers` after `visibleGroup`, or accept the difference.

### F-16 [P3] open - A far-future firstDueDate produces malformed cycle due dates

**File:** src/rotations/rotations.validation.ts:6
**Found:** 2026-11-05 by /audit independent (scope: current; lens: quality, security)
**Why it matters:** `startBody` only bounds `firstDueDate` from below (`>= todayInLagos()`). `addPeriods` formats with `toISOString().slice(0, 10)` (src/rotations/due-dates.ts:6), which is only `YYYY-MM-DD` for years 0000-9999. Against the built code, `dueDates("9999-12-31", "monthly", 2)` returns `["9999-12-31", "+010000-01"]`; the service then builds `new Date("+010000-01T00:00:00Z")`, which is 10000-01-01 rather than the intended 10000-01-31, and the response's `toDate` would echo the same malformed string (or the driver may reject it as a 500). Any rotation whose last cycle crosses year 9999 is affected. Only reachable by an Owner/Admin/assigned officer typing an absurd date, nothing crosses tenants, hence P3.
**Suggested fix:** Add an upper bound to `firstDueDate` in `startBody` (for example no later than today plus a few years, or a year below 9000) so every generated date stays within four-digit years. No current requirement is lost.
**Resolution:**

### F-17 [P3] open - lockedDraft runs the group visibility check twice

**File:** src/rotations/rotations.service.ts:46
**Found:** 2026-11-05 by /audit independent (scope: current; lens: quality, performance)
**Why it matters:** `lockedDraft` calls `visibleGroup` (findGroup, plus findOfficer for a field officer) before taking the lock, then `currentRotation` calls `visibleGroup` again after the lock (rotations.service.ts:36). Reorder and start therefore make one or two redundant queries inside the locked transaction. The first call is needed so a hidden or unknown group returns 404 before the 403 role check and before locking; the second only re-reads `type`, `frequency`, and `contributionAmount`. No behaviour defect: the second read after the lock is what makes the amount snapshot current. The service also imports `assertManagesMembers`/`visibleGroup` from groups.service by name, while coding-standards.md:39 asks for namespace imports of layers.
**Suggested fix:** Have `currentRotation` accept an already-loaded group (or split out a `rotationOf(group, tx)` helper), and in `lockedDraft` re-read only the group fields after the lock with `groupModel.findGroup`; import the groups service as `import * as groupService`. No current requirement is lost.
**Resolution:**

### F-18 [P3] unverified - Reorder issues one UPDATE per slot inside the 10 s transaction and cannot exceed 500 members

**File:** src/rotations/rotations.service.ts:70
**Found:** 2026-11-05 by /audit independent (scope: current; lens: performance)
**Why it matters:** After `moveSlotsAside`, the loop awaits `setSlotPosition` once per member, so a reorder of n members makes n sequential round trips inside an interactive transaction capped at 10 s (src/db.ts:12) while holding the group row lock that member adds and start wait on. With the app close to Neon this is milliseconds per call, but src/db.ts notes slow links to Neon have already exceeded Prisma's defaults; at ~100 ms per round trip a ~90-member group would time out and roll back. Separately, `reorderBody` caps `memberIds` at 500 (rotations.validation.ts:4) while groups have no member cap (imports are 500 per file), so a group past 500 members can never be reordered and gets 400 `invalid_body`. Not measured; no runtime latency evidence.
**Suggested fix:** Rewrite positions in one statement, for example `UPDATE rotation_slots s SET position = v.pos FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS v(id, pos) WHERE s.id = v.id AND s.rotation_id = ${rotationId}::uuid`, after the existing move-aside (the unique index is not deferrable, so keep the negative pass). Align the 500 cap with any group-size limit the plan sets, or document it. No current requirement is lost.
**Resolution:**

### F-19 [P3] open - Candidate shortfall cast to int can overflow once a cycle takes deposits beyond its amount due

**File:** src/payments/payments.model.ts:32
**Found:** 2026-11-05 by /audit independent (scope: current; lens: quality, performance)
**Why it matters:** `shortfall` is `(c.amount_due - COALESCE(SUM(ct.amount), 0))::int`. `SUM` over int is bigint and the result is cast back to int with no floor. Rotation cycles are bounded by the per-person advisory lock (a cycle never gets more than its amount due), but the thrift target takes "any amount" (allocation.ts:49-52) and is also selected as a candidate by the same query (`c.rotation_id IS NULL`). Once feature 9 creates thrift cycles, cumulative deposits above about 2.15 billion kobo on one thrift cycle make `amount_due - sum` fall below the int range, the cast raises "integer out of range", and every later cash log for that person fails with a 500. Not reachable today because no thrift cycles exist. Separately, the query returns every fully paid historical cycle and the engine discards them in JS, so the row count grows with group age.
**Suggested fix:** Compute `GREATEST(c.amount_due - COALESCE(SUM(...), 0), 0)::int` (always within int because it is at most `amount_due`) and filter to shortfalls greater than 0 in SQL (wrap in a subquery or repeat the expression in `WHERE`). No current requirement is lost.
**Resolution:**

### F-20 [P3] open - Some money-table foreign keys use ON DELETE SET NULL, which lets a referential action rewrite append-only rows

**File:** prisma/migrations/20261105112753_payments/migration.sql:75
**Found:** 2026-11-05 by /audit independent (scope: current; lens: security, quality)
**Why it matters:** The RLS design makes `payments`, `contributions`, and `member_credits` append-only for the app role (no UPDATE/DELETE policy). But `payments.member_id` (line 75), `payments.logged_by` (78), `contributions.logged_by` (90), `contributions.reverses_id` (96), `member_credits.source_payment_id` (105), and `member_credits.applied_to_cycle_id` (108) are `ON DELETE SET NULL`, and every FK is `ON UPDATE CASCADE`. Referential actions run regardless of the money tables' RLS, so deleting a referenced user or member (for example by the owner role or a later feature that allows deletes; `users` has no RLS and the app role holds DELETE on it) would silently null who logged the cash or which member a payment belongs to, an UPDATE to money rows that the append-only rule forbids. Not reachable through the API today: members have no DELETE policy and users are held by RESTRICT FKs from sessions and memberships. The other money FKs in the same migration already use RESTRICT, so the set is inconsistent.
**Suggested fix:** In this unshipped migration (or a follow-up), make the money-table FKs `ON DELETE RESTRICT ON UPDATE RESTRICT` (Prisma: `onDelete: Restrict, onUpdate: Restrict` on those relations). No current requirement is lost.
**Resolution:**

### F-21 [P3] open - payments.amount > 0 from the spec is enforced only by request validation

**File:** prisma/migrations/20261105112753_payments/migration.sql:14
**Found:** 2026-11-05 by /audit independent (scope: current; lens: quality)
**Why it matters:** The spec's Data section states `Payment.amount int > 0`. The cash endpoint enforces 1 to 2 000 000 000 in `logCashBody` (payments.validation.ts:9), but the table has no CHECK constraint, so the planned webhook and unmatched paths (features 17-20) can insert a zero or negative payment if their own validation slips. Contributions and credits legitimately go negative (reversals, spends), but payments never should.
**Suggested fix:** Add `ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK (amount > 0);` to the migration. No current requirement is lost.
**Resolution:**

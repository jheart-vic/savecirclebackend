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

### F-14 [P2] open - An out-of-range startDate month or day returns 500 instead of 400 invalid_body

**File:** src/groups/groups.validation.ts:18
**Found:** 2026-11-04 by /audit independent (scope: current; lens: quality, security)
**Why it matters:** The `calendarDate` refine calls `new Date(...).toISOString()`. For a string that passes the `YYYY-MM-DD` regex but is not a parseable date (month `00` or `13`, day `32` and up), `new Date` is an Invalid Date and `toISOString()` throws `RangeError: Invalid time value`. zod does not catch exceptions thrown inside a refine, so `parse()` in src/validate.ts rethrows the RangeError and the central handler answers 500 `internal_error` and logs a stack trace. Confirmed against the built schema: `createGroupBody.safeParse({ ..., type: "fixed", startDate: "2027-13-01" })` throws RangeError, while `"2027-02-30"` correctly fails with `success: false`. The spec and standards require invalid bodies to be 400 `invalid_body`. No data or isolation effect: nothing is written and the response is generic, hence P2.
**Suggested fix:** Make the refine total: build the Date once, return false when `Number.isNaN(date.getTime())`, and only then compare `date.toISOString()` with the input. No current requirement is lost.
**Resolution:**

### F-15 [P3] open - Service member-role check duplicates the route guard and is unreachable

**File:** src/groups/groups.service.ts:124
**Found:** 2026-11-04 by /audit independent (scope: current; lens: quality)
**Why it matters:** Both member endpoints are already behind `createsGroups = requireOrgRole("owner", "admin", "field_officer")` (src/groups/groups.routes.ts:9, 18-19), so `MANAGES_MEMBERS` (groups.service.ts:13) and the `forbidden()` branch in `insertMembers` can never fire through HTTP. Two copies of the same role list can drift; the guard name `createsGroups` on the member routes also hides that it is the member-management rule. A side effect of the route-level check is that a treasurer or branch manager posting to an unknown group id gets 403 rather than the spec's 404 for a group that does not exist; no existence is leaked because the 403 is role-only.
**Suggested fix:** Keep one source of truth: either drop `MANAGES_MEMBERS`/`forbidden` from the service (the route guard already enforces the spec table), or keep the service check and remove the route guard from the two member routes if 404-before-403 for unknown ids is wanted. Optionally rename the route guard to something like `managesGroups`. No current requirement is lost.
**Resolution:**

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

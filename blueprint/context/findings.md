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

# Feature: Staff auth

**From build-plan:** feature 1
**Build attempt:** 1
**Branch:** feature/staff-auth
**Status:** verified

## Goal

Staff sign in with their phone number and a 6-digit OTP. A first sign-in with a
new phone creates the `User` (sign-up and sign-in are one flow). Sign-in
creates a revocable session carried in an HttpOnly cookie. Every OTP request,
OTP failure, sign-in, sign-out, and revocation writes an `AuthEvent` row.

## In scope

- `User`, `OtpChallenge`, `Session`, `AuthEvent` tables and their migration
- One JSON error shape and a central error handler, plus a JSON 404
- `cors` locked to the frontend origin with credentials, `cookie-parser`
- Phone normalization to E.164 (default region NG)
- OTP request with per-phone (3/hour) and per-IP limits
- OTP verify: 10-minute expiry, 5 attempts, single use, creates the user on
  first sign-in (name required only then)
- Session cookie, `requireAuth` middleware, current user, sign-out
- List own active sessions and revoke one
- OTP delivery by Termii SMS (pulled forward from Feature 12, user decision),
  `devCode` outside production, and a 24-hour global OTP cap

## Out of scope

- WhatsApp, the `Notifier` interface, delivery reports (Feature 12)
- Organisations, roles, RLS, org switching (Feature 2)
- Per-organisation session lifetime set by an admin (see Notes, belongs with
  Feature 2's organisation policy)
- Member PIN access and `PhoneAccess` (Feature 15)
- Editing a user's name after sign-up
- A test runner (none configured)

## Build loop

`workflow.stepReview` is `every`: implement one step, stop, and wait for
approval before the next. `checkpointCommits` is `disabled`, so no commit per
step; `/complete` makes the single feature commit.

Per the user's working style: after each step, explain every line written in
the chat; keep inline code comments sparse. After the last step, give a "Test
it" section with method, route, and JSON body for every endpoint, including
error cases.

## Build steps

- [x] 1. **App foundation: config, errors, CORS, cookies.** Add `src/config.ts`
  (reads and validates env with zod: `NODE_ENV`, `FRONTEND_ORIGIN`,
  `AUTH_SECRET` min 32 chars, `SESSION_TTL_DAYS` default 30). Add
  `src/errors.ts` (`AppError` with status, code, message) and a central error
  middleware plus a 404 handler in `src/app.ts`. Install `cookie-parser` and
  `@types/cookie-parser`; mount `cors({ origin: FRONTEND_ORIGIN, credentials:
  true })` and `cookieParser()`. Add the new vars to `.env.example`.
  **Done when:** `GET /health` still returns `{"status":"ok"}`, `GET /nope`
  returns 404 `{"error":{"code":"not_found","message":"Route not found"}}`,
  a malformed JSON body returns 400 in the same shape, the server refuses to
  start with a clear message when `AUTH_SECRET` is missing, and
  `npm run typecheck` passes.
- [x] 2. **Auth schema and migration.** Add the four models and the
  `AuthEventType` enum to `prisma/schema.prisma` (see Data). Run
  `npm run db:migrate --name staff_auth` and `npm run db:generate`.
  **Done when:** the migration applies to Neon, `npx prisma migrate status`
  reports in sync, and `npm run typecheck` passes.
- [x] 3. **Auth helpers.** `src/auth/phone.ts` (`normalizePhone` returns E.164
  for a Nigerian mobile number or null; see Phone rules) and `src/auth/crypto.ts` (`generateOtp` via `crypto.randomInt`,
  `generateSessionToken` 32 random bytes base64url, `hashSecret` HMAC-SHA256
  with `AUTH_SECRET`, `secretsMatch` via `timingSafeEqual`).
  **Done when:** `npm run typecheck` passes and a one-off `tsx` call shows
  `08031234567` and `+2348031234567` both normalize to `+2348031234567` and
  `12` returns null.
- [x] 4. **Request an OTP.** `POST /auth/otp/request` in `src/auth/routes.ts`
  (mounted at `/auth`), logic in `src/auth/otp.ts`, delivery in
  `src/auth/send-otp.ts`. Per-IP `express-rate-limit` on both OTP routes.
  **Done when:** a valid phone returns 202 with `devCode` (non-production
  only), stores only the hash, and writes `otp_requested`; the 4th request for
  the same phone within an hour returns 429 `otp_rate_limited`; an invalid
  phone returns 400 `invalid_phone`; typecheck passes.
- [x] 5. **Verify the OTP and sign in.** `POST /auth/otp/verify`, logic in
  `src/auth/otp.ts` and `src/auth/session.ts`.
  **Done when:** the right code returns 200 with the user and sets the
  `sc_session` cookie, writing `signed_in`; a wrong code returns 401
  `invalid_code`, increments attempts, and writes `otp_failed`; the 6th try,
  an expired code, or a reused code returns 401 `invalid_code`; a new phone
  without `name` returns 400 `name_required` without consuming the code;
  typecheck passes.
- [x] 6. **Model-Service-Controller-Route structure** (user request). Split
  `src/auth/` into `auth.model.ts` (Prisma queries only), `auth.service.ts`
  (business rules, transactions), `auth.controller.ts` (parse request, call
  service, shape response), `auth.routes.ts` (path + middleware + controller,
  one line each), plus `auth.validation.ts`, `auth.middleware.ts`,
  `auth.cookies.ts`. `Db` type in `src/db.ts`. No behavior change.
  **Done when:** typecheck passes and the step 4 and step 5 checks give the
  same results as before.
- [x] 7. **Authenticated requests and sign-out.** `requireAuth` and the Origin
  check in `auth.middleware.ts`; `GET /auth/me`; `POST /auth/sign-out`.
  **Done when:** `/auth/me` returns the user with a valid cookie and 401
  `unauthenticated` without one or with an expired or revoked session;
  sign-out returns 204, clears the cookie, sets `revoked_at`, writes
  `signed_out`, and the same cookie then gets 401; a POST with a foreign
  `Origin` returns 403 `bad_origin`; typecheck passes.
- [x] 8. **List and revoke sessions.** `GET /auth/sessions` and
  `DELETE /auth/sessions/:id`.
  **Done when:** the list shows only the caller's active sessions with
  `current: true` on this one; revoking one of them returns 204 and writes
  `session_revoked`; another user's session id or an unknown id returns 404
  `session_not_found`; a non-UUID id returns 400; typecheck passes.
- [x] 9. **Termii SMS delivery and daily cap** (user request, pulled forward
  from Feature 12). `src/termii.ts` (`sendSms` with an `axios` instance, user decision),
  `send-otp.ts` uses it, Termii env in `config.ts`, cap and failure cleanup
  in `auth.service.ts`.
  **Done when:** against a fake Termii server, a request sends the right
  JSON and returns 202; a Termii error returns 503 `otp_delivery_failed`
  and leaves no challenge; the cap returns 503 `otp_unavailable`; production
  config fails without Termii and passes with it; typecheck passes.
  Real SMS confirmed on 2026-10-04 with the user's Termii workspace over the
  `generic` channel. The `dnd` channel is rejected (422 "Route not configured
  ... route=DND") until Termii support activates the DND route; switch
  `TERMII_CHANNEL` back to `dnd` then. Register a `SaveCircle` sender ID
  before launch (the test account uses `ADM WORLD`).
- [x] 10. **Separate sign-up and sign-in** (user request, option a).
  Migration `otp_purpose` adds `OtpPurpose` and `otp_challenges.purpose` /
  `signup_name` (existing rows backfilled as `sign_in`). Routes
  `POST /auth/sign-up`, `POST /auth/sign-in`, `POST /auth/verify` replace
  the `/auth/otp/*` routes.
  **Done when:** sign-up then verify creates the user and sets the cookie;
  sign-in then verify signs in; sign-up for an existing phone signs in
  without renaming; sign-in for an unknown phone returns the same 202 with
  no SMS and its 4th request gets the same 429; a sign-up code fails after a
  later request; the old routes 404; the step 7 and 8 checks still pass;
  typecheck passes.
- [x] 11. **Independent review repairs** (F-01 to F-05, receipt
  changes-requested on a8b9b94). Attempt reserved before compare; `devCode`
  only without Termii; sign-in SMS sent after the reply; body-parser 4xx
  errors mapped; `otp_challenges.created_at` index (migration
  `otp_created_at_index`).
  **Done when:** 20 parallel wrong guesses leave attempts at 5 and the right
  code then fails; the right code on the 5th try succeeds; no `devCode` with
  Termii configured; known and unknown sign-in reply in the same time and a
  Termii failure on sign-in returns 202 and removes the challenge; 413, 415,
  and 400 for bad bodies; the step 7 and 8 checks pass; typecheck and build
  pass.
- [x] 12. **Second review repairs** (F-06, F-07; receipt passed on 3c3308e,
  user chose to fix before completing). Migration `otp_sends_sms` adds
  `otp_challenges.sends_sms`; the daily cap counts only texted codes;
  `deliverCode` logs the delivery error before the clean-up and logs a
  failed clean-up instead of losing the first error.
  **Done when:** with the cap at 2, five unknown-number sign-ins return 202
  and the third texted sign-up returns 503 `otp_unavailable`; a forced
  clean-up failure logs both errors and still returns 503
  `otp_delivery_failed`; the step 7 and 8 checks pass; typecheck and build
  pass.
- [x] 13. **Cloudflare Turnstile and F-08** (user request; decisions: sign-up
  and sign-in only, fail closed, built inside Feature 1). `src/turnstile.ts`
  (`verifyHuman` via an `axios` instance to Cloudflare siteverify, hostname
  checked against `FRONTEND_ORIGIN` for real keys, setup errors thrown);
  `requireHuman` middleware reads `turnstileToken` from the body. At the
  daily cap, sign-in replies 202 with `sends_sms = false`; sign-up 503.
  **Done when:** against Cloudflare's real siteverify, the always-pass test
  secret accepts the dummy token, the always-fail and spent secrets give 403
  `human_check_failed`, a missing or 2049-character token gives 400
  `human_check_required`, the user's real secret is accepted by Cloudflare
  (dummy token 403, not 503), and an unreachable Cloudflare gives 503
  `human_check_unavailable`; with the cap full, sign-up 503 and known and
  unknown sign-in both 202; production refuses to start without
  `TURNSTILE_SECRET_KEY`; the session regression checks pass; typecheck and
  build pass.
- [x] 14. **F-09: explicit environment** (user chose to fix before
  completing). `NODE_ENV` is required with no default; production refuses a
  missing or Cloudflare test Turnstile secret (`isTurnstileTestSecret` in
  `src/config.ts`, reused by `src/turnstile.ts`).
  **Done when:** startup fails for a missing or unknown `NODE_ENV`, and for
  production without a Turnstile key or with a test key; production with a
  real key and development without a key both start; the Turnstile and
  session regression checks pass; typecheck and build pass.

## Files / areas

- `src/app.ts`, `src/server.ts`, `src/config.ts`, `src/errors.ts`,
  `src/validate.ts`, `src/db.ts`
- `src/auth/` - `auth.routes.ts`, `auth.controller.ts`, `auth.service.ts`,
  `auth.model.ts`, `auth.validation.ts`, `auth.middleware.ts`,
  `auth.cookies.ts`, plus helpers `phone.ts`, `crypto.ts`, `send-otp.ts`
- `prisma/schema.prisma`, `prisma/migrations/<ts>_staff_auth/`
- `.env.example`, `package.json`, `package-lock.json`
- `blueprint/context/coding-standards.md` - fill the error-shape TODO and the
  feature-folder TODO (`src/<feature>/`)

## Data / contracts

**Models** (camelCase fields mapped to snake_case columns and tables):

- `User` - `id` uuid PK default `uuid()`, `name` text, `phoneNumber` text
  unique (E.164), `createdAt` timestamptz default now
- `OtpChallenge` - `id` uuid, `phoneNumber` text (indexed with `createdAt`),
  `codeHash` text, `expiresAt`, `attempts` int default 0, `consumedAt?`,
  `createdAt`. `createdAt` is added to the plan's fields for the hourly limit.
- `Session` - `id` uuid, `userId` FK -> User, `tokenHash` text unique,
  `expiresAt`, `revokedAt?`, `createdAt`. `createdAt` added for the list.
- `AuthEvent` - `id` uuid, `userId?` FK -> User, `phoneNumber`, `event`
  `AuthEventType`, `ip` text, `createdAt`. Append-only.
- `AuthEventType` - `otp_requested`, `otp_failed`, `signed_in`, `signed_out`,
  `session_revoked`

**Rules**

- Phone (user decision): accept `+2348031234567`, `2348031234567`,
  `08031234567`, or `8031234567`, with spaces, hyphens, dots, or brackets
  ignored. Reject anything else: other country codes, wrong length (the
  10-digit national number must not be longer or shorter), `+234` followed
  by a 0, letters, and numbers that are not Nigerian mobile numbers (checked
  with `libphonenumber-js/max` metadata). Always stored as E.164.
- OTP: 6 digits from `crypto.randomInt`, zero-padded; stored as
  HMAC-SHA256(`AUTH_SECRET`, phone + ":" + code); never logged or stored raw.
  Expires 10 minutes after creation. Verify checks only the newest
  unconsumed, unexpired challenge for that phone.
- Attempts (F-01): every verify first spends an attempt with one conditional
  update (unconsumed, unexpired, `attempts < 5`) and compares the code only
  if that succeeded, so at most 5 comparisons happen per challenge even under
  parallel requests. A right code is then consumed with `consumedAt IS NULL`,
  so two concurrent verifies cannot both succeed.
- Per-phone limit: 3 challenges per phone in the last 60 minutes, counted
  from `OtpChallenge`. Per-IP limit: 20 requests per 15 minutes across both
  OTP routes (recorded choice, easy to tune).
- Every OTP request writes `otp_requested`, including throttled ones; the
  limit counts challenges, not events. Every failed verify writes
  `otp_failed`.
- Sign-up (`name` 1 to 100 chars, trimmed, + phone) stores the name only on
  the challenge (`purpose: sign_up`, `signup_name`); verifying it creates the
  user, consumes the challenge, starts the session, and writes `signed_in` in
  one transaction. A sign-up for a phone that already has a user sends the
  code and verifying it just signs in; the stored name is never changed.
- Sign-in for a phone with no user (user decision a): same 202 reply, no SMS,
  but a challenge is still stored so the hourly limit and 429 look the same
  for every phone. Its unknown code can never verify.
- Verification succeeds only with the phone's newest challenge, so a sign-up
  code stops working once a later sign-in or sign-up code is requested.
- Session token: 32 random bytes, base64url; only its HMAC is stored.
  Lifetime `SESSION_TTL_DAYS` (default 30).
- Cookie `sc_session`: HttpOnly, `Path=/`, `Max-Age` = session lifetime,
  `Secure` and `SameSite=None` in production (PWA on another site),
  `SameSite=Lax` and not Secure in development (http localhost).
- CSRF: for POST, PUT, PATCH, DELETE, a present `Origin` header must equal
  `FRONTEND_ORIGIN`, else 403 `bad_origin`. A missing `Origin` is allowed
  (non-browser clients cannot ride a victim's cookie).
- `requireAuth` reads the cookie, hashes it, and accepts only a session with
  `revokedAt` null and `expiresAt` in the future. It sets `res.locals.auth =
  { userId, sessionId }`. User id never comes from the client.
- Revoke is scoped `WHERE id = :id AND userId = caller`; not found and not
  yours look the same (404).
- Delivery: `sendOtp(phone, code)` texts the code through Termii
  (`POST {TERMII_BASE_URL}/api/sms/send`, `type: plain`, channel `dnd` by
  default, 10 s timeout) when Termii is configured. `devCode` is returned only
  when Termii is not configured and not in production (F-02, user choice), so
  a real SMS never comes with the code in the response. Production refuses
  to start without all three Termii values.
- Delivery failure: the challenge is deleted (so it does not count toward
  the hourly limit) and the error is logged without the code. Sign-up waits
  for delivery and returns 503 `otp_delivery_failed`. Sign-in replies 202
  before delivery (F-03, user choice), so known and unknown phones take the
  same time and a delivery failure is invisible to the caller.
- Global cap: at most `OTP_DAILY_LIMIT` (default 500) texted challenges
  (`sends_sms = true`) across all phones in the last 24 hours. Beyond it a
  logged alert, sign-up gets 503 `otp_unavailable`, and sign-in replies the
  usual 202 with nothing sent (F-08), so the cap never reveals who has an
  account. Unknown-number sign-ins send nothing and do not count (F-06).
- Human check (user decision): `POST /auth/sign-up` and `POST /auth/sign-in`
  require a Cloudflare Turnstile token in `turnstileToken`, verified with
  Cloudflare siteverify (10 s timeout) before anything else runs. Real keys
  must report the `FRONTEND_ORIGIN` hostname. Missing or over-2048-char token
  400 `human_check_required`; rejected, expired, or reused token 403
  `human_check_failed`; Cloudflare unreachable or a setup error (bad secret)
  fails closed with 503 `human_check_unavailable` and a log line.

**Error shape** (all errors): `{ "error": { "code": "<snake_case>",
"message": "<human text>" } }`. 500s return `internal_error` with a generic
message and log the real error server-side.

**Endpoints**

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/auth/sign-up` | `{ "name": "Ada Obi", "phone": "08031234567", "turnstileToken": "<widget token>" }` | 202 `{ "message": "We've sent a code to your phone", "devCode"?: "123456" }` |
| POST | `/auth/sign-in` | `{ "phone": "08031234567", "turnstileToken": "<widget token>" }` | 202 `{ "message": "If this number has an account, we've sent a code", "devCode"?: "123456" }` |
| POST | `/auth/verify` | `{ "phone", "code" }` | 200 `{ "user": { "id", "name", "phoneNumber" } }` + cookie |
| GET | `/auth/me` | none | 200 `{ "user": {...}, "session": { "id", "expiresAt" } }` |
| POST | `/auth/sign-out` | none | 204, cookie cleared |
| GET | `/auth/sessions` | none | 200 `{ "sessions": [{ "id", "createdAt", "expiresAt", "current" }] }` |
| DELETE | `/auth/sessions/:id` | none | 204 |

Error codes: `invalid_body` 400, `invalid_params` 400, `invalid_phone` 400,
`human_check_required` 400, `invalid_code` 401, `unauthenticated` 401,
`bad_origin` 403, `human_check_failed` 403, `session_not_found` 404,
`not_found` 404, `otp_rate_limited` 429, `too_many_requests` 429 (per IP),
`internal_error` 500, `otp_delivery_failed` 503, `otp_unavailable` 503
(sign-up only), `human_check_unavailable` 503.

**Env vars** (added to `.env.example`): `FRONTEND_ORIGIN`
(e.g. `http://localhost:5173`), `AUTH_SECRET` (32+ random chars; the
"session/OTP secret" from the plan), `SESSION_TTL_DAYS` (optional, default
30), `NODE_ENV` (required, no default: `development` | `production` |
`test`), `TERMII_BASE_URL`, `TERMII_API_KEY`, `TERMII_SENDER_ID`
(all three or none; required in production), `TERMII_CHANNEL` (`dnd` |
`generic`, default `dnd`), `OTP_DAILY_LIMIT` (default 500),
`TURNSTILE_SECRET_KEY` (a real key is required in production, where
Cloudflare test secrets are refused; development and test fall back to
Cloudflare's always-pass test secret).

## Testing

No test runner is configured, so tests are not a gate. Each step is verified
with `npm run typecheck` plus real requests against `npm run dev` (curl or
Postman), and database rows checked in Neon or `npx prisma studio`. The pure
helpers in step 3 (phone normalization, OTP format, hash compare) are the
first candidates for unit tests if `/tests` is run later.

## Notes for the AI

- Prerequisite: the Neon setup (`src/db.ts`, `prisma.config.ts`,
  `prisma/schema.prisma` generator options, `@prisma/adapter-pg`) is
  uncommitted on `main`. Commit it before creating `feature/staff-auth`, so
  the feature branch starts from a tracked base.
- The empty local branch `auth/setup` is unrelated; do not build on it.
- **Per-organisation session lifetime:** the user wants the 30-day lifetime
  to be configurable by each organisation's admin. Sessions are platform-level
  and exist before any organisation is chosen, so this belongs in Feature 2
  (organisation policy), likely enforced when a session acts inside an
  organisation (effective expiry = the earlier of the session's own expiry and
  `createdAt` + the org's lifetime). Feature 1 keeps a global
  `SESSION_TTL_DAYS`. The build plan's Feature 2 line now carries it.
- Step 10 replaced `/auth/otp/request` and `/auth/otp/verify` (steps 4 and 5)
  with `/auth/sign-up`, `/auth/sign-in`, and `/auth/verify`, matching the
  client's separate screens; the plan only says "phone + OTP". A correct
  code signs in immediately; there is no second sign-in after sign-up.
- `src/db.ts` sets `transactionOptions` (maxWait 5 s, timeout 10 s) after
  two Prisma transaction timeouts on the slow link to Neon us-east-2.
- Never log OTPs, session tokens, or their hashes. Do not include `devCode`
  in any log line.
- Follow coding standards: thin handlers, zod at the boundary, logic in plain
  functions, `.js` import extensions, no em dashes.
- `app.set("trust proxy", 1)` so `req.ip` is the client behind Render's one
  proxy hop; the per-IP limiter and `AuthEvent.ip` depend on it.
- The per-phone limit takes a `pg_advisory_xact_lock` on the phone inside
  the count-and-insert transaction, so parallel requests cannot exceed 3.
- `express-rate-limit` default in-memory store is fine for one pilot
  instance; revisit with Redis in Feature 12 if more instances run.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":21114,"specSha256":"db7c2be942411a0295592b67de902f3f69a269b8b1cc92e2b391f75d9d23075b","branch":"refs/heads/feature/staff-auth","head":"7cb57d90f31874daf325978ae7e3afc000898a89","baseRef":"refs/heads/main","baseCommit":"1a55a8f91221264c2c0f2c142a19962c5b889529","sourceTree":"138e84ff2b534615222d224e8887ad6ee7aa45d6","absentOptional":[]} -->

## Findings

### 1/F-01 [P1] closed - Parallel verify requests bypass the 5-attempt OTP limit

**File:** src/auth/auth.service.ts:91
**Found:** 2026-10-04 by /audit independent (scope: current; lens: security)
**Why it matters:** `verifyCode` reads the challenge (`findLatestChallenge`, line 77), decides it is `usable` from that stale `attempts` value (lines 85-89), and compares the guess before any attempt is recorded. The conditional `incrementAttempts` (line 92) only stops the counter at 5; it does not stop the comparison. An attacker who fires N parallel `POST /auth/verify` requests with N different codes gets all N compared against the hash, because every request reads `attempts = 0` before the increments land (each request also does a second read, `findUserByPhone`, widening the window on the slow Neon link). If the right code is in the batch and its `consumeChallenge` (`attempts < 5`) commits before the fifth wrong increment, it signs in. The per-IP limiter (20 per 15 minutes) bounds N per address, not per challenge, so N scales with the number of source IPs. This breaks the spec rule "at 5 the challenge is dead" and lets an attacker test far more than 5 codes per challenge against any staff account.
**Suggested fix:** Spend the attempt before comparing. First run one conditional update on the newest challenge: `updateMany({ where: { id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } })`; if `count === 0`, fail without comparing. Only then compare the hash; on a match, consume with `consumedAt: null` (drop the `attempts < 5` condition, or use `attempts <= MAX_ATTEMPTS`, since the reservation already counted this try). At most 5 comparisons can then happen per challenge. No current requirement is lost.
**Resolution:** Fixed in step 11 (2026-10-05): `reserveAttempt` spends the attempt in one conditional update (unconsumed, unexpired, attempts < 5) before the hash is compared; `consumeChallenge` now only requires `consumedAt IS NULL`. Verified: 20 parallel wrong guesses all 401 with attempts = 5, the right code then 401; the right code on the 5th sequential try 200. Closed 2026-10-09 by /audit independent (fresh subagent, target 3c3308e): `reserveAttempt` (src/auth/auth.model.ts:52) spends the attempt with one conditional `updateMany` (unconsumed, unexpired, attempts < 5) and `verifyCode` (src/auth/auth.service.ts:100-103) compares the hash only when it updated a row, so at most 5 comparisons happen per challenge under any concurrency. `consumeChallenge` requires `consumedAt IS NULL` inside the sign-in transaction, so two concurrent right codes cannot both succeed. No new defect introduced.

### 1/F-02 [P2] closed - OTP is returned to any caller when NODE_ENV is unset

**File:** src/auth/send-otp.ts:9
**Found:** 2026-10-04 by /audit independent (scope: current; lens: security)
**Why it matters:** `devCode` is returned whenever `NODE_ENV` is not `production`, and `src/config.ts:9` defaults a missing `NODE_ENV` to `development`. `npm run start` (`node dist/server.js`) does not set it. A deployment that forgets `NODE_ENV=production` but has Termii configured starts normally (the production Termii guard is also keyed on `NODE_ENV`), sends real SMS, and returns the code in the HTTP response. Anyone can then `POST /auth/sign-up` with a staff member's phone (sign-up for an existing phone signs in) and `POST /auth/verify` with the returned `devCode`, taking over the account. The session cookie also loses `Secure`. This matches the spec text, so it is a fail-open default rather than a contract break, but the impact is account takeover from one missing variable.
**Suggested fix:** Fail closed. Either return `devCode` only when Termii is not configured (a real SMS makes it redundant), or require `NODE_ENV` explicitly (no default) so a missing value stops startup. The second changes local setup, so it needs the user's choice.
**Resolution:** Fixed in step 11 (2026-10-05), user choice: `returnsDevCode` is true only when Termii is not configured and not production, so a real SMS never comes with `devCode`, whatever `NODE_ENV` is. Verified: sign-up with Termii configured returns no `devCode`. Closed 2026-10-09 by /audit independent (fresh subagent, target 3c3308e): `returnsDevCode` (src/auth/send-otp.ts:5) is `!termiiConfigured && !isProduction`, and production config refuses to start without Termii (src/config.ts:21), so a deployment that sends real SMS never returns `devCode`, whatever `NODE_ENV` is. Matches the recorded user choice. No new defect introduced.

### 1/F-03 [P2] closed - Sign-in response timing and 503s reveal which phones have accounts

**File:** src/auth/auth.service.ts:61
**Found:** 2026-10-04 by /audit independent (scope: current; lens: security)
**Why it matters:** The spec's decision (a) is that `POST /auth/sign-in` must not reveal who has an account. For an unknown phone, `requestCode` returns right after the database transaction (line 61). For a known phone it then awaits the Termii HTTP call (`sendOtp`, line 64, up to a 10 s timeout), so the response is measurably slower, and a Termii failure returns 503 `otp_delivery_failed` only for known phones. A caller can enumerate staff phone numbers by timing sign-in requests, within the per-phone and per-IP limits.
**Suggested fix:** Do not make the sign-in reply wait on delivery: send the SMS after replying (keeping delete-on-failure and the log), or pad unknown-phone replies to a similar latency. The first also removes the known-only 503; that changes `otp_delivery_failed` behavior for sign-in, so it needs a user decision.
**Resolution:** Fixed in step 11 (2026-10-05), user choice: sign-in replies 202 without waiting for the SMS; delivery runs after the reply, and a failure deletes the challenge and logs. Sign-up still waits and reports 503. Verified with a 1.5 s fake Termii: known 1833 ms vs unknown 1917 ms; a known sign-in with Termii down returns 202 and the challenge is removed afterwards. Closed 2026-10-09 by /audit independent (fresh subagent, target 3c3308e): for `sign_in`, `requestCode` (src/auth/auth.service.ts:72-79) returns before delivery for known phones and skips delivery for unknown phones, so both reply 202 after the same database work and a Termii failure is never visible to the caller. The background promise ends in `.catch`, so it cannot become an unhandled rejection. The only remaining known-phone difference (`devCode`) exists only without Termii outside production. A separate logging gap in the same function is recorded as F-07.

### 1/F-04 [P3] closed - Oversized or unsupported JSON bodies return 500 instead of a 4xx

**File:** src/errors.ts:24
**Found:** 2026-10-04 by /audit independent (scope: current; lens: quality)
**Why it matters:** The error handler maps only body-parser's `entity.parse.failed` to 400. Other body-parser errors that carry their own status, such as a body over the 100 kB `express.json()` limit (`entity.too.large`, 413) or an unsupported charset (415), fall through to `console.error` and a 500 `internal_error`. Clients get the wrong status and the logs record non-errors as failures.
**Suggested fix:** Before the 500 branch, return any error with a numeric 4xx `status` and `expose === true` (set by body-parser) as that status with `invalid_body`. No current requirement is lost.
**Resolution:** Fixed in step 11 (2026-10-05): the error handler returns any body-parser error with `expose: true` and a 4xx status as that status with `invalid_body`. Verified: 200 KB body 413, unsupported charset 415, malformed JSON 400. Closed 2026-10-09 by /audit independent (fresh subagent, target 3c3308e): `errorHandler` (src/errors.ts:30-34) returns any `expose: true` 4xx error as that status with `invalid_body` before the 500 branch; non-exposed errors still log and return a generic 500. No new defect introduced.

### 1/F-05 [P3] closed - Global daily OTP cap counts the whole challenge table without a usable index

**File:** src/auth/auth.model.ts:28
**Found:** 2026-10-04 by /audit independent (scope: current; lens: performance)
**Why it matters:** `countAllChallengesSince` filters only on `created_at`, but the only index is `(phone_number, created_at)` (`prisma/schema.prisma:48`), which cannot serve a `created_at`-only range. Every sign-up and sign-in therefore scans all of `otp_challenges` inside the per-phone advisory-lock transaction, and nothing deletes old challenges, so the scan grows forever. Small today (the cap limits growth to about 500 rows a day); impact unverified, no profiling done.
**Suggested fix:** Add `@@index([createdAt])` on `OtpChallenge` in a new migration, or periodically delete challenges older than 24 hours. No current requirement is lost.
**Resolution:** Fixed in step 11 (2026-10-05): migration `otp_created_at_index` adds `@@index([createdAt])` on `otp_challenges`. Pruning old challenges is left for later. Closed 2026-10-09 by /audit independent (fresh subagent, target 3c3308e): `@@index([createdAt])` is at prisma/schema.prisma:49 and migration 20261004180239_otp_created_at_index adds `otp_challenges_created_at_idx`, a plain additive index that serves the `created_at`-only range count. Table growth without pruning remains a later choice, as recorded.

### 1/F-06 [P2] closed - One IP can exhaust the global daily OTP cap and lock every staff member out

**File:** src/auth/auth.service.ts:53
**Found:** 2026-10-09 by /audit independent (scope: current; lens: security)
**Why it matters:** The 24-hour cap counts every stored challenge, including sign-in challenges for unknown phones that send no SMS (lines 72-76). The only per-caller bound is the in-memory per-IP limiter (20 requests per 15 minutes, src/auth/auth.middleware.ts:16), and the per-phone limit is sidestepped by rotating through valid Nigerian mobile numbers. One IP can therefore store 80 challenges an hour and reach the default `OTP_DAILY_LIMIT` of 500 in about 6 hours (minutes with a handful of IPs). After that every sign-up and sign-in for every staff member returns 503 `otp_unavailable` until the rolling 24-hour window drains. The no-SMS challenges spend none of the SMS budget the cap exists to protect, so this denial costs the attacker nothing. The cap and its 503 are in the spec, so this is an availability trade-off rather than a contract break, but the impact is a platform-wide sign-in outage.
**Suggested fix:** Needs a user decision. Smallest option: count only challenges that trigger an SMS toward the global cap (exclude sign-in challenges for phones with no user, for example with a flag on the challenge). The cap is global, not per phone, so this does not reveal which phones have accounts. Optionally also lower the per-IP limit for OTP requests. No current requirement is lost; the SMS-spend cap still holds.
**Resolution:** Fixed in step 12 (2026-10-10), user choice (option 1): `otp_challenges.sends_sms` (migration `otp_sends_sms`, existing rows backfilled `true`) records whether a code is texted, and the daily cap counts only `sends_sms = true` rows. Unknown-number sign-ins still create a challenge (per-phone limit unchanged) but cannot use the cap. Verified: with the cap at 2, five unknown-number sign-ins all 202, two texted sign-ups 202, the third 503 `otp_unavailable`. Re-reviewed 2026-10-10 by /audit independent (fresh subagent, target 817763d), left `fixed`, not closed: the original defect is gone (`sendsSms` at src/auth/auth.service.ts:42 is false for unknown-number sign-ins and `countTextedChallengesSince` at src/auth/auth.model.ts:27 counts only `sends_sms = true`, so free requests can no longer fill the cap; the migration is additive and backfills safely). But this repair introduced F-08 (the cap now moves only for real accounts, which makes it an enumeration signal), so the Audit rule for closing does not hold yet. Close it once F-08 is resolved. Closed 2026-10-16 by /audit independent (fresh subagent, target b5734ae): `wantsSms` (src/auth/auth.service.ts:42) is false for unknown-number sign-ins and `countTextedChallengesSince` (src/auth/auth.model.ts:27) counts only `sends_sms = true`, so free requests still cannot fill the cap; Turnstile on sign-up and sign-in (src/auth/auth.routes.ts:7-8) now also gates scripted cap filling. The repair-induced F-08 is closed in this pass, so the original defect is gone and no open defect remains from this repair.

### 1/F-07 [P3] closed - A failed challenge delete hides the delivery error from the logs

**File:** src/auth/auth.service.ts:25
**Found:** 2026-10-09 by /audit independent (scope: current; lens: quality)
**Why it matters:** `deliverCode` awaits `deleteChallenge` before `console.error(error)`. If the delete rejects (for example a database timeout on the slow Neon link), the Termii error is never logged. On the sign-in path that rejection is then swallowed by `.catch(() => {})` (line 77), so a failed SMS leaves no trace at all and the undelivered challenge still counts toward the phone's hourly limit. On the sign-up path the caller gets a 500 and only the Prisma error is logged.
**Suggested fix:** Log the delivery error first, then delete the challenge (or give the delete its own try/catch that also logs). No current requirement is lost.
**Resolution:** Fixed in step 12 (2026-10-10): `deliverCode` logs the delivery error first, and a failed challenge delete is caught and logged instead of replacing it. Verified with a forced delete failure: both errors logged, response still 503 `otp_delivery_failed`. Closed 2026-10-10 by /audit independent (fresh subagent, target 817763d): `deliverCode` (src/auth/auth.service.ts:20-28) runs `console.error(error)` before the delete, and the delete has its own `.catch` that logs, so a delete failure can no longer hide the delivery error. Sign-up still gets 503 `otp_delivery_failed`. On sign-in the rejection is still caught by `.catch(() => {})` (line 81), so there is no unhandled rejection. The logged errors are the redacted Termii `Error` and a Prisma error; neither contains the code. No new defect introduced. Header corrected to `closed` 2026-10-16 by /audit independent (fresh subagent, target b5734ae) after re-checking the unchanged `deliverCode` (src/auth/auth.service.ts:20-28): it still logs the delivery error first and catches and logs a failed delete; the sign-in background call still ends in `.catch(() => {})` (line 85).

### 1/F-08 [P3] closed - The daily cap now moves only for real accounts, so sign-in can reveal who has an account

**File:** src/auth/auth.service.ts:56
**Found:** 2026-10-10 by /audit independent (scope: current; lens: security)
**Why it matters:** Spec decision (a) says `POST /auth/sign-in` must not reveal who has an account. Since the F-06 repair, a sign-in for a known phone adds a `sends_sms = true` row to the global cap, but a sign-in for an unknown phone does not (line 42). The cap check (line 56) still runs for unknown-number sign-ins, so they are a free probe of "is the cap full?": 202 when below the cap, 503 `otp_unavailable` at it, and they never use a slot. An attacker who fills the cap (texted sign-ups to any numbers) waits until one slot ages out of the 24-hour window, which free probes can detect. They then sign in with a target phone and send one more free probe: 503 means the target has an account, 202 means it does not. A miss costs nothing, so many numbers can be tested per freed slot within the per-phone and per-IP limits. It needs a platform-wide outage and about `OTP_DAILY_LIMIT` paid SMS first, which makes it noisy and expensive, hence P3. Before this repair every challenge counted, so this signal did not exist.
**Suggested fix:** Needs a user decision, because both options change shipped behavior. (1) On sign-in, never return 503 for the cap: when the cap is reached, reply 202 the same as always, store the challenge with `sends_sms = false`, send nothing, and keep the logged alert. Sign-up keeps its 503. Unknown-number sign-ins then always get 202, so they cannot be used to probe; a probe would need a texted sign-up, which uses a slot each time. (2) Accept the risk and record why. Option 1 drops the 503 `otp_unavailable` reply on sign-in only. The SMS-spend cap still holds.
**Resolution:** Fixed in step 13 (2026-10-16): when the daily cap is reached, sign-in still replies 202 and stores the challenge with `sends_sms = false` (nothing sent, alert logged) for known and unknown phones alike; only sign-up returns 503 `otp_unavailable`. Cloudflare Turnstile on sign-up and sign-in (same step) also stops scripted cap filling. Verified with the cap full: sign-up 503, known and unknown sign-in both 202 with `sends_sms = false`. Closed 2026-10-16 by /audit independent (fresh subagent, target b5734ae): in `requestCode` (src/auth/auth.service.ts:56-63) the cap throws 503 only for `sign_up`; every sign-in stores `sendsSms: wantsSms && !capReached` (line 70) and returns `{}` before delivery when nothing is texted (line 84), so known and unknown sign-ins both reply 202 with no `devCode` at the cap and an unknown-number sign-in can no longer probe the cap for free. Sign-up's 503 does not depend on whether the phone has an account. The residual signal named in the suggested fix remains: a probe now needs a texted sign-up that spends a slot (one real SMS), plus a full cap and a Turnstile token per request. No new defect introduced.

### 1/F-09 [P3] closed - Turnstile silently runs on an always-pass test secret when NODE_ENV is unset or a test key is configured

**File:** src/turnstile.ts:6
**Found:** 2026-10-16 by /audit independent (scope: current; lens: security)
**Why it matters:** `secret` falls back to Cloudflare's always-pass test secret whenever `TURNSTILE_SECRET_KEY` is empty (line 6), and config requires the key only when `NODE_ENV === "production"` (src/config.ts:29), while a missing `NODE_ENV` defaults to `development` (src/config.ts:9). `npm run start` does not set `NODE_ENV`, and Termii can be fully configured outside production, so a deployment that forgets `NODE_ENV=production` sends real SMS while `requireHuman` accepts any non-empty token. Separately, nothing rejects a test key (`1x0000...`, `2x0000...`, `3x0000...`) in production; any of them also skips the hostname check (line 7 and line 41), and the `1x` always-pass key makes the bot check pass every request. Either way the human check the spec relies on for sign-up and sign-in is off with no log line, leaving only the per-IP, per-phone, and daily limits. The spec permits the development fallback, so this is a fail-open default rather than a contract break; the impact is losing the bot check, not account takeover, hence P3.
**Suggested fix:** In `src/config.ts`, refuse to start when `isProduction` and the key starts with a test prefix, and log one startup warning whenever the test secret is in use (or key the fallback on Termii not being configured, mirroring the F-02 choice for `devCode`). The last option changes local setup with Termii, so it needs the user's choice. No current requirement is lost.
**Resolution:** Fixed in step 14 (2026-10-17), user choice (option 1): `NODE_ENV` has no default, so a missing or misspelled value stops startup instead of meaning development; this also closes the related path where an unset `NODE_ENV` without Termii would return `devCode`. Production refuses a missing Turnstile secret and any Cloudflare test secret (`isTurnstileTestSecret`, shared by config and `src/turnstile.ts`). Verified: NODE_ENV missing or `staging` exits; production with no key or the always-pass test key exits; production with a real-looking key starts; development with no key starts on the test secret. Closed 2026-10-17 by /audit independent (fresh subagent, target 7cb57d9): `NODE_ENV` is `z.enum(["development", "production", "test"])` with no default (src/config.ts:14), so a missing or misspelled value fails `safeParse` and exits before any route runs; the forgotten-`NODE_ENV` path to the always-pass fallback (src/turnstile.ts:7) is gone. Production adds an issue when the key is missing or matches `isTurnstileTestSecret` (src/config.ts:8, 34), whose `^[123]x0+AA$` pattern covers all three published Cloudflare test secrets, so the hostname skip (src/turnstile.ts:8, 42) can only apply outside production. The startup error lists only field paths and fixed messages, never the secret value. The fallback now needs an explicit `development` or `test`, which matches the recorded user choice. No new defect introduced.

## Independent review

**Status:** passed
**Target commit:** 7cb57d90f31874daf325978ae7e3afc000898a89
**Base commit:** 1a55a8f91221264c2c0f2c142a19962c5b889529
**Base ref:** main
**Spec hash:** db7c2be942411a0295592b67de902f3f69a269b8b1cc92e2b391f75d9d23075b
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-10-17T04:46:12Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-17T04:56:23Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Handoff

Review the active spec and the complete `1a55a8f91221264c2c0f2c142a19962c5b889529..7cb57d90f31874daf325978ae7e3afc000898a89` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

### Commands

- `git rev-parse HEAD`: pass (equals Target commit)
- `git merge-base main HEAD`: pass (equals Base commit)
- `sha256sum blueprint/context/current-feature.md`: pass (equals Spec hash; spec is tracked, no snapshot)
- `git status --porcelain=v1 --untracked-files=all`: pass (only `blueprint/context/review.md` modified)
- `git diff 1a55a8f..7cb57d9` (full delta, 37 files): reviewed
- `npm run typecheck` / `npx tsc --noEmit`: pass (exit 0)
- em dash / en dash / ellipsis search over `src`, `prisma`, `.env.example`: pass (none)

### Evidence

- Config fails closed: `NODE_ENV` is a required enum with no default (src/config.ts:14); production requires all three Termii values and a non-test Turnstile secret (src/config.ts:26-40); startup errors print only paths and fixed messages.
- `devCode` only when Termii is not configured and not production (src/auth/send-otp.ts:5); never logged.
- Turnstile runs after the per-IP limiter and before any body logic (src/auth/auth.routes.ts:7-8); axios errors are converted to plain errors without the secret (src/turnstile.ts:27-34); setup errors and network failures give 503, rejections 403, hostname enforced for real keys (src/turnstile.ts:36-42).
- OTP: `crypto.randomInt` 6 digits, HMAC with phone binding, timing-safe compare (src/auth/crypto.ts); attempt reserved by one conditional update before compare (src/auth/auth.model.ts:53-58, src/auth/auth.service.ts:108-111); single use via `consumedAt IS NULL` inside the sign-in transaction (src/auth/auth.service.ts:116-140).
- Per-phone limit serialised by `pg_advisory_xact_lock` inside the count-and-insert transaction (src/auth/auth.service.ts:44-76); works under PgBouncer transaction mode.
- Enumeration: known and unknown sign-in do the same database work and reply 202 before delivery; at the cap every sign-in replies 202 with nothing sent; only sign-up returns 503 (src/auth/auth.service.ts:56-90); verify always fails with the same 401.
- Sessions: 32-byte base64url token, only HMAC stored, unique index; HttpOnly, Secure and SameSite=None in production (src/auth/auth.cookies.ts); revocation scoped by user id with 404 for not-yours (src/auth/auth.service.ts:177-185); `requireAuth` ignores non-string cookie values.
- CSRF: Origin check on non-safe methods (src/auth/auth.middleware.ts:62-73); CORS locked to `FRONTEND_ORIGIN` with credentials.
- Background sign-in delivery ends in `.catch`, and delivery errors are logged before the clean-up (src/auth/auth.service.ts:20-29, 85).
- Migrations are additive; NOT NULL columns are added with a temporary default then dropped; indexes cover the per-phone, global-cap, session, and event lookups.
- F-09 re-reviewed against src/config.ts and src/turnstile.ts and closed; F-10 recorded new.

### Findings

- F-09 [P3] closed (repair verified, no new defect)
- F-10 [P3] open - parallel requests for different phones can overshoot the global daily SMS cap (src/auth/auth.service.ts:56)

### Remaining risk

- `npm run build` not run (reviewer instructions); typecheck passed.
- No test command exists, so no automated tests cover phone normalization, OTP hashing, `isTurnstileTestSecret`, or the limits; behavior was reviewed from code only.
- No server, database, migration (`npx prisma migrate status`), Termii, or Cloudflare call was run; concurrency and timing claims are from code reasoning, not runtime evidence.
- Termii error detail logs up to 200 characters of the provider response (src/termii.ts:23); whether Termii ever echoes the message text is unverified.
- `express-rate-limit` uses the in-memory store, so per-IP limits hold only for a single instance (recorded spec choice).
- A non-production `NODE_ENV` (`development` or `test`) with Termii configured still uses the always-pass Turnstile secret and no hostname check; this now requires an explicit setting, per the recorded user choice for F-09.

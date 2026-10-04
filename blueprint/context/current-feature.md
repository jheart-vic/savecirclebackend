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
- Attempts: a wrong code increments `attempts` with a conditional update
  (`attempts < 5`); at 5 the challenge is dead. A right code is consumed with
  a conditional update (`consumedAt IS NULL AND attempts < 5`), so two
  concurrent verifies cannot both succeed.
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
  default, 10 s timeout) when Termii is configured, and returns `{ devCode }`
  whenever `NODE_ENV` is not `production`. Production refuses to start
  without all three Termii values.
- Delivery failure: the challenge is deleted (so it does not count toward
  the hourly limit), the error is logged without the code, and the request
  gets 503 `otp_delivery_failed`.
- Global cap: at most `OTP_DAILY_LIMIT` (default 500) challenges across all
  phones in the last 24 hours; beyond it 503 `otp_unavailable` and a logged
  alert.

**Error shape** (all errors): `{ "error": { "code": "<snake_case>",
"message": "<human text>" } }`. 500s return `internal_error` with a generic
message and log the real error server-side.

**Endpoints**

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/auth/sign-up` | `{ "name": "Ada Obi", "phone": "08031234567" }` | 202 `{ "message": "We've sent a code to your phone", "devCode"?: "123456" }` |
| POST | `/auth/sign-in` | `{ "phone": "08031234567" }` | 202 `{ "message": "If this number has an account, we've sent a code", "devCode"?: "123456" }` |
| POST | `/auth/verify` | `{ "phone", "code" }` | 200 `{ "user": { "id", "name", "phoneNumber" } }` + cookie |
| GET | `/auth/me` | none | 200 `{ "user": {...}, "session": { "id", "expiresAt" } }` |
| POST | `/auth/sign-out` | none | 204, cookie cleared |
| GET | `/auth/sessions` | none | 200 `{ "sessions": [{ "id", "createdAt", "expiresAt", "current" }] }` |
| DELETE | `/auth/sessions/:id` | none | 204 |

Error codes: `invalid_body` 400, `invalid_params` 400, `invalid_phone` 400,
`invalid_code` 401, `unauthenticated` 401, `bad_origin` 403,
`session_not_found` 404, `not_found` 404, `otp_rate_limited` 429,
`too_many_requests` 429 (per IP), `internal_error` 500,
`otp_delivery_failed` 503, `otp_unavailable` 503.

**Env vars** (added to `.env.example`): `FRONTEND_ORIGIN`
(e.g. `http://localhost:5173`), `AUTH_SECRET` (32+ random chars; the
"session/OTP secret" from the plan), `SESSION_TTL_DAYS` (optional, default
30), `NODE_ENV`, `TERMII_BASE_URL`, `TERMII_API_KEY`, `TERMII_SENDER_ID`
(all three or none; required in production), `TERMII_CHANNEL` (`dnd` |
`generic`, default `dnd`), `OTP_DAILY_LIMIT` (default 500).

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

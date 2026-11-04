# Feature: Per-organisation session lifetime

**From build-plan:** feature 2c
**Build attempt:** 1
**Branch:** feature/per-organisation-session-lifetime
**Status:** verified

## Goal

An organisation's Owner or Admin sets how long a sign-in stays valid for work
in that organisation (default 30 days). Every request under
`/organisations/:orgId` is refused with 401 once the caller's session is older
than that organisation's lifetime, so they must sign in again before acting in
it. Other organisations, and the caller's session itself, are unaffected.

## In scope

- `Organisation.policy` jsonb column (default `{}`), holding
  `session_ttl_days`; later features add their keys to the same object
- Enforcement in `requireOrgMember`, after the membership check
- `GET` and `PATCH /organisations/:orgId/policy`, Owner or Admin only
- `AuthContext` carries the session's `createdAt`

## Out of scope

- Other policy keys (`default_frequency`, withdrawals, notice, limits, fees)
  and their features
- Revoking sessions when the lifetime is lowered (the request check already
  refuses old sessions; the session stays valid in other organisations)
- Changing the platform session lifetime (`SESSION_TTL_DAYS`) or
  `/auth/*` routes
- `GET /organisations` (a list across organisations, not a request to one)
- AuditLog for policy changes (arrives with approvals)

## Build loop

Autopilot run: build all steps without pausing, then one review packet.
`checkpointCommits` is `disabled`. Model - Service - Controller - Route
layering and the tenancy rules from `coding-standards.md` apply.

## Build steps

- [x] 1. **Policy column and session start time.** Add `policy Json
  @default("{}")` to `Organisation` with a normal `npm run db:migrate` (no RLS
  change: `organisations` already has its policies). `authenticate` returns
  the session's `createdAt` in `AuthContext` as `sessionCreatedAt`.
  **Done when:** migration applies; migrate status in sync; existing rows read
  `{}`; typecheck passes.
- [x] 2. **Enforce the lifetime.** `findActiveMembership` also returns the
  organisation's `policy`. `requireOrgMember`, after a membership is found,
  computes the lifetime and throws 401 `session_expired` when `now -
  sessionCreatedAt` exceeds it.
  **Done when:** a session younger than the lifetime gets 200; one older gets
  401 `session_expired` on `GET /organisations/:orgId` and on a staff route;
  the same session still gets 200 in another organisation with the default;
  a non-member still gets 404 (membership is checked first); typecheck passes.
- [x] 3. **Read and set the lifetime.** `GET /organisations/:orgId/policy` and
  `PATCH /organisations/:orgId/policy` behind `requireOrgRole("owner",
  "admin")`.
  **Done when:** GET returns the default 30 for a new organisation; PATCH with
  7 returns 200 `{ "policy": { "sessionTtlDays": 7 } }` and GET then returns
  7; 0, 31, 1.5, a string, or a missing field give 400 `invalid_body`; a
  treasurer gets 403 `forbidden`; lowering the lifetime below the caller's
  session age makes their next org request 401 `session_expired`; the 2b
  regression script still passes; typecheck and build pass.

## Files / areas

- `prisma/schema.prisma`, `prisma/migrations/<ts>_organisation_policy/`
- `src/auth/auth.service.ts` (`AuthContext`, `authenticate`)
- `src/organisations/` - `.model.ts`, `.service.ts`, `.middleware.ts`,
  `.controller.ts`, `.routes.ts`, `.validation.ts`

## Data / contracts

**Column:** `organisations.policy` jsonb, not null, default `'{}'`. Key
`session_ttl_days`: positive integer. Missing, or not a positive integer, means
the default. Stored keys are snake_case (the overview's data model).

**Lifetime:** `sessionTtlDays = policy.session_ttl_days ?? SESSION_TTL_DAYS`
(platform default, 30). Allowed values 1 to `SESSION_TTL_DAYS`: a longer value
would have no effect because the session itself expires at the platform
lifetime.

**Enforcement:** in `requireOrgMember`, membership first (non-member, unknown,
inactive: 404 `organisation_not_found`, unchanged), then
`Date.now() - sessionCreatedAt > sessionTtlDays * 86 400 000` gives 401
`session_expired`, message "Sign in again to continue in this organisation".
The session is not revoked. Applies to every route under
`/organisations/:orgId`, including the policy routes.

**Write:** one statement inside `withOrg`: `UPDATE organisations SET policy =
policy || jsonb_build_object('session_ttl_days', $days) WHERE id = $orgId`,
so concurrent writers of other keys (later features) are not overwritten.

**Endpoints** (`requireAuth`, `requireOrgMember`, `requireOrgRole("owner",
"admin")`; PATCH behind the global Origin check)

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/organisations/:orgId/policy` | none | 200 `{ "policy": { "sessionTtlDays": 30 } }` |
| PATCH | `/organisations/:orgId/policy` | `{ "sessionTtlDays": 7 }` | 200 `{ "policy": { "sessionTtlDays": 7 } }` |

Errors: `invalid_body` 400, `invalid_params` 400, `unauthenticated` 401,
`session_expired` 401, `bad_origin` 403, `forbidden` 403,
`organisation_not_found` 404.

## Testing

No test runner. Scratch tsx scripts against Neon under the app role (Termii
blank, test phones `+23480300002xx`, Bash only), with session age simulated by
moving `sessions.created_at` back through the owner connection, and cleanup in
FK order. The 2b script is rerun as regression.

## Notes for the AI

- Decisions recorded (2026-11-03, Autopilot): the lifetime is measured from
  session creation (sign-in), not last activity; the allowed range is 1 to the
  platform lifetime; reading the policy is Owner/Admin only, like staff
  management; an expired org session is refused, not revoked.
- Migrations use `npm run db:migrate` again (fixed 2026-11-03).


<!-- blueprint:completion {"schemaVersion":1,"specBytes":5767,"specSha256":"d9eaec6dfa1c7777d1f86b9ac58f94172ddc1e944626b113c9c5afa65a4db319","branch":"refs/heads/feature/per-organisation-session-lifetime","head":"870e5b4290a2e83fbf4579adb4b5c9088dfbe15b","baseRef":"refs/heads/main","baseCommit":"4fd44e7b72dd57cac91f5e304b37d83f810c0e98","sourceTree":"eac4c7ed66f4ca52ef72ba8ed6667b42e94095c2","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** 870e5b4290a2e83fbf4579adb4b5c9088dfbe15b
**Base commit:** 4fd44e7b72dd57cac91f5e304b37d83f810c0e98
**Base ref:** refs/heads/main
**Spec hash:** d9eaec6dfa1c7777d1f86b9ac58f94172ddc1e944626b113c9c5afa65a4db319
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-03T19:26:27Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-04T02:01:31Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `npm run typecheck`: pass
- `npm run build`: pass

## Evidence

- Freshness: HEAD = 870e5b4290a2e83fbf4579adb4b5c9088dfbe15b; `git merge-base refs/heads/main HEAD` = 4fd44e7b72dd57cac91f5e304b37d83f810c0e98; raw SHA-256 of current-feature.md = d9eaec6d...4db319 (matches); working tree dirty only in review.md.
- Full delta reviewed (10 files): migration 20261103132945_organisation_policy, prisma/schema.prisma, src/auth/auth.service.ts, src/organisations/{controller,middleware,model,routes,service,validation}.ts, plus the spec.
- Enforcement: src/organisations/organisations.routes.ts:14 mounts every `/:orgId` path (including staffRouter and both policy routes) behind requireAuth then requireOrgMember; src/app.ts mounts no other org-scoped router. The age check (organisations.middleware.ts:25) runs only after the membership 404 (line 24).
- Trust: sessionCreatedAt comes from the DB session row via authenticate (auth.service.ts:163), not from client input; comparison uses server Date.now(); `now` override is only a default parameter not reachable from requests.
- Write: `$executeRaw` tagged template binds `${days}::int` and `${id}::uuid` as parameters (no injection); jsonb `||` merge preserves other keys; RLS organisations_update USING/WITH CHECK id = app_current_org() is satisfied by withOrg, and 0 rows maps to 404.
- Bounds: updatePolicyBody is int 1..config.SESSION_TTL_DAYS; stored value parsed by zod positive int with fallback to SESSION_TTL_DAYS for missing/malformed policy.
- Exposure: organisationFields, listActiveMemberships, and staff selects do not include `policy`; policy is returned only by the Owner/Admin-gated routes.
- Spec Notes decisions (measured from sign-in, range 1..platform, Owner/Admin read, refuse not revoke) are implemented as stated.

## Findings

- None

## Remaining risk

- No test runner, lint command, or Verify command exists; behaviour rests on the builder's scratch scripts, which this review did not rerun (no DB access permitted).
- Runtime RLS behaviour of the raw UPDATE under savecircle_app and the migration applying on Neon were not exercised in this review.

## Handoff

Review the active spec and the complete `4fd44e7b72dd57cac91f5e304b37d83f810c0e98..870e5b4290a2e83fbf4579adb4b5c9088dfbe15b` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

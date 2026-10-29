# Feature: Organisations and isolation

**From build-plan:** feature 2a
**Build attempt:** 1
**Branch:** feature/organisations-and-isolation
**Status:** verified

## Goal

A signed-in staff user can create an organisation (becoming its Owner), list
the organisations they belong to, and open one. Every organisation-scoped
request runs under PostgreSQL row-level security, through an app database role
that cannot bypass it, so one organisation's rows are invisible to another's.

## Design reference

- `blueprint/reference/onboarding/1-organisation.jpg`: the Organisation screen
  (name, type, contact email, contact phone). This feature provides the API
  behind it; the resumable onboarding flow is feature 16.

## In scope

- A restricted Postgres role `savecircle_app` (LOGIN, NOBYPASSRLS, not a
  superuser) that the running app connects as; migrations keep using the owner
  role through `DIRECT_URL`
- `Organisation` and `OrgMembership` tables with RLS enabled and policies
- A tenancy helper that runs queries in a transaction with
  `app.user_id` and `app.organisation_id` set transaction-locally
- `POST /organisations` (creator becomes Owner)
- `GET /organisations` (my organisations, with my role)
- `GET /organisations/:orgId` (one organisation, members only)
- `requireOrgMember` middleware for every route under `/organisations/:orgId`
- Evidence that RLS actually isolates organisations under the app role

## Out of scope

- Staff invites, role changes, removing staff (2b)
- Per-organisation session lifetime and the organisation `policy` field (2c)
- KYB, payment rails, money-mode suggestion, onboarding step tracking (16)
- Branches and branch managers' branch scope (32)
- SaveCircle support cross-organisation access and the platform audit log
- Editing or deleting an organisation
- `AuditLog` (introduced by the first feature that records approvals,
  holds, overrides, or reversals)

## Build loop

`workflow.stepReview` is `every`: implement one step, stop, and wait for
approval before the next. `checkpointCommits` is `disabled`; `/complete` makes
the single feature commit.

Per the user's working style: after each step, explain every line written in
the chat; keep inline code comments sparse. After the last step, give a "Test
it" section with method, route, and JSON body for every endpoint, including
error cases.

Follow the Model - Service - Controller - Route layering and `axios`-only
outbound calls from `coding-standards.md`.

## Build steps

- [x] 1. **Restricted app database role.** The user creates
  `savecircle_app` in the Neon SQL editor with the SQL in Notes (password of
  their choosing, never committed). Migration `app_role_grants` grants it
  `USAGE` on schema `public`, `SELECT, INSERT, UPDATE, DELETE` on all current
  tables, and the same on future tables created by the owner role (`ALTER
  DEFAULT PRIVILEGES`). `DATABASE_URL` switches to the pooled connection for
  `savecircle_app`; `DIRECT_URL` stays on the owner. `.env.example` explains
  both.
  **Done when:** a read-only query run through the app's `DATABASE_URL`
  shows `current_user = savecircle_app`, `rolsuper = false`, `rolbypassrls =
  false`; `npx prisma migrate status` is in sync; the existing auth flow
  (sign-up, verify, `/auth/me`, sessions, sign-out) still works under the new
  role; typecheck and build pass.
- [x] 2. **Organisation schema with RLS.** Add `OrganisationType`,
  `MoneyMode`, `OrgRole`, `MembershipStatus` enums and `Organisation`,
  `OrgMembership` models (see Data). Create the migration with
  `--create-only`, then add `ENABLE ROW LEVEL SECURITY` and the policies in
  Data to its SQL before applying.
  **Done when:** the migration applies; `pg_class.relrowsecurity` is true for
  both tables; the policies are listed in `pg_policies`; migrate status is in
  sync; typecheck passes.
- [x] 3. **Tenancy helper.** `src/tenancy.ts` exports `withUser(userId, fn)`
  and `withOrg(orgId, userId, fn)`. Each opens one Prisma transaction, sets
  `app.user_id` (and `app.organisation_id` for `withOrg`) with
  `set_config(..., true)`, and runs `fn(tx)`.
  **Done when:** a scratch script, connected as `savecircle_app`, seeds two
  organisations and shows: with no context, both tables return 0 rows;
  `withOrg(A)` sees only A's organisation and memberships; `withOrg(A)`
  cannot insert a membership for B (policy violation); `withUser(u)` sees
  only u's memberships; typecheck passes. Seed rows are deleted afterwards.
- [x] 4. **Create an organisation.** `src/organisations/` with
  `organisations.routes.ts`, `.controller.ts`, `.service.ts`, `.model.ts`,
  `.validation.ts`; mount at `/organisations` behind `requireAuth`.
  `POST /organisations` creates the organisation and the creator's Owner
  membership in one `withOrg` transaction using an id generated in the app.
  **Done when:** a valid body returns 201 with the organisation and
  `role: "owner"`; a body without `contactEmail` also returns 201 with
  `contactEmail: null`; invalid name, type, email, or a missing or invalid
  phone returns 400 with the codes in Data; no cookie returns 401; a foreign `Origin` returns 403; both
  rows exist and are readable only inside that organisation's context;
  typecheck passes.
- [x] 5. **List and open organisations.** `GET /organisations` (via
  `withUser`) and `GET /organisations/:orgId` behind `requireOrgMember`
  (`organisations.middleware.ts`), which sets `res.locals.org`.
  **Done when:** the list shows only the caller's active memberships with
  role, newest first; opening a member organisation returns 200 with my role;
  another user's organisation, an unknown id, and a non-UUID id return 404
  `organisation_not_found` / 400 `invalid_params`; typecheck and build pass.

## Files / areas

- `prisma/schema.prisma`, `prisma/migrations/<ts>_app_role_grants/`,
  `prisma/migrations/<ts>_organisations/`
- `src/tenancy.ts` (new), `src/db.ts` (unchanged unless the `Db` type needs a
  tenant-transaction alias)
- `src/organisations/` - `organisations.routes.ts`, `.controller.ts`,
  `.service.ts`, `.model.ts`, `.validation.ts`, `.middleware.ts`
- `src/app.ts` (mount the router), `src/auth/auth.middleware.ts` (reuse
  `requireAuth`, `currentAuth`)
- `.env.example`, `blueprint/context/coding-standards.md` (record the tenancy
  helper rule)

## Data / contracts

**Enums**

- `OrganisationType`: `cooperative`, `business`, `informal`
- `MoneyMode`: `gateway`, `ledger` (default `ledger`; plan: ledger-only until
  rails connect)
- `OrgRole`: `owner`, `admin`, `treasurer`, `branch_manager`, `field_officer`
- `MembershipStatus`: `active` (2b adds invite statuses)

**Models** (camelCase fields, snake_case columns and tables)

- `Organisation` (`organisations`) - `id` uuid PK (generated in the app),
  `name` text, `type` OrganisationType, `contactEmail` text nullable
  (optional), `contactPhone` text (E.164, required), `moneyMode` MoneyMode default `ledger`, `createdAt`
  timestamptz default now. Later features add `provider`, `kybStatus`,
  `onboardingStep`, `branding`, `policy`.
- `OrgMembership` (`org_memberships`) - `id` uuid PK, `organisationId` FK ->
  Organisation, `userId` FK -> User, `role` OrgRole, `status`
  MembershipStatus default `active`, `createdAt`. Unique (`organisationId`,
  `userId`); index (`userId`).

**RLS** (both tables `ENABLE ROW LEVEL SECURITY`; the app role is not the
owner, so `FORCE` is not needed)

- Settings read with `NULLIF(current_setting('app.organisation_id', true),
  '')::uuid` and the same for `app.user_id`, so a missing setting means no
  rows, never an error.
- `organisations`: SELECT where `id = org` OR the id has an active membership
  for `user`; INSERT and UPDATE only where `id = org`; no DELETE policy.
- `org_memberships`: SELECT where `organisation_id = org` OR `user_id =
  user`; INSERT and UPDATE only where `organisation_id = org`; no DELETE
  policy.
- Platform tables (`users`, `otp_challenges`, `sessions`, `auth_events`) stay
  without RLS.

**Tenancy rules**

- Tenant queries always go through `withOrg` or `withUser`; the organisation
  id comes from the URL and is accepted only after `requireOrgMember` finds
  an active membership for the session's user. The user id always comes from
  the session, never the client.
- `withOrg` sets both settings in the same transaction as the queries,
  because Neon's pooler is in transaction mode.
- Creating an organisation: the service generates the uuid, opens
  `withOrg(newId, userId)`, inserts the organisation, then the Owner
  membership, so both pass the INSERT policies and `RETURNING` passes the
  SELECT policy.

**Validation** (zod, at the controller)

- `name`: trimmed, 1 to 120 characters
- `type`: one of `OrganisationType`
- `contactEmail`: optional (user decision, 2026-10-28); when present a valid
  email, trimmed, lowercased, at most 254 characters; empty string counts as
  absent and is stored as null
- `contactPhone`: required; Nigerian mobile, normalised with `normalizePhone` (same
  rule as sign-in); invalid gives 400 `invalid_phone`
- `orgId` path param: UUID, else 400 `invalid_params`

**Endpoints** (all behind `requireAuth`; POST also behind the global Origin
check)

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/organisations` | `{ "name", "type", "contactPhone", "contactEmail"? }` | 201 `{ "organisation": { "id", "name", "type", "contactEmail", "contactPhone", "moneyMode", "createdAt" }, "role": "owner" }` |
| GET | `/organisations` | none | 200 `{ "organisations": [{ "id", "name", "type", "role" }] }` |
| GET | `/organisations/:orgId` | none | 200 `{ "organisation": {...}, "role": "<my role>" }` |

Error codes: `invalid_body` 400, `invalid_phone` 400, `invalid_params` 400,
`unauthenticated` 401, `bad_origin` 403, `organisation_not_found` 404 (not a
member, unknown, or not active; all look the same).

**Env**: `DATABASE_URL` now points at `savecircle_app` (pooled);
`DIRECT_URL` stays on the owner role for migrations.

## Testing

No test runner is configured. Each step is verified with typecheck and real
requests or scratch scripts against Neon under the app role, with test rows
removed afterwards. Step 3's isolation script is the key evidence and is
rerun after steps 4 and 5.

## Notes for the AI

- Evidence on 2026-10-28: the app currently connects as `neondb_owner` with
  `rolbypassrls = true` and membership in `neon_superuser`, so RLS would be
  silently ignored. Step 1 fixes this before any RLS work.
- SQL for the user to run once in the Neon SQL editor (owner role), with
  their own password:
  `CREATE ROLE savecircle_app WITH LOGIN PASSWORD '<password>' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;`
  Never put the password in a migration, commit, or log. Every Neon branch
  used later (for example production) needs the same role created.
- The test-data cleanup at the end of each check runs through the owner
  connection (`DIRECT_URL`), because the app role has no DELETE policy on the
  tenant tables.
- Platform-level auth tables keep working under the new role through the
  grants; rerun the auth regression in step 1.
- Decisions (2026-10-28): organisation context is in the URL
  (`/organisations/:orgId/...`), not on the session; staff invites are by
  phone and accepted after sign-in (2b); Owner and Admin manage staff and
  settings (2b, 2c).
- `contactPhone` uses the Nigerian-mobile rule for now; a landline would be
  rejected. Revisit if a customer needs one.
- No limit on how many organisations one user creates; revisit if abused.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":11536,"specSha256":"b4474bd443f073b4dcbd8e9f53e61b1d5ae559388f6080ee154be893d8c2ba89","branch":"refs/heads/feature/organisations-and-isolation","head":"d87f97345e217ac78a63a140f643f043747c6256","baseRef":"refs/heads/main","baseCommit":"314b022e3f9f0beadf58a2837815b96cf629e498","sourceTree":"956776d2669433d091d3e6c31293e65b86838b1e","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** d87f97345e217ac78a63a140f643f043747c6256
**Base commit:** 314b022e3f9f0beadf58a2837815b96cf629e498
**Base ref:** main
**Spec hash:** b4474bd443f073b4dcbd8e9f53e61b1d5ae559388f6080ee154be893d8c2ba89
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-10-29T09:11:36Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-29T09:18:31Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Handoff

Review the active spec and the complete `314b022e3f9f0beadf58a2837815b96cf629e498..d87f97345e217ac78a63a140f643f043747c6256` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

### Commands

- `git rev-parse HEAD`, `git merge-base main HEAD`, `sha256sum blueprint/context/current-feature.md`, `git status --porcelain --untracked-files=all`: pass (HEAD, merge base, and spec hash match the request; only `blueprint/context/review.md` differs from the target; spec is tracked)
- `git diff 314b022..d87f973` (full delta, 17 files): reviewed
- `npm run typecheck`: pass
- Read-only catalog queries through `DATABASE_URL` inside `BEGIN READ ONLY` ... `ROLLBACK` (pg_roles, pg_auth_members, pg_class, information_schema.table_privileges, pg_policies, pg_proc, pg_default_acl, row counts with no context): pass

### Evidence

- Live role: `current_user = savecircle_app`, `rolsuper = false`, `rolbypassrls = false`, no CREATEROLE/CREATEDB, no role memberships; no CREATE on schema `public`; no privileges on `_prisma_migrations`
- Grants: SELECT/INSERT/UPDATE/DELETE only (no TRUNCATE, REFERENCES, TRIGGER) on the six app tables; default ACL for `neondb_owner` tables grants `arwd` to `savecircle_app`
- RLS: `relrowsecurity` true on `organisations` and `org_memberships`, false on platform tables; six policies (SELECT/INSERT/UPDATE per table, no DELETE) match the migration; both tables owned by `neondb_owner`, so no FORCE needed; with no context both tables return 0 rows
- Helper functions are SECURITY INVOKER, STABLE, and use `NULLIF(current_setting(..., true), '')::uuid`, so unset or reset settings yield NULL and no rows; `organisations_select` references `org_memberships`, whose policy does not reference `organisations`, so no recursion
- INSERT ... RETURNING in organisation creation passes both WITH CHECK and SELECT policies because the app-generated id is the org context; FK checks are unaffected by RLS
- `src/tenancy.ts` sets both settings with `set_config(..., true)` as the first statement of an interactive transaction, parameterised via tagged `$executeRaw`, so values cannot leak across PgBouncer transaction-mode connections
- `requireOrgMember` runs after `requireAuth`, takes the user id from the session, validates `orgId` as UUID (400 `invalid_params`), and returns one 404 `organisation_not_found` for unknown, non-member, and inactive; the only unchecked `withOrg` uses a server-generated `randomUUID()`
- Responses are allow-listed (`organisationFields`; list returns id, name, type, role); validation matches the spec (name 1-120 trimmed, enum type, optional normalised email, phone via `requirePhone` giving `invalid_phone`); POST is behind the global `checkOrigin`
- Layering follows Model-Service-Controller-Route apart from F-11

### Findings

- F-11 [P3] open - requireOrgMember opens its own tenant transaction instead of the service (src/organisations/organisations.middleware.ts:23)
- F-10 [P3] open is carried over from feature 1, outside this delta, and unchanged

### Remaining risk

- No test runner is configured (test gate off per coding standards), so there is no automated regression coverage for the RLS isolation; the step 3 isolation script is not committed and was not rerun by this reviewer (it writes rows)
- `npm run build`, `npx prisma migrate status`, the dev server, and live HTTP requests were not run (out of the reviewer's permitted read-only scope); Check was not required
- By spec design, inside `withOrg(A, u)` the SELECT policies also expose other organisations and memberships belonging to `u`, and the membership INSERT/UPDATE policies do not constrain `user_id` or `role`; isolation therefore relies on `requireOrgMember` being attached to every future `/organisations/:orgId/...` route (it is currently attached per route, not via `router.use`) and on 2b adding application-level role checks
- `GET /organisations` is unpaginated; acceptable at current per-user organisation counts (spec notes no creation limit)
- The `savecircle_app` role and its grants must be recreated on every other Neon branch (for example production) before `db:deploy`; the grants migration fails if the role does not exist

# Feature: Staff invites and roles

**From build-plan:** feature 2b
**Build attempt:** 1
**Branch:** feature/staff-invites-and-roles
**Status:** verified

## Goal

An organisation's Owner or Admin can invite a staff member by phone with a
role, see and revoke pending invites, list current staff, change a staff
member's role, and remove staff. The invitee gets an SMS notice and, after
signing in (or signing up) with that phone, sees the invite and accepts or
declines it. Invites expire after 7 days. Nobody can invite anyone as Owner or
promote anyone to Owner.

## In scope

- `StaffInvite` tenant table under RLS, readable by the inviting organisation
  and by the signed-in user whose phone it was sent to
- `MembershipStatus` gains `removed` (staff are removed by status, never
  deleted)
- Org side, Owner or Admin only: create invite (with SMS notice), list pending
  invites, revoke an invite, list staff, change a role, remove a staff member
- Invitee side, any signed-in user: list my pending invites, accept, decline
- `requireOrgRole(...roles)` middleware for role-gated org routes
- Finding F-11: `findActiveMembership` opens its own `withUser`, and
  `requireOrgMember` is attached once for the whole `/organisations/:orgId`
  subtree

## Out of scope

- Per-organisation session lifetime and the organisation `policy` field (2c)
- Ownership transfer, and any change to or removal of the Owner's membership
- Leaving an organisation as a self-service action (an Admin removing their
  own membership through the remove endpoint is allowed, nothing more)
- Branches and branch-scoped staff (32); `branch_manager` is assignable now
  but has no branch yet
- Re-sending an invite SMS (revoke and invite again instead)
- Member invites and PINs (15); the overview's `Invite` model is that feature's
  member invite, not this table
- `AuditLog` and AuthEvent rows for staff changes (not required by the plan
  for staff management; AuditLog arrives with approvals)
- Revoking a removed user's sessions (sessions are platform-wide; removal
  cuts organisation access immediately through `requireOrgMember`)
- Per-organisation SMS limits on invites
- Notifier/BullMQ (12); the notice uses the existing `sendSms` directly

## Build loop

`workflow.stepReview` is `every`: implement one step, stop, and wait for
approval before the next. `checkpointCommits` is `disabled`; `/complete` makes
the single feature commit.

Per the user's working style: after each step, explain every line written in
the chat; keep inline code comments sparse. After the last step, give a "Test
it" section with method, route, and JSON body for every endpoint, including
error cases.

Follow the Model - Service - Controller - Route layering, the tenancy rules,
and `axios`-only outbound calls from `coding-standards.md`.

## Build steps

- [x] 1. **Org-scoped router, role guard, and F-11.** In
  `organisations.service.ts`, `findActiveMembership(organisationId, userId)`
  opens `withUser` itself (drop the `tx` parameter);
  `requireOrgMember` calls it without importing `withUser`. Add
  `requireOrgRole(...roles: OrgRole[])` to `organisations.middleware.ts`: it
  reads `currentOrg(res)` and throws 403 `forbidden` when the caller's role is
  not listed. In `organisations.routes.ts`, create one org-scoped router
  (`Router({ mergeParams: true })`) mounted with
  `organisationsRouter.use("/:orgId", requireAuth, requireOrgMember, orgScopedRouter)`;
  move `GET /:orgId` onto it as `GET /`. Mark F-11 `fixed` in findings.md.
  **Done when:** `GET /organisations/:orgId` still returns 200 for a member,
  404 `organisation_not_found` for a non-member or unknown id, 400
  `invalid_params` for a non-UUID, 401 with no cookie; `POST` and `GET
  /organisations` unchanged; typecheck passes.
- [x] 2. **Invite schema with RLS.** Add `removed` to `MembershipStatus` and
  the `StaffInvite` model (see Data). Create the migration with
  `--create-only`, then add by hand: the `app_current_phone()` function, RLS
  on `staff_invites` with its policies, and the widened `organisations_select`
  policy (drop and recreate). Apply it.
  **Done when:** migrate status is in sync; `relrowsecurity` is true for
  `staff_invites`; `pg_policies` lists the new policies; a scratch script as
  `savecircle_app` shows: `withOrg(A)` sees A's invites only; `withUser(u)`
  sees only pending invites for u's phone plus the inviting organisation's
  row, and stops seeing that organisation once the invite is revoked or
  expired; `withUser(u)` cannot insert or update an invite; seed rows are
  removed afterwards; typecheck passes.
- [x] 3. **Create, list, and revoke invites (org side).** New `src/staff/`
  folder (`staff.routes.ts`, `.controller.ts`, `.service.ts`, `.model.ts`,
  `.validation.ts`). Routes on the org-scoped router, all behind
  `requireOrgRole("owner", "admin")`: `POST /invites`, `GET /invites`,
  `DELETE /invites/:inviteId`. Create runs in `withOrg`, takes the advisory
  lock, rejects an active member or a pending invite for that phone, inserts,
  commits, then sends the SMS notice (see Data).
  **Done when:** Owner and Admin get 201 with `notified` (false with Termii
  blank); a treasurer or field officer gets 403 `forbidden`; `role: "owner"`
  or an unknown role gives 400 `invalid_body`; a bad phone gives 400
  `invalid_phone`; an existing active member's phone gives 409
  `already_member`; a second invite to the same pending phone gives 409
  `invite_pending`; the list shows only pending invites, newest first;
  revoking a pending invite gives 204 and drops it from the list; revoking it
  again, or an accepted, declined, or expired one, gives 409
  `invite_not_pending`; an unknown or other organisation's invite id gives 404
  `invite_not_found`; typecheck passes.
- [x] 4. **Invitee: list, accept, decline.** `invitesRouter` mounted at
  `/invites` behind `requireAuth`: `GET /invites`, `POST
  /invites/:inviteId/accept`, `POST /invites/:inviteId/decline`. Accept and
  decline find the invite with `withUser` (matched by the session user's
  phone), then run the conditional update and membership write in
  `withOrg(invite.organisationId, userId)`.
  **Done when:** a user signed up with the invited phone sees the invite with
  the organisation name, role, inviter name, and expiry; accepting returns
  200, the organisation appears in `GET /organisations` with that role, and
  `GET /organisations/:orgId` returns 200; a previously removed member who
  accepts is active again with the new role; declining returns 204 and the
  invite disappears from both lists; accepting or declining a revoked,
  expired, accepted, declined, or someone else's invite gives 404
  `invite_not_found`; accepting while already an active member gives 409
  `already_member` and leaves the invite pending; typecheck passes.
- [x] 5. **Staff list, change role, remove.** On the org-scoped router behind
  `requireOrgRole("owner", "admin")`: `GET /staff`, `PATCH
  /staff/:membershipId`, `DELETE /staff/:membershipId`. Both writes are one
  conditional update (active, same organisation, not `owner`).
  **Done when:** the list shows active staff with name, phone, and role,
  Owner first then oldest first; changing a role returns 200 with the new
  role and the user's `GET /organisations` reflects it; removing returns 204,
  the user drops from the staff list and from their `GET /organisations`,
  and their `GET /organisations/:orgId` now gives 404; targeting the Owner
  gives 409 `owner_protected`; `role: "owner"` gives 400 `invalid_body`; an
  unknown, removed, or other organisation's membership id gives 404
  `staff_not_found`; a non-admin gives 403; typecheck and build pass.

## Files / areas

- `prisma/schema.prisma`, `prisma/migrations/<ts>_staff_invites/`
- `src/organisations/organisations.routes.ts`, `.middleware.ts`,
  `.service.ts` (F-11, org-scoped router, `requireOrgRole`)
- `src/staff/` - `staff.routes.ts`, `.controller.ts`, `.service.ts`,
  `.model.ts`, `.validation.ts` (new)
- `src/app.ts` (mount `/invites`)
- `src/termii.ts` (reuse `sendSms`, `termiiConfigured`),
  `src/auth/auth.validation.ts` (reuse `requirePhone`),
  `src/auth/auth.middleware.ts` (reuse `requireAuth`, `currentAuth`)
- `blueprint/context/findings.md` (F-11 to `fixed`)

## Data / contracts

**Enums**

- `MembershipStatus`: `active`, `removed` (added with `ALTER TYPE ... ADD
  VALUE`)
- Assignable roles (invite and role change): `admin`, `treasurer`,
  `branch_manager`, `field_officer`. `owner` is never accepted from a client.

**Model** `StaffInvite` (`staff_invites`)

- `id` uuid PK default `uuid()`
- `organisationId` uuid FK -> Organisation
- `phoneNumber` text, E.164 (normalised with `requirePhone`)
- `role` OrgRole (never `owner`, enforced in validation)
- `invitedBy` uuid FK -> User (from the session)
- `expiresAt` timestamptz(3) = creation time + 7 days (`INVITE_TTL_DAYS = 7`)
- `acceptedAt?`, `declinedAt?`, `revokedAt?` timestamptz(3)
- `createdAt` timestamptz(3) default now
- Indexes: (`organisationId`, `phoneNumber`), (`phoneNumber`)
- **Pending** means `acceptedAt`, `declinedAt`, and `revokedAt` all null and
  `expiresAt > now()`. Status is derived, never stored. At most one of the
  three timestamps is ever set.

**RLS (hand-written in the migration)**

- `app_current_phone()` SQL STABLE: `SELECT phone_number FROM users WHERE id
  = app_current_user()` (users has no RLS; the app role can read it)
- `staff_invites`: ENABLE RLS. SELECT where `organisation_id =
  app_current_org()` OR (`phone_number = app_current_phone()` and pending).
  INSERT and UPDATE only where `organisation_id = app_current_org()`. No
  DELETE policy.
- `organisations_select` widened: also visible when a pending
  `staff_invites` row for that organisation has `phone_number =
  app_current_phone()` (so the invitee can read its name). The API still
  returns only `id` and `name` to invitees.

**Tenancy and concurrency rules**

- Org-side routes: organisation id from the URL after `requireOrgMember`;
  `requireOrgRole("owner", "admin")`; queries in `withOrg`.
- Invite create: in one `withOrg` transaction, `pg_advisory_xact_lock` keyed
  on `hashtext(organisationId || phoneNumber)`, then reject 409
  `already_member` if a user with that phone has an `active` membership
  here, then reject 409 `invite_pending` if a pending invite exists, then
  insert. The SMS is sent after commit.
- Invitee routes: user id and phone from the session only. Accept and
  decline: `withUser` reads the invite by id (RLS already limits it to the
  caller's pending invites; missing gives 404 `invite_not_found`), then
  `withOrg(invite.organisationId, userId)` runs `updateMany` with `id`,
  `organisationId`, `phoneNumber = session phone`, pending conditions, and
  sets `acceptedAt` or `declinedAt`. A count of 0 gives 404
  `invite_not_found`. This `withOrg` without a membership check is allowed
  because the pending invite for the caller's phone is the authority; note it
  beside the existing exception in `organisations.service.ts`.
- Accept membership write, same transaction: no membership -> create with the
  invite role; `removed` membership -> set `active` and the invite role;
  `active` membership -> throw 409 `already_member` (rolls back, invite stays
  pending).
- Revoke: `updateMany` on id + organisation + pending sets `revokedAt`; count
  0 then a plain lookup decides 404 `invite_not_found` vs 409
  `invite_not_pending`.
- Role change and remove: `updateMany` where `id`, `organisationId`, `status
  = active`, `role <> owner`; count 0 then a lookup decides 404
  `staff_not_found` (missing or removed) vs 409 `owner_protected`.

**SMS notice**

- Text: `<inviter name> invited you to join <organisation name> on SaveCircle
  as <Role label>. Sign in to SaveCircle with this number to accept. The
  invite expires in 7 days.` Role labels: Admin, Treasurer, Branch manager,
  Field officer.
- Sent only when `termiiConfigured`. A Termii failure is logged (the plain
  error from `sendSms`) and does not undo the invite; the response then says
  `notified: false`. The invite is visible to the invitee on sign-in either
  way.

**Validation** (zod, at the controller)

- `phone`: string max 32, normalised with `requirePhone` (400 `invalid_phone`)
- `role`: one of the assignable roles (else 400 `invalid_body`)
- `orgId`, `inviteId`, `membershipId` params: UUID (else 400
  `invalid_params`)

**Endpoints**

Org side (`requireAuth`, `requireOrgMember`, `requireOrgRole("owner",
"admin")`; writes behind the global Origin check):

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/organisations/:orgId/invites` | `{ "phone", "role" }` | 201 `{ "invite": { "id", "phoneNumber", "role", "expiresAt", "createdAt" }, "notified": boolean }` |
| GET | `/organisations/:orgId/invites` | none | 200 `{ "invites": [{ "id", "phoneNumber", "role", "invitedBy": { "name" }, "expiresAt", "createdAt" }] }` pending only, newest first |
| DELETE | `/organisations/:orgId/invites/:inviteId` | none | 204 |
| GET | `/organisations/:orgId/staff` | none | 200 `{ "staff": [{ "membershipId", "name", "phoneNumber", "role", "joinedAt" }] }` active only, Owner first then oldest first |
| PATCH | `/organisations/:orgId/staff/:membershipId` | `{ "role" }` | 200 `{ "membershipId", "role" }` |
| DELETE | `/organisations/:orgId/staff/:membershipId` | none | 204 |

Invitee side (`requireAuth`):

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/invites` | none | 200 `{ "invites": [{ "id", "organisation": { "id", "name" }, "role", "invitedBy": { "name" }, "expiresAt" }] }` pending only, newest first |
| POST | `/invites/:inviteId/accept` | none | 200 `{ "organisation": { "id", "name" }, "role" }` |
| POST | `/invites/:inviteId/decline` | none | 204 |

Error codes: `invalid_body` 400, `invalid_phone` 400, `invalid_params` 400,
`unauthenticated` 401, `bad_origin` 403, `forbidden` 403 (member without the
role), `organisation_not_found` 404 (non-member), `invite_not_found` 404,
`staff_not_found` 404, `already_member` 409, `invite_pending` 409,
`invite_not_pending` 409, `owner_protected` 409.

## Testing

No test runner is configured. Each step is verified with typecheck and
throwaway tsx scripts in the session scratchpad against Neon under the app
role (the local testing harness: Termii blank so no real SMS, test phones
`+23480300002xx`, distinct `x-forwarded-for` per scenario). Cleanup runs
through the owner connection (`DIRECT_URL`) in FK order: staff_invites,
org_memberships, organisations, sessions, auth_events, users, otp_challenges.
Step 2's RLS script is rerun after steps 4 and 5. Expiry is tested by
setting a seed invite's `expiresAt` in the past through the owner
connection.

## Notes for the AI

- Decisions recorded in this spec (2026-10-29), open to the user's change at
  review:
  - Invites live in their own `staff_invites` table, not as a membership
    status, because the invitee may have no user row yet. The 2a note "2b adds
    invite statuses" becomes `removed` only.
  - The Owner's membership cannot be changed or removed by anyone, and no
    other membership can become `owner`, so an organisation always keeps its
    single Owner. Ownership transfer is out of scope.
  - Admins may invite, re-role, and remove other Admins (plan: Admin has full
    access to staff). Changing or removing your own non-Owner membership is
    not blocked.
  - Staff and invite lists are Owner and Admin only.
  - The SMS notice is best-effort and reported as `notified`.
- `AuthContext.user` already carries `phoneNumber` and `name`; use them for
  the invitee match and the SMS inviter name.
- Organisation and inviter names are user-controlled text; they go into a
  plain-text SMS and JSON only. The separate frontend must render them as
  text.
- `ALTER TYPE ... ADD VALUE` is fine inside Prisma's migration transaction as
  long as the migration does not use `removed` itself.
- `requireOrgMember` only admits `active` memberships, so removal takes effect
  on the next request without touching sessions.
- Found in step 2 (2026-10-30): `npm run db:migrate` (`migrate dev`) fails
  with `relation "_prisma_migrations" does not exist`, because the shadow
  database replays `app_role_grants`, whose `REVOKE ... ON "_prisma_migrations"`
  has no table there. Applied migrations must not be edited, so this
  migration was generated with `prisma migrate diff --from-config-datasource
  --to-schema prisma/schema.prisma --script`, written by hand with its RLS
  section, and applied with `prisma migrate deploy`. A permanent fix belongs
  in a separate `/fix`.
- Any admin can make SMS go to any Nigerian number, bounded by one pending
  invite per phone per organisation. Revisit with a limit if abused.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":16766,"specSha256":"b317b0af77cc39a6587872c42f0796ccde27f6a1a36f1652ceefb901572309db","branch":"refs/heads/feature/staff-invites-and-roles","head":"3b3aa4ba8fc25f8aa151c1b5f77c1846f981610f","baseRef":"refs/heads/main","baseCommit":"1672bde09abb8965742aa9a6959bb4bd3eec150c","sourceTree":"49bc0d3368e6f6aa28ef1ce0abc3dc432954ec17","absentOptional":[]} -->

## Findings

### 2b/F-11 [P3] closed - requireOrgMember opens its own tenant transaction instead of the service

**File:** src/organisations/organisations.middleware.ts:23
**Found:** 2026-10-29 by /audit independent (scope: current; lens: quality)
**Why it matters:** The coding standards put transactions in the service layer, and the other two read paths (`listOrganisations`, `getOrganisation`) open `withUser`/`withOrg` inside the service. The middleware instead calls `withUser` itself and passes `tx` to `orgService.findActiveMembership` (src/organisations/organisations.service.ts:37), which is a one-line pass-through to the model that exists only to carry the transaction client. Two patterns for the same thing make it easier for later org-scoped code to pick the wrong one. No behaviour or isolation defect: the membership lookup is correctly scoped by the session user under RLS.
**Suggested fix:** Make the service function `findActiveMembership(organisationId, userId)` open `withUser` itself and drop the `tx` parameter; the middleware then calls it without importing `withUser`. Nothing is deleted beyond the pass-through signature; no current requirement is lost.
**Resolution:** Fixed in 2b step 1 (2026-10-30): `findActiveMembership(organisationId, userId)` opens `withUser` in the service; `requireOrgMember` no longer imports `withUser` and is attached once via `organisationsRouter.use("/:orgId", requireAuth, requireOrgMember, orgScopedRouter)`. Closed 2026-11-02 by /audit independent (fresh subagent, 1672bde..3b3aa4b): re-examined src/organisations/organisations.service.ts:35-37 and src/organisations/organisations.middleware.ts:20-27; the service owns the `withUser` transaction, the middleware has no tenancy import, the lookup is still scoped by session user and `status: "active"`, and the org-scoped router puts every `/:orgId` route behind it. No new defect from the repair.

## Independent review

**Status:** passed
**Target commit:** 3b3aa4ba8fc25f8aa151c1b5f77c1846f981610f
**Base commit:** 1672bde09abb8965742aa9a6959bb4bd3eec150c
**Base ref:** refs/remotes/origin/main
**Spec hash:** b317b0af77cc39a6587872c42f0796ccde27f6a1a36f1652ceefb901572309db
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-02T09:51:05Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-02T09:58:17Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Handoff

Review the active spec and the complete `1672bde09abb8965742aa9a6959bb4bd3eec150c..3b3aa4ba8fc25f8aa151c1b5f77c1846f981610f` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

## Commands

- `git rev-parse HEAD`, `git merge-base refs/remotes/origin/main HEAD`, `sha256sum blueprint/context/current-feature.md`, `git status --porcelain --untracked-files=all`: pass (HEAD, merge base, and spec hash match the request; only review.md differed from the target)
- `npm run typecheck`: pass
- `npm run build`: pass
- Test command: unavailable (none configured)
- Lint command: unavailable (none configured)
- Verify command: unavailable (none configured)

## Evidence

- Full delta reviewed: prisma/migrations/20261030090000_staff_invites/migration.sql, prisma/schema.prisma, src/app.ts, src/organisations/organisations.{middleware,routes,service}.ts, src/staff/*.ts, blueprint/config.json, blueprint/context/current-feature.md; dependencies read: src/tenancy.ts, 20261028141424_organisations and 20261028124943_app_role_grants migrations, organisations.model.ts, auth.validation.ts, auth.middleware.ts, auth.service.ts (users created only after OTP verify; phone_number unique), termii.ts, errors.ts, validate.ts, coding-standards.md tenancy rules.
- RLS: staff_invites has ENABLE RLS with SELECT (org or caller's phone while pending), INSERT/UPDATE on app_current_org(), no DELETE; widened organisations_select has no policy recursion (staff_invites and org_memberships policies do not reference organisations); default privileges grant the new table to savecircle_app.
- Unchecked withOrg in accept/decline: organisation id comes only from a withUser read limited by RLS and an explicit phoneNumber filter to the caller's pending invite; the withOrg update re-checks id, organisation, session phone, and pending, and membership writes happen only after count = 1, so a caller cannot pick an arbitrary organisation context.
- Authorization: every /organisations/:orgId route is behind requireAuth + requireOrgMember via the org-scoped router; staff routes add requireOrgRole("owner","admin"); owner is rejected by z.enum(ASSIGNABLE_ROLES) for invite and role change; role change and remove use one conditional updateMany excluding role owner and non-active rows.
- Concurrency: invite create serialised per (org, phone) by pg_advisory_xact_lock; accept/decline/revoke races resolved by conditional single-row updates under READ COMMITTED re-evaluation; duplicate memberships prevented by the (organisation_id, user_id) unique index; already_member on accept rolls back and leaves the invite pending.
- Data exposure: responses select only the spec's fields (invitee sees organisation id/name and inviter name only); SMS is sent after commit and Termii errors are logged without the request body.
- F-11 re-examined and closed.

## Findings

- F-12 [P3] open: stale "the one withOrg call with no membership check" comment in src/organisations/organisations.service.ts:19 (non-blocking)
- F-11 [P3] closed
- F-10 [P3] open, carried forward from earlier work, not in this delta (non-blocking)

## Remaining risk

- No test runner, lint, or Verify command is configured; behaviour was not executed in this review (Check not required), only typecheck and build ran. RLS policies and runtime behaviour rely on the builder's scratch-script verification recorded in the spec.
- Invite SMS sends are not counted against the platform-wide daily SMS cap; any signed-in user can create organisations and text invites to arbitrary numbers, bounded only by one pending invite per phone per organisation. The spec accepts this and defers limits.
- Benign race, not a finding: an invite created while an earlier invite for the same phone is being accepted can leave a pending invite for a now-active member (accepting it returns 409 already_member until it expires or is revoked).
- Org-side staff and invite lists are unpaginated; acceptable at pilot staff counts, unverified at scale.
- blueprint/config.json moves stepReview from every to feature while the spec's Build loop text still says every; workflow wording only, no code impact.

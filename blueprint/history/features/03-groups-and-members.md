# Feature: Groups and members

**From build-plan:** feature 3
**Build attempt:** 1
**Branch:** feature/groups-and-members
**Status:** verified

## Goal

Staff create rotating and thrift groups with an amount, frequency, reminder
schedule, and (thrift only) a start date; add members by name and phone, one at
a time or as a CSV file, each getting the next join order; and assign field
officers to groups. Field officers see and manage only their assigned groups.

## In scope

- `Group`, `Member`, `GroupOfficer` tenant tables under RLS
- Create, list, and view groups
- Add one member; import members from CSV (all-or-nothing)
- Assign and unassign field officers
- Group visibility by role (see Data)

## Out of scope

- Rotations, slots, cycles, start, first due date (4); thrift cycle creation
  and rollover, pause, close (9, 11)
- Editing a group or member, removing or deactivating members (10)
- Member invites and PIN access (15); member verification and account numbers
  (18)
- Branches and branch-scoped groups (32): no `branch_id` column yet
- Group withdrawal policy override (24): no `withdrawal_policy` column yet
- AuditLog

## Build loop

Autopilot run: build all steps without pausing, then one review packet.
`checkpointCommits` is `disabled`. Model - Service - Controller - Route
layering and the tenancy rules from `coding-standards.md` apply. New code goes
in `src/groups/`.

## Build steps

- [x] 1. **Schema with RLS.** Enums `GroupType`, `Frequency`, `GroupStatus`,
  `MemberStatus`; models `Group`, `Member`, `GroupOfficer` (see Data).
  `npm run db:migrate -- --create-only`, add RLS and policies by hand, then
  apply with `npm run db:migrate`.
  **Done when:** migration applies; RLS on all three tables with SELECT,
  INSERT, UPDATE policies on `app_current_org()`; migrate status in sync;
  typecheck passes.
- [x] 2. **Create, list, view groups.** `POST /groups`, `GET /groups`,
  `GET /groups/:groupId` under the org-scoped router, with the role rules.
  **Done when:** valid rotating and thrift bodies return 201; a field officer
  who creates a group is assigned to it; invalid bodies give 400
  `invalid_body` (thrift without `startDate`, rotating with one, a past
  `startDate`, bad offsets, amount 0 or fractional, unknown frequency); a
  treasurer creating gives 403; the list and view follow the visibility rules;
  an unassigned field officer, another organisation's group, or an unknown id
  gives 404 `group_not_found`; typecheck passes.
- [x] 3. **Officers.** `POST /groups/:groupId/officers` and `DELETE
  /groups/:groupId/officers/:userId`, Owner or Admin only.
  **Done when:** assigning an active field officer returns 201 and the officer
  then sees the group; assigning twice gives 409 `officer_already_assigned`;
  assigning a non-member, a removed member, or a non-field-officer gives 400
  `not_a_field_officer`; unassigning returns 204 and the officer loses the
  group (404); unassigning someone not assigned gives 404
  `officer_not_assigned`; typecheck passes.
- [x] 4. **Add one member.** `POST /groups/:groupId/members`.
  **Done when:** returns 201 with `joinOrder` 1, then 2; a duplicate phone in
  the group gives 409 `member_exists`; a bad phone gives 400 `invalid_phone`;
  an unassigned field officer gives 404; a treasurer gives 403; parallel adds
  get distinct consecutive join orders; the group view lists members by join
  order; typecheck passes.
- [x] 5. **CSV import.** `POST /groups/:groupId/members/import` with
  `Content-Type: text/csv`.
  **Done when:** a valid file returns 201 with every member in file order and
  consecutive join orders after existing members; any bad row (missing name,
  bad phone, duplicate in file or in group) gives 400 `invalid_csv` with
  per-row errors and adds nobody; a missing or wrong header, an empty file, or
  more than 500 rows gives 400 `invalid_csv`; a non-CSV content type gives 415
  `unsupported_media_type`; quoted names with commas parse; typecheck and
  build pass.

## Files / areas

- `prisma/schema.prisma`, `prisma/migrations/<ts>_groups_and_members/`
- `src/groups/` - `groups.routes.ts`, `.controller.ts`, `.service.ts`,
  `.model.ts`, `.validation.ts`, `csv.ts` (small parser)
- `src/organisations/organisations.routes.ts` (mount on the org-scoped router)
- `src/errors.ts` (`AppError` gains optional `details`, sent beside `code` and
  `message`, for the CSV row errors)

## Data / contracts

**Enums**

- `GroupType`: `rotating`, `fixed` (thrift; the overview's locked name)
- `Frequency`: `daily`, `weekly`, `monthly`
- `GroupStatus`: `active`, `paused`, `closed` (only `active` is set here)
- `MemberStatus`: `active`, `inactive` (only `active` is set here)

**Models** (camelCase fields, snake_case tables and columns, all with
`organisation_id`)

- `Group` (`groups`): `id` uuid, `organisationId`, `name` text,
  `type` GroupType, `contributionAmount` int (kobo), `frequency`,
  `startDate` date nullable (required for `fixed`, null for `rotating`),
  `status` default `active`, `reminderOffsets` int[], `createdBy` uuid FK
  User, `createdAt`. Index (`organisationId`, `createdAt`).
- `Member` (`members`): `id` uuid, `organisationId`, `groupId` FK, `name`,
  `phoneNumber` (E.164), `joinOrder` int, `status` default `active`,
  `inactiveFrom` timestamptz nullable, `createdAt`. Unique (`groupId`,
  `phoneNumber`), unique (`groupId`, `joinOrder`), index (`organisationId`,
  `phoneNumber`).
- `GroupOfficer` (`group_officers`): `id`, `organisationId`, `groupId` FK,
  `userId` FK User, `createdAt`. Unique (`groupId`, `userId`).

**RLS:** each table ENABLE RLS with SELECT, INSERT, UPDATE policies on
`organisation_id = app_current_org()`, no DELETE policy except
`group_officers` (unassigning deletes the row). Foreign-key checks ignore RLS,
so the service always loads the group inside `withOrg` before writing a member
or officer row for it.

**Visibility and permissions** (after `requireOrgMember`)

| Role | Create group | See groups | Add members | Assign officers |
|---|---|---|---|---|
| Owner, Admin | yes | all | yes | yes |
| Treasurer, Branch manager | no | all | no | no |
| Field officer | yes (auto-assigned) | assigned only | assigned only | no |

A group the caller cannot see is 404 `group_not_found`, the same as an unknown
id. A visible group the caller cannot change gives 403 `forbidden`.

**Validation**

- Group `name` trimmed 1-80; `type`; `contributionAmount` integer 1 to
  2 000 000 000 kobo; `frequency`.
- `startDate` `YYYY-MM-DD`: required for `fixed`, rejected for `rotating`, not
  before today in Africa/Lagos.
- `reminderOffsets` (days relative to the due date) optional, default
  `[-2, 0, 1]`; must be exactly `[-2, 0, 1]`, `[0]`, or `[-5, -2, 0, 1]`.
- Member `name` trimmed 1-100; `phone` through `requirePhone` (400
  `invalid_phone`).
- Officer body `{ "userId": uuid }`.
- CSV: UTF-8 text, header row `name,phone` (case-insensitive, any order of
  those two columns, extra columns rejected), 1 to 500 data rows, blank lines
  ignored, RFC 4180 quotes supported, body limit 100 kB.

**Join order:** inside the insert transaction, lock the group row (`SELECT ...
FOR UPDATE`), take `max(join_order) + 1`, insert. CSV rows take consecutive
numbers in file order in one transaction.

**Endpoints** (all under `/organisations/:orgId`)

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/groups` | `{ name, type, contributionAmount, frequency, startDate?, reminderOffsets? }` | 201 `{ "group": {...} }` |
| GET | `/groups` | none | 200 `{ "groups": [...] }` newest first |
| GET | `/groups/:groupId` | none | 200 `{ "group": {...}, "members": [...], "officers": [{ "userId", "name" }] }` |
| POST | `/groups/:groupId/officers` | `{ userId }` | 201 `{ "officer": { "userId", "name" } }` |
| DELETE | `/groups/:groupId/officers/:userId` | none | 204 |
| POST | `/groups/:groupId/members` | `{ name, phone }` | 201 `{ "member": {...} }` |
| POST | `/groups/:groupId/members/import` | CSV text | 201 `{ "members": [...] }` |

Group fields: `id, name, type, contributionAmount, frequency, startDate
(YYYY-MM-DD or null), status, reminderOffsets, createdAt`. Member fields: `id,
name, phoneNumber, joinOrder, status, createdAt`. CSV errors:
`{ "error": { "code": "invalid_csv", "message", "rows": [{ "line", "message" }] } }`.

## Testing

No test runner. Scratch tsx scripts against Neon under the app role (Termii
blank, Bash only), cleanup through the owner connection in FK order
(group_officers, members, groups, then the existing order). The 2b and 2c
scripts are rerun as regression.

## Notes for the AI

- Decisions recorded (2026-11-04, Autopilot), each reversible and open to
  change at review: frequencies are daily/weekly/monthly; one Member row per
  phone per group (no "double hands" yet); treasurers and branch managers see
  every group until branches exist (32); only `field_officer` users can be
  assigned; CSV is parsed on the server from a `text/csv` body (no upload
  library); contribution amounts are capped at 2 000 000 000 kobo
  (NGN 20 million) per cycle in an int column; thrift cycles are not created
  here (9 creates them).
- Field-officer access is enforced in the service, not RLS: RLS isolates
  organisations, roles are application rules.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":9262,"specSha256":"046558387bd5a683d769cf127defe76c0df66a8260cc71e1ac2114173514bb48","branch":"refs/heads/feature/groups-and-members","head":"0e697577a9581174e8482bec2930c741ee54c37b","baseRef":"refs/heads/main","baseCommit":"48512dffb6b743e59e077d0d2f01f79e525d6521","sourceTree":"67100768a9c988061067ec628d75fbbc724c5844","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** 0e697577a9581174e8482bec2930c741ee54c37b
**Base commit:** 48512dffb6b743e59e077d0d2f01f79e525d6521
**Base ref:** refs/heads/main
**Spec hash:** 046558387bd5a683d769cf127defe76c0df66a8260cc71e1ac2114173514bb48
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-04T10:37:56Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-04T14:08:09Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Handoff

Review the active spec and the complete `48512dffb6b743e59e077d0d2f01f79e525d6521..0e697577a9581174e8482bec2930c741ee54c37b` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

## Commands

- `npm run typecheck`: pass
- `npm run build`: pass
- `node` against the built `dist/groups/groups.validation.js` (no database or network): confirmed F-14

## Evidence

- Freshness verified: HEAD = Target commit; `git merge-base refs/heads/main HEAD` = Base commit; raw SHA-256 of blueprint/context/current-feature.md (tracked) = Spec hash; working tree clean except review.md.
- Reviewed the full delta (11 files): migration 20261104025050_groups_and_members, prisma/schema.prisma, src/errors.ts, src/groups/*, src/organisations/organisations.routes.ts, plus callers and dependencies (tenancy.ts, db.ts, organisations.middleware.ts, app.ts, validate.ts, auth/phone.ts, auth/auth.validation.ts, staff.model.ts pattern, earlier migrations for grants and app_current_org).
- RLS: all three tables enable RLS with SELECT, INSERT, UPDATE on app_current_org(); DELETE only on group_officers; default privileges from app_role_grants cover the new tables.
- Tenant isolation: every write loads the group through findGroup (organisationId filter, under RLS) inside withOrg before inserting members or officers; the officer target is checked as an active field_officer membership in the same organisation; createdBy and organisationId come from the session and membership.
- Visibility matches the spec table: field officers see only assigned groups (list filter and view check give 404); route guards give 403 by role; field-officer creators are auto-assigned.
- Join order: SELECT ... FOR UPDATE on the group row (UPDATE policy present) precedes the duplicate check and max(join_order)+1 in the same READ COMMITTED transaction; unique (group_id, join_order) and (group_id, phone_number) back it up; CSV rows get consecutive numbers in one createManyAndReturn and are sorted for the response.
- CSV: quotes, doubled quotes, embedded commas and newlines, CRLF and lone CR, blank-line filtering with preserved line numbers, unclosed quote, header rules, 1-500 rows, 100 kB text/csv limit, and 415 for other content types all traced; import is all-or-nothing.
- Validation: name/amount/frequency bounds, thrift/rotating startDate rule, Africa/Lagos today comparison, and the three reminder schedules match the spec, except F-14.

## Findings

- F-14 [P2] open - out-of-range startDate month/day throws RangeError, giving 500 instead of 400
- F-15 [P3] open - duplicate, unreachable member-role check in the service
- F-10, F-12, F-13 outside this delta; unchanged

## Remaining risk

- No test runner, lint, or Verify command is configured; unit tests for the CSV parser and group validation are unavailable.
- Check was not required and was not run; no database, server, or Prisma CLI command was run, so migration apply, RLS behaviour under savecircle_app, FOR UPDATE serialisation, and Prisma P2002 mapping through the pg adapter are verified by reading code only.
- GET /groups and the group view are unpaginated; acceptable at pilot scale, unverified at volume.
- group_officers rows are not removed when a field officer is removed or changes role, so a later reinstatement as field officer restores old assignments; the spec does not define this.

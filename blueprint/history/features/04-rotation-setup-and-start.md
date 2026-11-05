# Feature: Rotation setup and start

**From build-plan:** feature 4
**Build attempt:** 1
**Branch:** feature/rotation-setup-and-start
**Status:** verified

## Goal

Every rotating group has a draft rotation whose payout order follows join
order. Staff reorder it until start. Starting it locks the order, takes a first
due date (today or later, default one period ahead), and creates one cycle per
slot, dated by the group's frequency, each snapshotting the group's
contribution amount.

## In scope

- `Rotation`, `RotationSlot`, `Cycle` tenant tables under RLS
- A draft rotation (number 1) created with each rotating group, and a backfill
  for rotating groups that already exist
- New members of a rotating group get the next slot in its draft rotation
- View the group's current rotation with slots and cycles
- Reorder the draft; start it with a first due date

## Out of scope

- Payouts, paid-out status, completion, and new rotations (8)
- Thrift cycles and rollover (9); pause, close, dissolve (11)
- Inactive members, gaps, skip/reassign/hold (10)
- Early-payout ordering by history, guarantors, holdbacks (27)
- Slot columns those features add (`paid_out_at`, `flagged_at`, `resolution`,
  `resolved_by`, `resolved_at`, `guarantor_member_id`, `holdback_amount`,
  `holdback_released_at`) and `RotationPause`
- Removing members from a draft (members cannot be removed yet)

## Build loop

Autopilot run: build all steps without pausing, then one review packet.
`checkpointCommits` is `disabled`. Model - Service - Controller - Route
layering and the tenancy rules from `coding-standards.md` apply. New code goes
in `src/rotations/`; `src/groups/` gains the draft hooks.

## Build steps

- [x] 1. **Schema with RLS and backfill.** Enums `RotationStatus`,
  `SlotStatus`; models `Rotation`, `RotationSlot`, `Cycle` (see Data).
  `npm run db:migrate -- --create-only`, add RLS policies and the backfill by
  hand, then apply with `npm run db:migrate`.
  **Done when:** migration applies; RLS on the three tables with SELECT,
  INSERT, UPDATE policies; every existing rotating group has a draft rotation
  1 whose slots follow its members' join order; migrate status in sync;
  typecheck passes.
- [x] 2. **Draft on create, slots on add, view.** Creating a rotating group
  creates draft rotation 1. Adding or importing members to a rotating group
  appends slots to its draft (positions continue after the last). `GET
  /groups/:groupId/rotation` returns the current rotation.
  **Done when:** a new rotating group shows an empty draft; added and imported
  members appear as slots 1..n in join order; a thrift group gives 404
  `rotation_not_found`; an unassigned field officer gives 404
  `group_not_found`; typecheck passes.
- [x] 3. **Reorder.** `PUT /groups/:groupId/rotation/order` with
  `{ "memberIds": [...] }`.
  **Done when:** a permutation of the draft's members returns 200 with the new
  positions; a missing, extra, unknown, or repeated member gives 400
  `invalid_order`; reordering a started rotation gives 409
  `rotation_not_draft`; a treasurer gives 403; typecheck passes.
- [x] 4. **Start.** `POST /groups/:groupId/rotation/start` with
  `{ "firstDueDate"?: "YYYY-MM-DD" }`.
  **Done when:** start returns 200 with status `active`, `firstDueDate`,
  `startedAt`, and one cycle per slot with `amountDue` equal to the group's
  amount and `payoutPosition` n; omitting `firstDueDate` uses one period after
  today in Lagos; a past or impossible date gives 400 `invalid_body`; fewer
  than 2 slots gives 409 `rotation_too_small`; starting twice (also in
  parallel) gives exactly one 200 and 409 `rotation_not_draft`; daily, weekly,
  and monthly dates are right, including 31 Jan monthly -> 28/29 Feb, 31 Mar,
  30 Apr; reorder after start gives 409; members added after start get no
  slot; typecheck and build pass.

## Files / areas

- `prisma/schema.prisma`, `prisma/migrations/<ts>_rotations/`
- `src/rotations/` - `rotations.routes.ts`, `.controller.ts`, `.service.ts`,
  `.model.ts`, `.validation.ts`, `due-dates.ts`
- `src/groups/groups.service.ts` and `groups.model.ts` (draft on create, slots
  on member add), `groups.routes.ts` is unchanged
- `src/organisations/organisations.routes.ts` (mount)

## Data / contracts

**Enums**

- `RotationStatus`: `draft`, `active`, `paused`, `completed`, `dissolved`
  (only `draft` and `active` are set here)
- `SlotStatus`: `scheduled`, `paid_out`, `gap`, `held`, `skipped` (only
  `scheduled` is set here)

**Models** (all with `organisation_id`, snake_case tables and columns)

- `Rotation` (`rotations`): `id`, `organisationId`, `groupId` FK,
  `rotationNumber` int, `status` default `draft`, `firstDueDate` date
  nullable, `startedAt` timestamptz nullable, `completedAt` timestamptz
  nullable, `createdAt`. Unique (`groupId`, `rotationNumber`).
- `RotationSlot` (`rotation_slots`): `id`, `organisationId`, `rotationId` FK,
  `memberId` FK, `position` int, `status` default `scheduled`, `createdAt`.
  Unique (`rotationId`, `position`), unique (`rotationId`, `memberId`).
- `Cycle` (`cycles`): `id`, `organisationId`, `groupId` FK, `rotationId` FK
  nullable (thrift cycles in 9 have none), `cycleNumber` int, `dueDate` date,
  `amountDue` int (kobo), `payoutSlotId` FK nullable, `cancelledAt`
  timestamptz nullable, `createdAt`. Unique (`rotationId`, `cycleNumber`),
  index (`groupId`, `dueDate`).

**RLS:** each table ENABLE RLS with SELECT, INSERT, UPDATE on
`organisation_id = app_current_org()`; no DELETE policies.

**Backfill (in the migration):** for each rotating group, insert rotation 1
(`draft`) and one slot per member ordered by `join_order`, positions 1..n,
using `gen_random_uuid()`.

**Current rotation:** the group's rotation with the highest `rotationNumber`.

**Reorder:** `memberIds` must contain each draft slot's member exactly once.
Positions are rewritten 1..n in that order inside one transaction that locks
the group row (the same lock member adds take, so nobody joins the draft
mid-reorder or mid-start); the unique (`rotationId`, `position`) index is satisfied by
first moving positions to negatives, then setting the final values.

**Start:** in one transaction, lock the group row, require `draft` and at
least 2 slots, set `status = active`, `firstDueDate`, `startedAt = now()`, and
insert cycle n for slot position n: `dueDate` from the rule below,
`amountDue = group.contributionAmount`, `payoutSlotId` = that slot.

**Due dates:** cycle n is due `firstDueDate + (n - 1) x frequency`. Daily adds
n - 1 days, weekly 7(n - 1) days. Monthly keeps the first due date's day of
month, falling back to the last day of shorter months (anchor 31: Jan 31, Feb
28/29, Mar 31, Apr 30). Default first due date = today in Lagos plus one
period by the same rule. Dates are calendar dates (`YYYY-MM-DD`, `@db.Date`).

**Permissions:** viewing follows group visibility (feature 3). Reorder and
start: Owner, Admin, or an assigned field officer; Treasurer and Branch
manager get 403 `forbidden`; a group the caller cannot see is 404.

**Endpoints** (under `/organisations/:orgId/groups/:groupId`)

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/rotation` | none | 200 `{ "rotation": {...} }` |
| PUT | `/rotation/order` | `{ "memberIds": [uuid, ...] }` | 200 `{ "rotation": {...} }` |
| POST | `/rotation/start` | `{ "firstDueDate"?: "YYYY-MM-DD" }` | 200 `{ "rotation": {...} }` |

Rotation shape: `{ id, rotationNumber, status, firstDueDate, startedAt,
slots: [{ position, memberId, name, status }], cycles: [{ cycleNumber,
dueDate, amountDue, payoutPosition }] }`, slots by position, cycles by number
(empty before start).

Errors: `invalid_body`, `invalid_params`, `invalid_order` 400; `forbidden`
403; `group_not_found`, `rotation_not_found` 404; `rotation_not_draft`,
`rotation_too_small` 409.

## Testing

No test runner. Scratch tsx scripts against Neon under the app role (Termii
blank, Bash only), with a direct check of the due-date function for edge
cases, and cleanup through the owner connection in FK order (cycles,
rotation_slots, rotations, then feature 3's order). The feature 3 script is
rerun as regression.

## Notes for the AI

- Decisions recorded (2026-11-05, Autopilot), reversible and open to change
  at review: a rotation needs at least 2 slots to start; the draft is created
  with the group and kept in sync as members are added (the plan: "on
  creation, a draft Rotation is seeded from join order"); members added after
  start are not in that rotation (they join a later one, feature 8); rotation
  routes live under the group (`/groups/:groupId/rotation`) because a group
  has one current rotation.
- The stored `dueDate` is the truth after generation; the formula only
  creates dates (project plan, section 10).


<!-- blueprint:completion {"schemaVersion":1,"specBytes":8764,"specSha256":"b56f86f8ea884fdf4267f46d7c0d6717839fc41844de69216cf166db3bfe4a1f","branch":"refs/heads/feature/rotation-setup-and-start","head":"59f49a5a1f00784730c1fdbbaa4ce76d64d13582","baseRef":"refs/heads/main","baseCommit":"853b3692e0d30e187d1b8f693a2b362ce30c317c","sourceTree":"bfe65f4550cab00c4f808a727ec8d49eb4805c5b","absentOptional":[]} -->

## Findings

### 4/F-14 [P2] closed - An out-of-range startDate month or day returns 500 instead of 400 invalid_body

**File:** src/groups/groups.validation.ts:18
**Found:** 2026-11-04 by /audit independent (scope: current; lens: quality, security)
**Why it matters:** The `calendarDate` refine calls `new Date(...).toISOString()`. For a string that passes the `YYYY-MM-DD` regex but is not a parseable date (month `00` or `13`, day `32` and up), `new Date` is an Invalid Date and `toISOString()` throws `RangeError: Invalid time value`. zod does not catch exceptions thrown inside a refine, so `parse()` in src/validate.ts rethrows the RangeError and the central handler answers 500 `internal_error` and logs a stack trace. Confirmed against the built schema: `createGroupBody.safeParse({ ..., type: "fixed", startDate: "2027-13-01" })` throws RangeError, while `"2027-02-30"` correctly fails with `success: false`. The spec and standards require invalid bodies to be 400 `invalid_body`. No data or isolation effect: nothing is written and the response is generic, hence P2.
**Suggested fix:** Make the refine total: build the Date once, return false when `Number.isNaN(date.getTime())`, and only then compare `date.toISOString()` with the input. No current requirement is lost.
**Resolution:** Fixed 2026-11-05 by fix/out-of-range-startdate-returns-500: the refine builds the Date once and returns false when `getTime()` is NaN before calling `toISOString()`. Checked through the API against Neon: `2027-13-01`, `2027-00-10`, `2027-01-32`, `2027-02-30`, `2027-02-29` give 400 `invalid_body`; a real future date and `2028-02-29` give 201. Awaiting an `/audit` re-review to close. Closed 2026-11-05 by /audit independent (feature 4 review, target 59f49a5): src/groups/groups.validation.ts:15-22 builds the Date once and returns false on NaN before `toISOString()`; the delta only exports `calendarDate` for reuse in `startBody`. Against the built schemas, `startBody` with `2027-13-01`, `2027-00-10`, `2027-01-32`, `2027-02-30`, `2027-02-29` returns `success: false` without throwing, and `2028-02-29` passes. No new defect from the repair.

## Independent review

**Status:** passed
**Target commit:** 59f49a5a1f00784730c1fdbbaa4ce76d64d13582
**Base commit:** 853b3692e0d30e187d1b8f693a2b362ce30c317c
**Base ref:** refs/heads/main
**Spec hash:** b56f86f8ea884fdf4267f46d7c0d6717839fc41844de69216cf166db3bfe4a1f
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-05T06:15:12Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-05T06:27:48Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Handoff

Review the active spec and the complete `853b3692e0d30e187d1b8f693a2b362ce30c317c..59f49a5a1f00784730c1fdbbaa4ce76d64d13582` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

## Commands

- `git rev-parse HEAD`: pass (equals Target commit)
- `git merge-base refs/heads/main HEAD`: pass (equals Base commit)
- `sha256sum blueprint/context/current-feature.md`: pass (equals Spec hash; spec is tracked, no snapshot)
- `git status --porcelain --untracked-files=all`: pass (only blueprint/context/review.md modified)
- `npm run typecheck`: pass
- `npm run build`: pass
- `node <scratch script> against dist/rotations/due-dates.js and dist/rotations/rotations.validation.js`: pass (no database)
- test command: unavailable
- lint command: unavailable
- Verify command: unavailable

## Evidence

- Reviewed all 12 files in the delta: migration 20261104212236_rotations, prisma/schema.prisma, src/rotations/* (6 files), src/groups/groups.service.ts, src/groups/groups.validation.ts, src/organisations/organisations.routes.ts, and the spec; plus callers src/tenancy.ts, src/db.ts, src/errors.ts, src/validate.ts, src/groups/groups.model.ts, src/groups/groups.routes.ts, earlier RLS and grant migrations.
- RLS: rotations, rotation_slots, cycles each ENABLE RLS with SELECT/INSERT/UPDATE on app_current_org() and no DELETE policy; every write runs inside withOrg with organisationId from the session actor.
- Backfill: one draft rotation 1 per rotating group (zero-member groups get an empty draft), slots by ROW_NUMBER over join_order, organisation_id copied from the member row, runs as owner before any app write.
- Concurrency: member add, reorder, and start all take the group row FOR UPDATE before reading the draft; start re-reads status after the lock and activates conditionally on status = draft, so a parallel start sees active and returns 409; members added after start find no draft and get no slot.
- Reorder validates length, uniqueness, and membership against the locked draft's slots, moves positions to negatives, then writes 1..n.
- Due dates (built code): 31 Jan monthly -> 28 Feb, 31 Mar, 30 Apr, 31 May (2027) and 29 Feb (2028); 31 Dec -> 31 Jan -> 29 Feb; daily and weekly cross year and leap boundaries correctly; Lagos today rolls at 23:00Z.
- startBody rejects past, impossible, null, and non-string dates without throwing; F-14 fix confirmed and closed.
- Permissions: rotation routes rely on visibleGroup (404) then assertManagesMembers (403), matching the spec's treasurer/branch manager 403 and hidden-group 404.
- Amount snapshot taken from the group row read after the lock; cycle n links to the slot at position n.

## Findings

- F-14 closed (re-examined)
- F-15 open P3, resolution updated (check now reachable through rotation routes)
- F-16 open P3 (far-future firstDueDate gives malformed dates)
- F-17 open P3 (duplicate visibility check in lockedDraft)
- F-18 unverified P3 (per-slot reorder updates inside 10 s transaction; 500 cap)

## Remaining risk

- No test command exists; no automated tests cover rotations, due dates, or RLS.
- No lint command exists.
- No Verify command or GitHub workflow exists.
- Database behaviour (migration apply, RLS enforcement under savecircle_app, lock contention, parallel start) was reviewed from code only; no database connection was made in this review.
- Reorder latency for large groups was not measured (F-18).

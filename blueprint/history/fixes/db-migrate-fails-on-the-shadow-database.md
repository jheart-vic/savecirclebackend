# Fix: db:migrate fails on the shadow database

**Type:** Fix
**Status:** verified
**Branch:** fix/db-migrate-fails-on-the-shadow-database

## The problem

`npm run db:migrate` (`prisma migrate dev`) fails before it can create any
migration:

```
ERROR: relation "_prisma_migrations" does not exist
```

`migrate dev` first replays every migration into a temporary shadow database.
The last line of `prisma/migrations/20261028124943_app_role_grants/migration.sql`
is `REVOKE ALL ON TABLE "_prisma_migrations" FROM savecircle_app;`. In the real
database that table exists, but in the shadow database it does not, so the
replay stops there. Feature 2b worked around it with `prisma migrate diff` plus
`prisma migrate deploy`; every future schema change would need the same
workaround.

A second, separate failure seen in the same command is `P1001 Can't reach
database server` on the direct Neon host. It is a timeout, not a bug: the
default connect timeout is short for a sleeping Neon compute reached from
Nigeria.

## The fix

1. Wrap that one `REVOKE` so it runs only when the table exists:

   ```sql
   DO $$
   BEGIN
     IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
       REVOKE ALL ON TABLE "_prisma_migrations" FROM savecircle_app;
     END IF;
   END
   $$;
   ```

   On the real database the table exists, so the result is the same as before.
   On the shadow database the statement is skipped. The rest of the migration
   is unchanged.

2. Editing an applied migration changes its checksum, and `migrate dev` would
   then report "modified after it was applied" and offer to **reset the
   database**. To prevent that, update the stored checksum for this one
   migration in `_prisma_migrations`, through the owner connection
   (`DIRECT_URL`), in one statement:

   ```sql
   UPDATE _prisma_migrations SET checksum = '<new checksum>'
   WHERE migration_name = '20261028124943_app_role_grants' AND checksum = '9073e2156b4798b742948e22638ebba6c5023ef8f805d7818d6ddbdb2be41f72';
   ```

   Evidence (2026-11-02): every stored checksum on this Neon branch equals the
   SHA-256 of its migration file with CRLF normalised to LF, so `<new checksum>`
   is computed the same way from the edited file. The `AND checksum = ...`
   guard makes the update affect exactly one row or none.

3. `.env.example`: add `connect_timeout=30` to the `DIRECT_URL` example (and
   the `DATABASE_URL` example, which has the same cold-start delay), with a
   one-line comment. The user updates their own `.env`; the agent never edits
   it.

Must not break: the app role still has no privileges on `_prisma_migrations`;
`npx prisma migrate status` stays in sync; no migration is re-applied, rolled
back, or reset; no other migration file changes.

Not in scope: migrations created by other Neon branches. Any other database
that already applied `app_role_grants` (for example a future production
branch) needs the same one-row checksum update before `migrate dev` is run
against it; `migrate deploy` only applies new migrations.

## Build steps

- [x] 1. **Guard the REVOKE and sync its checksum.** Edit the migration file as
  above, compute the LF-normalised SHA-256, show the exact `UPDATE` for
  approval, and run it through the owner connection.
  **Done when:** the `UPDATE` reports 1 row; `npx prisma migrate status` says
  "Database schema is up to date!" with no modified-migration warning;
  `npm run db:migrate` completes with "Already in sync" and creates no new
  migration folder; a read-only query shows `savecircle_app` still has no
  privileges on `_prisma_migrations`; typecheck passes.
- [x] 2. **Longer connect timeout in the example env.** Add
  `connect_timeout=30` to both example URLs in `.env.example`.
  **Done when:** `.env.example` shows the parameter on both URLs with a short
  comment; nothing else in the file changes.

## Verify

- `npx prisma migrate status`: up to date, no warnings.
- `npm run db:migrate`: runs through the shadow database and reports the schema
  is in sync (retry once if Neon is still waking).
- Read-only check that `has_table_privilege('savecircle_app', '_prisma_migrations', 'SELECT')` is false.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":4163,"specSha256":"43d809b1e00d61780c7bef77863dc9a4c19436ddc68343c2ba5a0b8487720d59","branch":"refs/heads/fix/db-migrate-fails-on-the-shadow-database","head":"555efebeb2606deab1cbab700208cfaa57683a3c","baseRef":"refs/heads/main","baseCommit":"b956351452744e35e68c6f9fbe7f82864af76d49","sourceTree":"b2e64101199a9b71ea7ad670ad58edfd2fba48b0","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** 555efebeb2606deab1cbab700208cfaa57683a3c
**Base commit:** b956351452744e35e68c6f9fbe7f82864af76d49
**Base ref:** refs/heads/main
**Spec hash:** 43d809b1e00d61780c7bef77863dc9a4c19436ddc68343c2ba5a0b8487720d59
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-03T12:08:57Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-03T12:18:27Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `git rev-parse HEAD`: pass (equals Target commit)
- `git merge-base refs/heads/main HEAD`: pass (equals Base commit)
- `sha256sum blueprint/context/current-feature.md`: pass (equals Spec hash)
- `git status --porcelain=v1 -uall`: pass (only blueprint/context/review.md modified)
- `tr -d '\r' < prisma/migrations/20261028124943_app_role_grants/migration.sql | sha256sum`: pass (3c397a9f4c939d91af504a77f7a863a2c6062ca8c167e7967cd1e21320dbbb2d, the checksum the builder wrote)
- `npm run typecheck`: pass
- `npm run build`: pass
- Test, lint, and Verify commands: unavailable (none configured)

## Evidence

- Delta reviewed in full: .env.example, blueprint/context/current-feature.md, prisma/migrations/20261028124943_app_role_grants/migration.sql (3 files, b956351..555efeb).
- Guarded REVOKE: `to_regclass('public."_prisma_migrations"')` resolves the same table the original unqualified name did under the default search path; a PL/pgSQL `DO` block runs inside Prisma's per-migration transaction and is skipped only where the history table is absent (shadow database). On any real database, including a fresh one, Prisma creates `_prisma_migrations` before applying migrations, so the REVOKE still runs. No other statement in the migration changed.
- Checksum sync: the LF-normalised file hash matches the recorded value; the spec documents the one-row guarded UPDATE and that any other database that already applied this migration needs the same update before `migrate dev`.
- `connect_timeout`: a supported seconds parameter for the Prisma CLI schema engine (DIRECT_URL via prisma.config.ts:13); ignored by node-postgres 8.23.1 used by @prisma/adapter-pg for DATABASE_URL (pg/lib/client.js:116 uses only connectionTimeoutMillis; not sent at startup), so harmless there. Recorded as F-13 [P3].
- No secrets in the delta; .env.example holds placeholders only.

## Findings

- F-13 [P3] open: connect_timeout on DATABASE_URL is ignored by the app's pg driver; comment overstates it.
- F-10 [P3] and F-12 [P3] remain open, outside this delta and not re-examined.

## Remaining risk

- No test runner, lint, or Verify command is configured; those signals are unavailable.
- Runtime claims (UPDATE affected 1 row, `prisma migrate status` in sync, `npm run db:migrate` through the shadow database, app role lacks privileges on `_prisma_migrations`) were not re-run: the reviewer was not permitted to connect to the database or run Prisma CLI commands.
- Any other Neon branch or future database that applied the old app_role_grants checksum needs the documented one-row checksum update before `migrate dev`; that procedure lives only in this Fix spec and its history archive.

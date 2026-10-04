# Coding Standards

> Conventions for this project: a Node.js + Express + TypeScript HTTP API.
>
> Sections marked `> TODO` have no code behind them yet; settle them when the
> first features land rather than treating a guess as a convention.

## Stack

- Runtime: Node.js 22 (`engines` in `package.json`)
- Framework: Express 5, a JSON HTTP API with no server-rendered UI
- Language: TypeScript, strict mode, compiled by `tsc` to `dist/`
- Package manager: npm (`package-lock.json`)
- Module system: ESM (`"type": "module"`, `nodenext`). Relative imports use
  the `.js` extension, for example `import { app } from "./app.js"`
- Dev runner: `tsx watch`
- Environment: `dotenv` loads `.env` in `src/server.ts` and
  `prisma.config.ts`; `.env.example` lists every variable by name

## TypeScript

- Strict mode enabled
- No `any` types - use proper typing or `unknown`
- Define types for request bodies, API responses, and data models
- Use type inference where obvious, explicit types where helpful

## Express

- Layering is **Model - Service - Controller - Route** (project decision):
  - **Route** (`<feature>.routes.ts`): one line per endpoint, path +
    middleware + controller function. No logic.
  - **Controller** (`<feature>.controller.ts`): parse and validate the
    request, call the service, set cookies, send the response. No Prisma.
  - **Service** (`<feature>.service.ts`): business rules, limits, and
    transactions. No `req` or `res`, so it can be tested without HTTP.
  - **Model** (`<feature>.model.ts`): Prisma queries only, no rules. Each
    function takes an optional `db: Db = prisma` so services can pass a
    transaction client.
- Import layers as namespaces: `import * as authService from "./auth.service.js"`
- Group routes by feature with an Express `Router`
- Return the correct HTTP status code; never send `200` with an error body

## File Organization

- `src/app.ts` - builds and exports the Express app (importable by tests)
- `src/server.ts` - loads env and starts listening; nothing else
- `src/db.ts` - the one shared Prisma client; import `prisma` from here
- `src/generated/prisma/` - Prisma client output; generated, git-ignored,
  never edited by hand
- `prisma/schema.prisma` and `prisma/migrations/` - schema and migrations
- `prisma.config.ts` - Prisma 7 CLI config (schema path, datasource URL)

- `src/<feature>/` - one folder per feature (for example `src/auth/`) with
  the four layer files, plus `<feature>.validation.ts` (zod schemas),
  `<feature>.middleware.ts`, and small helpers when needed
- `src/config.ts` - validated env; `src/errors.ts` - `AppError` and handlers;
  `src/validate.ts` - `parse(schema, data)` for request bodies
- Do not create empty layer folders in advance

## Naming

- Files: kebab-case, with a dotted layer suffix (`auth.service.ts`)
- Functions and variables: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Types/Interfaces: PascalCase (no prefix)

## Database

- Neon PostgreSQL, with Prisma ORM 7 for all database operations
- The app connects through Neon's pooled URL (`DATABASE_URL`) with the
  `@prisma/adapter-pg` driver adapter in `src/db.ts`. Prisma CLI commands use
  the direct URL (`DIRECT_URL`) via `prisma.config.ts`
- Neon's pooler runs PgBouncer in transaction mode, so session state does not
  survive between statements outside a transaction. Set the RLS organisation
  with `set_config('app.organisation_id', $1, true)` (transaction-local)
  inside the same transaction as the tenant queries, never with a plain `SET`
- Always use `npm run db:migrate` (`prisma migrate dev`) for schema changes,
  never `db push`
- Run `npx prisma migrate status` before committing to verify migrations are
  in sync
- Production deployments must run `npm run db:deploy` before the app starts
- Money is stored as integer minor units (for example kobo), never floats
- Balance-changing writes that touch more than one row run in one transaction
- Money tables (`Payment`, `Contribution`, `MemberCredit`, `Transfer`) are
  append-only: never update or delete a row; correct with a reversal
- Every tenant table has `organisation_id` under PostgreSQL row-level
  security. Tenant queries run inside a transaction that sets the current
  organisation first; the app's database role must not bypass RLS
- Balances and arrears are derived by query, never stored

## Money movement and webhooks

- Verify every provider webhook signature with that organisation's secret,
  store the raw event, and drop duplicates by provider reference before
  acting
- Re-verify inbound transactions with the provider before trusting them
- Every outbound transfer carries an idempotency key; every job is safe to
  run twice
- Never log or return gateway keys, BVN, NIN, PINs, or OTPs

## Validation and API Boundaries

- Validate every request body, query, and route param at the route boundary
  before it reaches business logic
- Scope every user-owned query by the authenticated user id from the session or
  token; never trust a client-supplied user id
- Read secrets and config from environment variables; never commit them

- Validate with `zod` schemas; parse, don't cast
- Normalize phone numbers to E.164 with `libphonenumber-js` (default region
  NG) before storing or comparing them
- Hash OTPs, session tokens, and PINs with Node's built-in `crypto` (HMAC or
  `scrypt`); no extra hashing library
- Make every outbound HTTP call with `axios` (project decision), one
  `axios.create({ baseURL, timeout })` instance per provider, behind the
  `PaymentProvider` and `Notifier` interfaces; no vendor SDKs
- Never log or rethrow a raw axios error: it carries the request (API keys,
  OTPs, BVNs). Convert it to a plain `Error` with only the status and a short
  slice of the provider's response, as `src/termii.ts` does
- `cors` allows only the frontend origin; `express-rate-limit` guards
  per-IP limits on public auth and PIN endpoints

## Error Handling

- Throw or pass errors to one central Express error-handling middleware rather
  than formatting error responses in each handler
- Use one consistent JSON error shape across the API
- Never leak stack traces or internal error messages in responses
- Log the underlying error server-side

- Shape: `{ "error": { "code": "<snake_case>", "message": "<human text>" } }`
- Throw `AppError(status, code, message)` from `src/errors.ts` for expected
  errors; anything else becomes a 500 `internal_error` with a generic message

## Testing

The blueprint installs no test runner; testing is opt-in at the project level,
because the overlay can't know your stack. Adding unit testing is an explicit
setup task the AI can do through the normal workflow, either as a build-plan item
or with `/tests`. The setup should choose the stack-native runner, wire the
scripts or commands, add a small example test, and update the Commands section
of `AGENTS.md`.

When `AGENTS.md` declares a `Verify` command, treat it as the umbrella automated
gate. It combines only the checks this project actually has, in this order when
available: typecheck, tests, then build. The command does not enable an absent
test runner or replace focused evidence. It gives local work and optional CI one
exact command to run. `/ci` owns Verify and CI setup. `/tests` adds the real test
command to Verify when it already exists, but never creates CI only because
testing was configured.

**The opt-in switch is one signal: a `test` command in the Commands section of
`AGENTS.md`.** Declare one and **tests become a gate for logic-bearing steps**,
not an optional extra; leave it out and the loop verifies logic with the evidence
it already uses (run it, a screenshot, the build). Adding the runner is itself a
deliberate step, never a silent mid-step install. This is the single definition
of the switch; the skills and `ai-interaction.md` only point back here.

- **What to test (the scope rule):** pure logic where a wrong answer is possible -
  parsers, formatters, validators, money and schedule calculations. These have
  assertable inputs and outputs and real edge cases (empty, missing, malformed).
- **What not to test:** integration-level surfaces (anything driving a real
  database or external service). Verify those with real API output and the
  build, not brittle unit tests.
- **The gate (when a runner is configured):** a build step that adds in-scope logic
  must ship a passing test in the same reviewable diff. The project's test command
  must be green before the step is approved, before any checkpoint commit, and
  before `/complete` merges. Integration-only steps are exempt and ride on API
  output plus build evidence.
- **When it's named:** the `/feature` spec's Testing section predicts the coverage,
  `/implement` writes the test with the step, and if a step surfaces logic the spec
  didn't foresee, add a focused test then.
- An empty suite should fail, not pass, so "no tests ran" never looks like "passed".
- Test files live next to source files (for example `feature.test.ts`).
- Run them via the project's test command (see Commands in `AGENTS.md`), not a
  hardcoded tool name.

Test gate status: off. No test runner or `test` command exists yet.

> TODO: `/tests` picks the runner once the app is scaffolded.

## Browser Verification

This project is an API with no UI, so browser evidence rarely applies. Verify
endpoints with real request and response output instead. The rules below apply
only if a browser-facing surface is ever added.

- Browser automation is separately opt-in through `/tests browser`. That setup
  reuses a compatible runner or prefers Playwright for supported projects, then
  documents the exact command as `Browser tests` in `AGENTS.md`.
- When `Browser tests` is declared, add focused coverage for stable behavioral
  done-whens when it is proportionate, and run the documented command during
  `/check`. Do not assume it proves visual fidelity, real authenticated-profile
  behavior, browser chrome, or another claim the test does not observe.
- If no Browser tests command is declared, do not add a runner silently in the
  middle of an unrelated feature. Use the available dev server, browser
  screenshots, build output, API output, or manual evidence instead.
- Browser tests are not part of the default Verify command or CI unless the user
  separately chooses that slower gate.
- Browser evidence is especially important for flows that click, type, submit,
  navigate, download files, render complex layouts, or depend on client-side
  state.

## Code Quality

- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible

## Comments

Write code that explains itself; comment only what the code cannot say.
Over-commenting is a common AI tell, so resist it.

- Comment the **why**, not the **what**. Delete any comment that restates the code.
- No banner/header blocks, section dividers, or step-by-step narration of obvious
  code. A file does not need a comment announcing each region.
- A comment earns its place only when it captures something the code can't: a
  non-obvious decision, a gotcha or workaround, why a value is what it is, or a
  link to a spec or issue.
- Prefer self-documenting names and small functions over explanatory comments.
- Keep doc comments minimal: a one-line purpose on an exported type or function is
  plenty; don't write JSDoc that just repeats the signature.
- When in doubt, leave the comment out.

## Writing

- No em dashes (U+2014) in generated content: docs, comments, commit messages,
  READMEs, specs. They read as AI-generated.
- Use a hyphen for `term - description` separators; rephrase prose with commas,
  parentheses, or a colon. Avoid en dashes and the ellipsis character too.

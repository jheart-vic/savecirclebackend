# Fix: Out-of-range startDate returns 500

**Type:** Fix
**Status:** verified
**Branch:** fix/out-of-range-startdate-returns-500
**Fixes:** F-14

## The problem

`POST /organisations/:orgId/groups` with a thrift `startDate` whose month or
day is out of range (for example `2027-13-01`, `2027-00-10`, `2027-01-32`)
returns 500 `internal_error` instead of 400 `invalid_body`. The `calendarDate`
refine in `src/groups/groups.validation.ts:18` builds a `Date` from the string;
for those values it is an invalid date, and `toISOString()` throws a
`RangeError` inside zod, which reaches the central error handler as an
unexpected error. Dates that exist in no month but have a valid day number
(`2027-02-30`) already give 400, because the date rolls over and the string
comparison fails.

## The fix

In the refine, return `false` when the parsed date is invalid
(`Number.isNaN(date.getTime())`) before calling `toISOString()`. Nothing else
changes: valid dates, today/past checks, and the thrift/rotating rules behave as
before.

## Build steps

- [x] 1. **Guard the invalid date.** Edit the `calendarDate` refine.
  **Done when:** `2027-13-01`, `2027-00-10`, `2027-01-32`, and `2027-02-30` each
  give 400 `invalid_body`; a valid future date still gives 201; F-14 is marked
  `fixed`; typecheck and build pass.

## Verify

- `POST /organisations/{orgId}/groups` with `{ "name": "T", "type": "fixed",
  "contributionAmount": 1000, "frequency": "daily", "startDate": "2027-13-01" }`
  returns 400 `invalid_body`, not 500.
- The same body with a real future date returns 201.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":1569,"specSha256":"f94849d6cb20073e585353c2e7c4c4bef787f60c236914ea83d45469f30fd67b","branch":"refs/heads/fix/out-of-range-startdate-returns-500","head":"83fb0464296c20b63d3ed55444fd5f86d79b0244","baseRef":"refs/heads/main","baseCommit":"83fb0464296c20b63d3ed55444fd5f86d79b0244","sourceTree":"4e8b3dadae15b7f7400ca62b07361a0889b35b14","absentOptional":[]} -->

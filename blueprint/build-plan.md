# Build Plan

List the features that make up your project, high level and in rough build order.
Keep each item to one line; the details come later in `/feature`.

Plain bullets are fine. When both planning docs are ready, run `/overview`.
It adds tracking numbers and checkboxes to your feature list before generating
the project overview.

Run `/feature` to spec the next unchecked item, or `/feature 2` to pick one.
Keep completed items checked and append new features as the project grows.
Do not renumber completed features; their archived specs refer to those IDs.

Scaffolding the app and prototyping its look are pre-build steps, not features.
Start with your first real slice of functionality.

## Pre-build

Done: the app is scaffolded (Express 5 + TypeScript + Prisma 7, npm) with a
`/health` endpoint, and the real commands are recorded in `AGENTS.md`. No
database models exist yet; feature 1 adds the first ones.

## Phase 0 - Legal and partners (not code, starts week 1, runs in parallel)

- Written legal opinion that gateway-hosted mode does not need a CBN payments licence
- Gateway business account (Paystack by default) for the pilot cooperative, with API-initiated transfers enabled
- Confirm current Paystack and Flutterwave fees and transfer limits
- Termii quote for Nigerian WhatsApp utility templates; ask whether Termii submits templates
- Meta business verification and reminder template submission
- Appoint a data protection lead
- Pick the design-partner MFB for bank-hosted mode (needed after the pilot)

## Your features

SaveCircle backend API features, in build order, following the v4 phases. The
v3 core is built directly on the v4 tenancy model, so nothing needs migrating
later. Rotation start sits before payment logging because payments need cycles.

Phase 1 - Tenancy and v3 core

- [ ] 1. **Staff auth** - phone + OTP sign-in with hashed, rate-limited OTPs, revocable sessions, and an AuthEvent row for every OTP request, failure, sign-in, sign-out, and revocation
- [ ] 2. **Organisations, roles, and isolation** - create an organisation (creator becomes Owner), invite staff with roles, switch organisations, and enforce organisation isolation with PostgreSQL row-level security set per request
- [ ] 3. **Groups and members** - rotating and thrift groups with amount, frequency, reminder schedule, and start date for thrift; add members by name and E.164 phone or bulk CSV; join order; officers assigned to groups
- [ ] 4. **Rotation setup and start** - draft rotation seeded from join order, reorderable until start; start locks positions, takes a first due date, and generates one cycle per slot (monthly days 29 to 31 fall back to month end), each snapshotting the amount due
- [ ] 5. **Cash logging and allocation engine** - officers log cash as a Payment; the engine splits it across the member's groups (oldest past-due first, then existing cycles by due date, thrift takes any amount) and turns any excess into member credit
- [ ] 6. **Reversals** - officer reversals within their groups as linked negative contributions with a required reason, re-allocation within 7 days; nothing is edited or deleted
- [ ] 7. **Shared ledger and derived balances** - contribution history with "corrected" pairs, derived arrears and paid/partial/missed status over owed cycles, thrift balances, and credit balances, the same for every reader
- [ ] 8. **Who's next and cash payouts** - next recipient and date, manual paid-out confirmation for cash payouts recorded as a cash Transfer with its amount, rotation completion, and new rotations in the same or a reshuffled order
- [ ] 9. **Thrift cycle rollover** - rolling two-cycle horizon created by a repeatable job, plus thrift group pause and close
- [ ] 10. **Inactive members and gap resolution** - deactivation with inactive_from; obligations by payout status; gaps resolved only by skip, reassign with a suggested buy-in, or hold; returning members
- [ ] 11. **Rotation pause, close, and dissolve** - pause and resume (not-yet-due cycles shift by the pause length), close after a completed rotation, dissolve mid-rotation with a per-member settlement summary and a read-only ledger
- [ ] 12. **Job queue and Notifier** - BullMQ on Redis with a Render worker for idempotent and repeatable jobs, and a Notifier interface over Termii WhatsApp and SMS with delivery reports
- [ ] 13. **Reminders** - repeatable job sending on each group's schedule between 08:00 and 19:00 WAT, skipping paid members, credit-covered cycles, and paused rotations, with a reminder log keyed by cycle, member, offset, and channel
- [ ] 14. **SMS fallback** - SMS immediately on a hard WhatsApp failure, or after 2 hours if not delivered, deferring anything past 19:00 WAT to 08:00 the next morning
- [ ] 15. **Member invites and PIN access** - single-use 7-day revocable invites, one PIN per phone set or confirmed on accept, re-invite reset, lockout after 5 failed attempts, group picker across groups and organisations, and a read-only member view

Phase 2 - Onboarding and accounts

- [ ] 16. **Organisation onboarding** - resumable KYB flow (type, suggested money mode, documents, directors), ledger-only until rails are connected, and policies setup
- [ ] 17. **PaymentProvider and Paystack adapter** - PaymentProvider interface, Paystack adapter, encrypted per-organisation keys and webhook secret, transfer-permission check, and the organisation collection account
- [ ] 18. **Member verification and account numbers** - consented BVN/NIN capture (hashed), asynchronous account issuance with back-off retries, officer fix-and-retry after 3 failures, number delivered by message, blocked not deleted on exit

Phase 3 - Collections

- [ ] 19. **Webhook ingress and auto-allocation** - signed webhooks routed to the organisation, raw event stored, duplicates dropped, transaction re-verified, Payment created and allocated, receipt sent, pending reminders cancelled
- [ ] 20. **Unmatched queue** - payments to the collection account or blocked accounts, with officer assignment or refund marking and escalation after 3 days
- [ ] 21. **Cash in hand** - per-officer cash-in-hand balance cleared by deposits, 48-hour flagging, and cash receipts to members

Phase 4 - Disbursements

- [ ] 22. **Payout accounts** - name enquiry against the verified identity, 24-hour cooling period with a phone alert, PIN + OTP for changes
- [ ] 23. **Approvals** - maker-checker engine with organisation limits, no self-approval, escalation before due dates, used by withdrawals, payouts, and transfer-funded reversals
- [ ] 24. **Withdrawal notices** - thrift balances and member credit only; per-organisation policy with group overrides, available-balance checks, the notice lifecycle, member cancellation, PIN + OTP confirmation, and full-balance exits
- [ ] 25. **Transfer engine** - scheduled 09:00 WAT execution with pre-flight checks, idempotency keys, success and failure webhooks, retries (max 3), float shortfall hold-and-alert, and daily caps
- [ ] 26. **Automatic rotating payouts** - payout created when a cycle is fully funded, short-cycle choice (pay now and top up, or wait), cycle-allocated contributions locked from withdrawal, and leaver refunds, buy-ins, and dissolve settlements paid by approved transfer outside withdrawal policy
- [ ] 27. **Early-payout risk controls** - optional organisation policies: suggested slot order by payment history, a required guarantor for early slots, and a holdback on early payouts released when the member's remaining cycles are paid or applied to their arrears if they leave

Phase 5 - Reconciliation and hardening

- [ ] 28. **Nightly reconciliation** - provider settlement report vs ledger, with exceptions for the finance approver
- [ ] 29. **Statement export** - `pdf-lib` statement of a group's or member's history
- [ ] 30. **Hardening** - limits and alerts review, plus load and failure testing in gateway test mode

Later (Should and Could)

- [ ] 31. **Second gateway adapter** - Flutterwave
- [ ] 32. **Branches and organisation dashboard** - optional branches with branch managers, and the admin dashboard
- [ ] 33. **Bank-hosted adapter** - core-banking adapter for the design-partner MFB (after the pilot)
- [ ] 34. **White-label branding and sender ID** - organisation name, logo, colour, and sender ID
- [ ] 35. **Savings-history export for loan underwriting**
- [ ] 36. **Monetization** - pricing model not chosen yet (per active member, per organisation, or a share of collection fees)

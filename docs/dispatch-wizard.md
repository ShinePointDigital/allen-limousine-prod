# Dispatch wizard

Bookings in this application are stored in the existing `Inquiry` model, with operational assignments in `Ride`. The wizard extends those records; it does not create a competing booking table or chauffeur login accounts.

## Workflow

1. Review client contact, original route/time and booked vehicle class. An unspecified class remains explicitly unspecified.
2. Save an available chauffeur and active fleet vehicle. This confirms the booking and creates/updates its assigned ride, but sends no SMS.
3. Preview the saved client and chauffeur messages, then explicitly confirm dispatch.
4. Display recorded completion. Opening the booking again does not replay completed actions.

Progress is shared by all dispatchers. Optimistic versions reject stale saves. Recipient-specific audit records preserve accepted messages and permit retrying only definitively unsent messages. A reserved attempt has not contacted the provider; a pending attempt may have been accepted and must be reconciled before retrying. Assignment/reservation changes after notification submission begins block automatic sending of obsolete instructions.

Client SMS requires recorded consent and honors STOP. Driver SMS also honors STOP. A client notification skipped for consent/STOP does not prevent chauffeur dispatch. Provider acceptance is not proof of carrier delivery.

Availability conservatively excludes chauffeurs/units assigned to another active ride. The wizard does not invent trip durations to schedule overlapping future assignments.

## API

All endpoints require the `rides` staff permission. The booking ID is the `Inquiry.id`, not the `Ride.id`.

- `GET /api/admin/bookings/:id/dispatch`: authoritative snapshot, resume step, version, roster/unit availability and SMS previews.
- `POST /api/admin/bookings/:id/review`: `{ "version": 0 }`.
- `POST /api/admin/bookings/:id/assign`: `{ "action": "save", "version": 1, "driverId": "...", "vehicleId": "..." }` saves assignment only.
- `POST /api/admin/bookings/:id/assign`: `{ "action": "dispatch", "version": 2 }` submits the saved previews. Omitted action defaults to dispatch; supplying both assignment IDs saves them first.
- `POST /api/admin/chauffeurs`: `{ "name": "...", "phone": "..." }` adds an active, non-login roster entry; phone numbers are normalized and unique.
- Existing `POST /api/admin/rides/:rideId/dispatch/:attemptId/reconcile` verifies uncertain client or chauffeur messages without sending another message.

Review/assignment/dispatch responses use `shared/dispatch-wizard.ts`. Errors may include a fresh snapshot; reload it instead of repeating a stale action.

## Database and release safety

`npm run dev` explicitly selects the isolated development database. `npm run db:deploy:development` refuses missing development configuration or a connection identical to the shared production connection. Normal production startup continues to use the configured shared database.

The additive wizard migration creates progress fields, chauffeur records and recipient-role audit fields. Existing genuine fleet driver defaults are copied into the roster, and existing assignments resume at confirmation without a fabricated historical review timestamp.

Only the development database has been migrated for this work. Production migration and GitHub/Vercel publishing require separate approval. Do not publish the workspace wholesale: unrelated flight/SMS-inbox work remains outside this release. Before a selective release, check the live schema and SMS opt-out dependency compatibility; do not apply unrelated migrations automatically.

## Verification

- `npm run test:dispatch-wizard`: isolated development-database/API tests with injected SMS transport.
- `npm run build`: generated Prisma client, TypeScript and production frontend build.
- Start Chromium with remote debugging port 9223, then run `npx tsx scripts/verify-dispatch-wizard-browser.ts --development-database` for real sign-in, card/review/assignment/resume and desktop/mobile checks. The script deletes its own fixtures and deliberately never clicks the SMS submission button or submits a payment.

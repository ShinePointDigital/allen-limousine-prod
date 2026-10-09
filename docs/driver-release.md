# Secure chauffeur-link release

## Production target

The public website is https://allanlimousine.com on the existing Vercel
`allen-limousine-prod` project, released through
`ShinePointDigital/allen-limousine-prod` on GitHub.
Replit publishing synchronizes the shared managed production database; it is
not the Vercel website release mechanism.

## Database rollout

With user approval, the user republished the existing Replit deployment with
instructions to keep data overwrite disabled. Read-only production inspection
confirmed these additions before the GitHub live branch advanced:

- `20261010010000_booking_gratuity`: `Inquiry.gratuitySelection`,
  `Inquiry.gratuityCents` (non-null, default zero), and
  `Inquiry.authorizedTotalCents`.
- `20261010020000_driver_trip_access`: `Ride.driverAccessNonce`,
  `Ride.driverAccessTokenHash`, `Ride.driverAccessExpiresAt`, and
  `Ride.driverAccessAssignment`, plus the unique token-hash index.

Both SQL migration files are included in the released source. Earlier dispatch,
flight-schema and chauffeur-pairing prerequisites were already physically
present in production, despite missing Prisma migration-ledger entries.
They were not replayed. No custom production migration, startup DDL,
database replacement, assignment rewrite, or dispatch-lock reset was used.

## Released source

- GitHub production commit: `4fb391edd2d568ca1d3944342a0f89b196c11207`
- Verified source tree: `5b740547c1c1bf24e6024dd6cad41995ca914c7b`
- Local tested release ref: `release/driver-trip-safe`
- Vercel deployment: `dpl_96AT1MKEMSY9SpraehYraDQWxbQj`
- Vercel result: **READY / PROMOTED**, including the existing custom domains.

The release was assembled from the previous live GitHub tree and tested
independently. Its complete tree hash was checked before the non-forced GitHub
branch update. The workspace contains additional postponed flight-monitoring
and SMS-inbox interfaces; those interfaces were not included in this release.
The existing inbound SMS and opt-out handling remain enabled.

The existing production `SESSION_SECRET` was confirmed configured and retained.
`PUBLIC_APP_ORIGIN` was set to `https://allanlimousine.com` before the release.
No credential values were printed or included in this document.

## Verification

The exact release passed:

- Production build and TypeScript checks.
- Driver-trip, dispatch-wizard, gratuity, chauffeur-pairing, account-access,
  consent and Twilio tests.
- Account database tests against the separate development database.
- Driver-trip and gratuity browser tests with intercepted API requests and
  simulated provider outcomes.
- Chauffeur-pairing browser tests against development fixtures, including
  preservation of locked legacy assignments.

After promotion, read-only requests confirmed:

- Driver HTML: HTTP 200, `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex, nofollow`.
- Driver API with a synthetic invalid token: JSON HTTP 404, with the same
  confidentiality headers. This also checked API rewriting and database schema
  compatibility without accessing a real trip.
- Unauthenticated admin session: JSON HTTP 401.
- Public content API: JSON HTTP 200.
- Homepage, admin login, privacy and terms: HTML HTTP 200.

The live unavailable-link screen was visually checked. Real signed-in staff
screens and real driver capabilities were not exercised in production.
No live SMS, real authorization or capture, carrier campaign changes, or
production record mutations were used for verification.

## Future release safety

Build and test the actual current GitHub-based release, not merely the workspace.
Check physical production structures alongside the migration ledger. Use the
supported Publish flow for managed schema changes and disable data overwrite.
Preserve pending or uncertain dispatch bodies, URLs, provider identities and
locks. Never create a new payment merely to reconcile an uncertain capture.

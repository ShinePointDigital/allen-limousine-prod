# Driver flight updates

The existing scoped SMS trip link displays verified provider flight status,
scheduled/estimated/actual arrival or departure times, the relevant terminal and
gate, baggage belt when supplied, source and last-fetch time. Saved booking
details and the original booked pickup time remain separate and unchanged.

## Current release: automatic provider refresh disabled

The driver page reads only saved snapshots. Opening the link, using Refresh, or
returning from Maps does not call AviationStack. The page checks the trip snapshot
every 25 seconds while visible and on returning to the tab.

Only a booking-context-verified snapshot less than five minutes old can show
operational flight values. Legacy, missing or mismatched snapshots show
Unavailable. Older snapshots show Stale and hide operational values; the local
expiry also applies during a network outage. Missing fields in a current
snapshot show Not provided. Private FBO trips do not show commercial updates.

This release adds no provider scheduler, cron job, provider request budget or
production credentials. No database migration is required.

Automatic provider refresh remains disabled at the user's request. AviationStack
Free is listed for non-commercial use with 100 monthly requests; do not enable
commercial background tracking without confirming a suitable provider plan and
obtaining new approval. Vercel Hobby does not support frequent cron jobs. A
GitHub five-minute scheduler was discussed but is not installed or enabled.

## Verification

- Build and test the curated release against the current GitHub source.
- Check driver projection, occurrence/context matching, gate and actual-time
  handling, expiry, booking preservation, financial privacy and trip actions.
- Browser checks intercept all API requests and use synthetic flight data.
- Live smoke checks remain anonymous and GET-only with synthetic invalid tokens;
  never use issued driver capabilities, send SMS, capture payments or mutate
  production records for release verification.

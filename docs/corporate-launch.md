# Corporate travel launch

The implementation retains React/Vite, Express, Prisma, existing customer
sessions and the personal manual-capture checkout. Corporate contacts are
customers, not staff. Approval never replaces an established customer's password.

## Implemented routes and behavior

- `/corporate`: application, explicit per-ride billing consent and Stripe-hosted
  company card setup. No raw card fields enter the application.
- `/login`: approved company sign-in. Newly provisioned contacts receive a
  24-hour temporary password and must replace it before booking or managing cards.
- `/corporate/portal`: reviewed fare, required PO/cost-center, booking history,
  replacement company card and original-payment bank authentication.
- Staff **Corporate** section: paginated application review, approve, reject
  and recover credential email delivery. Resending temporary access revokes the
  old password and sessions; established credentials are preserved.
- Corporate ride completion in both staff and chauffeur paths charges the
  reviewed fare, using the original ride's payment intent and idempotency key.
  Declines, authentication requirements and unknown outcomes remain explicit.
  Never bypass an unresolved charge with another booking or manually mark it paid.
- Corporate badges and identifiers appear in dispatch and chauffeur panels.
  Cancellation/diversion warnings use only fresh exact-match saved records.
  They expire locally and clear when newer verified data resolves the condition.
  No warning changes pickup, flight assignment, chauffeur assignment or ride state.

## Before publishing

1. Apply the checked-in corporate migration to the intended **production**
   database using the established guarded deployment process. The workspace
   migration was applied only to the separate development database.
2. On Vercel, configure a verified `SENDGRID_FROM_EMAIL` and SendGrid credentials.
   In the Replit preview, a single verified connected SendGrid sender may be used
   when no sender was explicitly configured. Multiple senders require a choice;
   approval fails before provisioning if email configuration is unavailable.
3. Confirm Stripe production configuration, HTTPS return origin, receipts and
   webhook routing. Exercise saved-card setup, approval email, completed-trip
   charging, a decline and bank authentication with an explicitly authorized test
   company. Automated tests use fake Stripe/email providers and disposable
   development records; they do not prove live delivery or live card charging.
4. Preserve the existing disabled automatic-flight-refresh policy. This feature
   consumes saved snapshots; it does not enable scheduled provider calls. Exclude
   unrelated unpublished scheduler/cron changes from a release.
5. Verify phone-only PWA routing and desktop/tablet website behavior.

## Twilio Console configuration still required

The API connection exposes Twilio's core API, not Messaging Services configuration.
These exact strings are shared by the app and legal terms; that does **not**
prove they are configured at Twilio or that the carrier campaign is approved.

In Twilio Console, select the actual sending Messaging Service, then **Opt-Out
Management**. Save the standard keyword responses:

- **Opt-in:** `Allen Express, LLC (dba Allan Limousine): You are opted in to reservation, pickup and ride-status texts. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help.`
- **HELP:** `Allen Express, LLC (dba Allan Limousine): For reservation or SMS help, call 312-899-6718. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out.`
- **Opt-out:** `Allen Express, LLC (dba Allan Limousine): You are unsubscribed from service-related texts. No more messages will be sent. Reply START to opt in again. Opting out does not cancel your reservation.`

Use the configured business support number if it differs from the legal contact.
Preserve standard STOP/START keywords and configure HELP/INFO. Verify country and
language overrides do not replace the official brand with an outdated alias.

**Do not silently enable Advanced Opt-Out:** Twilio says it is disabled by
default and can only be disabled afterward by contacting their support team.
Obtain the owner's informed approval before enabling it. Changes saved while
the feature is disabled do not take effect.

Verify effective inbound webhook selection at both number and service levels,
with POST routing to `/api/webhooks/twilio/inbound` and the existing signed
callback checks. Provider-managed replies must not also be sent by the app.
The app persists suppression and keyword callbacks, and only returns a local
HELP response when the provider has not marked the keyword as handled. Website
consent does not undo STOP. Booking confirmation contains the official opt-in
disclosure only for consenting, non-suppressed customers.

No campaign registration, Advanced Opt-Out enablement, live test SMS, approval
email or card charge was performed during implementation. Controlled handset
tests require an explicitly approved recipient and permission to modify their
suppression history.

Reference: https://www.twilio.com/docs/messaging/services/tutorials/advanced-opt-out

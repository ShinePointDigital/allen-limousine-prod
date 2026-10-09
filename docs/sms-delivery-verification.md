# SMS delivery verification

## Current evidence — 2026-10-08 (UTC)

This is a verification report, not authorization to activate the inbox or publish
flight tracking. The user separately approved the number-level incoming webhook
change and up to two controlled test texts to their supplied recipient. After
the campaign gap was explained, they explicitly approved one delivery attempt
after START cleared suppression, despite that gap. The recipient is intentionally
not recorded in this report.

### Configuration and application checks

- Vercel reports the dispatch-wizard production release as ready, with
  `allanlimousine.com` among its production aliases.
- Vercel production has sender, account, authentication-token and status-callback
  environment keys. Their secret values were not retrieved. The explicit inbound
  callback override is absent; the handler can derive the URL from its trusted
  public origin. Key presence alone does not verify the deployed values;
  the real signed callbacks recorded below demonstrate accepted sender/account
  configuration without retrieving those secrets.
- Replit's configured sender is `+17088347330`, and its status callback is
  `https://allanlimousine.com/api/webhooks/twilio/status`. The real inbound
  callbacks below establish that Vercel accepts this sender's signed messages.
- Empty, unsigned POST requests to `/api/webhooks/twilio/inbound` on both
  `https://allanlimousine.com` and `https://allen-limousine.replit.app` returned
  HTTP 401, `Invalid Twilio inbound signature.` They were rejected before message
  persistence. This confirms public route/signature-guard reachability, not a
  successful signed provider callback.
- Read-only schema checks found SMS conversation/message tables in development
  and managed production. No production message or opt-out fixtures were created.
- Source inspection confirms that inbound STOP/START changes the suppression
  records read by the default dispatch-wizard service and the application's
  guarded operational SMS sender.
- Twilio connector GET requests failed with HTTP 401 and code 8001, including
  through the app's connector SDK. The error was “actor doesn't have any
  assertions.” A subsequent read-only inspection using the app's already
  configured direct authentication succeeded without disclosing credentials.
- That inspection confirmed an active Full account and ownership of the
  configured SMS-capable sender. Initially, the number's `sms_url` and
  `sms_application_sid` were blank; its method was POST.
- All Messaging Services were inspected (one service). The sender belongs to
  that service, which has `use_inbound_webhook_on_number: true` and a null
  `inbound_request_url`. Initially no incoming webhook route to the app was
  configured at either level.
- With the user's separate approval, only the sender's `SmsUrl` and `SmsMethod`
  were updated. A subsequent Twilio GET confirmed
  `https://allanlimousine.com/api/webhooks/twilio/inbound`, POST, and no overriding
  SMS Application SID. The service still uses the number-level webhook.
- The associated service's A2P campaign list is empty. This is not verified
  carrier approval. The account has one APPROVED, VERIFIED STANDARD brand;
  approved brand identity is not an approved campaign. No registration was
  created or submitted.
- Twilio's public service response does not expose Advanced Opt-Out's enabled
  state. Official documentation says Advanced Opt-Out is disabled by default,
  adds `OptOutType` to keyword callbacks, and requires contacting Twilio support
  to disable after activation. Do not enable it silently or assume that saving
  an incoming URL alone proves live STOP/START forwarding.
- After the initial STOP confirmation, read-only checks found no incoming
  Twilio message to this sender, no matching conversation/opt-out in managed
  production, and no matching inbound-webhook error among the latest 20 Twilio
  alerts. This does not prove that the handset sent successfully, that Twilio
  received the text, or that Twilio's blocklist is clear.
- Twilio's default STOP-filtering documentation explicitly says long-code
  STOP/START messages are forwarded to the configured webhook. Advanced Opt-Out
  is not a prerequisite for those default keywords. Confirm the handset's
  sending line, destination, SMS send result, and any automatic reply before
  attributing missing history to provider keyword settings.
- After the user confirmed sending STOP from the approved mobile, Twilio listed
  an inbound STOP as `received`, with no provider error, at
  `2026-10-08T00:55:41Z`. Managed production contained the same provider message
  ID as an INBOUND/RECEIVED STOP and its conversation had `optedOutAt` set.
  This establishes real provider receipt and persistence through the configured
  signed Vercel handler, rather than a synthetic callback.
- A read-only invocation of the application's normal `smsRecipientOptedOut`
  reader returned true for the approved recipient. Existing isolated sender and
  dispatch tests establish blocked operational sending for this suppression
  state; no live provider send was attempted while opted out.
- The subsequent real START was received by Twilio at
  `2026-10-08T00:57:23Z` and persisted as INBOUND/RECEIVED under the same provider
  message ID in managed production. Its conversation's `optedOutAt` cleared.
  The normal application suppression reader returned false immediately before
  the controlled outbound submission.

### Isolated checks completed

Development-database identity was checked against the managed development target
and distinguished from managed production using read-only fingerprints before
running persistence fixtures. Test workers exclude the shared application
connection. Fixtures clean up their own records.

- `npm run test:twilio`: passed (4 mocked-provider tests).
- `npm run test:sms-inbox`: passed (3 tests, including development persistence).
- `npm run test:dispatch-wizard`: passed (11 injected-sender tests).
- `npm run typecheck`: passed.

Checks cover signed inbound handling, unsigned/wrong-account/wrong-recipient
rejection, duplicate callbacks, STOP suppression, START clearing, and replay of
an old STOP after START without re-suppression or duplicate history. Persistence
checks read the stored suppression state and enforce blocked replies. Dispatch
checks cover consent, STOP, retries, and uncertain-outcome locks.

### Carrier delivery

Exactly one explicitly approved outbound text was submitted through the app's
actual `sendSms` implementation after verifying START and cleared suppression:

> Allan Limousine: SMS delivery verification test. No booking or payment was
> created. Reply STOP to opt out or HELP for help.

Twilio accepted it initially as `queued`. A subsequent lookup of that exact
provider record confirmed sender, recipient and body matched the attempt, then
reported **`undelivered`, error `30034`**. Twilio documents this as a US A2P 10DLC
message from a number not associated with an approved campaign.

**Live inbound STOP/START receipt, signed-handler persistence and shared
suppression transitions are confirmed. Live outbound delivery was exercised and
failed due to registration. No successful handset delivery is established.**

No second text or automatic retry was submitted after the confirmed failure.
No synthetic callbacks, customer accounts, bookings, payment transactions, or
carrier registrations were created. At this initial 2026-10-08 verification,
the only provider change was the approved incoming webhook; no Advanced Opt-Out
setting had been changed. The inbound live history consists of the user's real
STOP and START messages; outbound test history exists in Twilio, without
manufacturing a booking or dispatch record.
The inbox interface and flight-tracking release scope were not changed.

### Follow-up — approved START/HELP reply test (2026-10-09 UTC)

- The user later reported saving the exact approved START and HELP response text
  in Twilio Console and enabling Advanced Opt-Out. The Messaging Service API
  does not expose the feature's enabled state or response text, so these values
  could not be independently read back from Twilio.
- A fresh read confirmed the brand remains APPROVED/VERIFIED, but the associated
  A2P campaign list is still empty. Brand approval does not establish campaign
  approval.
- The Twilio number still has the signed app inbound webhook configured with
  POST, and the Messaging Service continues to use the number-level webhook.
- With explicit approval, real START and HELP messages from the approved test
  phone reached Twilio as inbound/received at 00:31:38Z and 00:31:44Z. The
  shared production database persisted START and cleared the suppression state.
  No corresponding new HELP message was present in the production inbox at the
  00:33Z read, so HELP callback forwarding/persistence was not confirmed.
- The user reported that neither automatic reply appeared on the handset. This
  does not confirm delivery of either requested response. The earlier app-sent
  delivery test remains undelivered with Twilio error 30034.
- No Vercel application deployment was made for the response-template request:
  these auto-replies are Twilio-managed, and the webhook's empty TwiML response
  avoids sending duplicate texts. The existing SMS inbox interface and
  flight-tracking release scope remain unchanged.

## Required before operational outbound SMS

1. Obtain separate informed approval for carrier campaign registration,
   fees, business disclosures and any provider association changes.
   Approved brand identity alone is insufficient.
2. After the campaign is approved and this sender is correctly associated,
   arrange a newly approved controlled test and confirm both provider delivery
   and actual handset receipt. Do not replay the failed test automatically.
3. Preserve signed callbacks, shared suppression and production history.
   Do not enable inbox/flight features or create bookings/accounts/payments
   as part of registration or the follow-up delivery test.

## Provider documentation

- https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource
- https://www.twilio.com/docs/messaging/api/service-resource
- https://www.twilio.com/docs/messaging/api/usapptoperson-resource
- https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out
- https://help.twilio.com/articles/223134027-Twilio-support-for-opt-out-keywords-SMS-STOP-filtering-
- https://www.twilio.com/docs/api/errors/30034

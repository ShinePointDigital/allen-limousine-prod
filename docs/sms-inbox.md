# SMS inbox

The staff inbox is at `/admin/sms`. Super Admins have access; limited administrators need the **SMS inbox** permission in Users & access. Customer accounts never have staff inbox access.

Incoming texts create one conversation per normalized phone number. Inbox replies and incoming message history are persisted. Existing driver-dispatch history remains in Rides & dispatch. The inbox does not start unsolicited conversations or automatically change booking/ride statuses.

## Live activation

1. Apply the additive SMS schema through the project's development migration flow, then use Replit's Publish schema flow for the managed production database. Do not run migrations against `SHARED_DATABASE_URL`, add startup DDL, or overwrite production data.
2. Release the inbox application code to the chosen live app separately from unrelated work.
3. Configure the Twilio number or Messaging Service's incoming-message webhook to **POST** to `/api/webhooks/twilio/inbound` on that deployed API host.
4. The inbound webhook verifies the Twilio signature, configured account, and recipient number. `TWILIO_INBOUND_CALLBACK_URL` can specify the exact absolute incoming webhook URL when host/proxy configuration would otherwise change the signature URL.
5. Keep `TWILIO_STATUS_CALLBACK_URL` configured for `/api/webhooks/twilio/status`. The existing signed status endpoint handles dispatch messages and inbox replies.

The private development SMS tables have been migrated. Application preview traffic may still use the shared live database, whose schema is not changed by the private development migration. Live activation is therefore a separate step.

STOP requests suppress inbox replies, booking-confirmation texts, and driver-dispatch texts. START clears the app's suppression. The webhook acknowledges incoming messages with empty TwiML; it sends no automatic text. Media attachments are not displayed.

Transport errors do not establish rejection. An uncertain reply remains pending and blocks further messages; staff can reconcile it against a matching Twilio sender, recipient, body, timestamp, and SID. A pending driver dispatch to the same number also blocks an inbox reply.

## Verification

`npm run test:sms-inbox` covers mocked-provider route checks and persistence/concurrency checks against the private development database. `npm run build` checks types and builds the frontend. These checks send no real SMS. A real delivery test requires a separately approved recipient and explicit send authorization.

-- A Twilio message SID can reconcile only one local dispatch attempt.
DROP INDEX IF EXISTS "DispatchMessage_providerMessageId_idx";
CREATE UNIQUE INDEX "DispatchMessage_providerMessageId_key"
  ON "DispatchMessage"("providerMessageId");
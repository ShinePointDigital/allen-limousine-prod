CREATE TABLE "SmsConversation" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "optedOutAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SmsConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "fromPhone" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "providerStatus" TEXT,
    "deliveryStatus" TEXT,
    "errorMessage" TEXT,
    "adminId" TEXT,
    "adminName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmsConversation_phone_key" ON "SmsConversation"("phone");
CREATE INDEX "SmsConversation_lastMessageAt_idx" ON "SmsConversation"("lastMessageAt");
CREATE UNIQUE INDEX "SmsMessage_providerMessageId_key" ON "SmsMessage"("providerMessageId");
CREATE INDEX "SmsMessage_conversationId_createdAt_idx" ON "SmsMessage"("conversationId", "createdAt");
CREATE INDEX "SmsMessage_status_createdAt_idx" ON "SmsMessage"("status", "createdAt");
CREATE UNIQUE INDEX "SmsMessage_one_pending_reply_per_thread_idx"
ON "SmsMessage"("conversationId") WHERE "direction" = 'OUTBOUND' AND "status" = 'PENDING';

ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "SmsConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_adminId_fkey"
FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

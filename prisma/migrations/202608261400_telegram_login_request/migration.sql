CREATE TABLE "TelegramLoginRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedAdminId" UUID,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "TelegramLoginRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramLoginRequest_tokenHash_key" ON "TelegramLoginRequest"("tokenHash");

CREATE INDEX "TelegramLoginRequest_expiresAt_idx" ON "TelegramLoginRequest"("expiresAt");

ALTER TABLE "TelegramLoginRequest"
ADD CONSTRAINT "TelegramLoginRequest_resolvedAdminId_fkey"
FOREIGN KEY ("resolvedAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Welcome (§30) + Rules (§29) -- chat-facing text content, Global+Chat+
-- useGlobalProfile like every other content/policy domain.
CREATE TABLE "ChatContentSettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chatId" UUID NOT NULL,
  "useGlobalProfile" BOOLEAN NOT NULL DEFAULT true,
  "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
  "welcomeMessageTemplate" TEXT NOT NULL DEFAULT 'Добро пожаловать, {name}! 👋

Чат «{group}» рад видеть вас — сейчас в нём {member_count} участников.',
  "rulesText" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ChatContentSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatContentSettings_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChatContentSettings_chatId_key" ON "ChatContentSettings"("chatId");

CREATE TABLE "GlobalContentSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
  "welcomeMessageTemplate" TEXT NOT NULL DEFAULT 'Добро пожаловать, {name}! 👋

Чат «{group}» рад видеть вас — сейчас в нём {member_count} участников.',
  "rulesText" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GlobalContentSettings_pkey" PRIMARY KEY ("id")
);

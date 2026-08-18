import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  GLOBAL_MODERATION_PROFILE_ID,
  resolveEffectiveModerationSettings
} from "./global-moderation-service";

test("chat moderation stays local by default and inherits global rules only after explicit opt-in", async () => {
  const telegramChatId = -1009000000701n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });

  const chat = await prisma.chat.create({
    data: {
      telegramChatId,
      title: "Global policy CI",
      type: "supergroup"
    }
  });

  try {
    await prisma.globalModerationSettings.upsert({
      where: { id: GLOBAL_MODERATION_PROFILE_ID },
      create: {
        id: GLOBAL_MODERATION_PROFILE_ID,
        blockLinks: true,
        allowedDomains: ["example.com"],
        spamEnabled: true,
        spamWindowSeconds: 15,
        spamMaxMessages: 4
      },
      update: {
        blockLinks: true,
        allowedDomains: ["example.com"],
        spamEnabled: true,
        spamWindowSeconds: 15,
        spamMaxMessages: 4
      }
    });

    await prisma.chatModerationSettings.create({
      data: {
        chatId: chat.id,
        blockLinks: false,
        spamEnabled: false,
        useGlobalProfile: false
      }
    });

    const local = await resolveEffectiveModerationSettings(chat.id);
    assert.equal(local.source, "CHAT");
    assert.equal(local.useGlobalProfile, false);
    assert.equal(local.settings.blockLinks, false);
    assert.equal(local.settings.spamEnabled, false);

    await prisma.chatModerationSettings.update({
      where: { chatId: chat.id },
      data: { useGlobalProfile: true }
    });

    const inherited = await resolveEffectiveModerationSettings(chat.id);
    assert.equal(inherited.source, "GLOBAL");
    assert.equal(inherited.useGlobalProfile, true);
    assert.equal(inherited.settings.blockLinks, true);
    assert.equal(inherited.settings.allowedDomains[0], "example.com");
    assert.equal(inherited.settings.spamWindowSeconds, 15);
    assert.equal(inherited.settings.spamMaxMessages, 4);

    const localStored = await prisma.chatModerationSettings.findUniqueOrThrow({
      where: { chatId: chat.id }
    });
    assert.equal(localStored.blockLinks, false);
    assert.equal(localStored.spamEnabled, false);
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { resolveEffectiveChatRole } from "./guards";

const CHAT_ID = -1009000016001n;
const GLOBAL_ADMIN_EMAIL = "guards-resolve-effective-role-ci@example.com";
const CHAT_ADMIN_TELEGRAM_USER_ID = 900001601n;
const NO_ACCESS_ADMIN_TELEGRAM_USER_ID = 900001602n;

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: GLOBAL_ADMIN_EMAIL } });
  await prisma.adminUser.deleteMany({
    where: { telegramUserId: { in: [CHAT_ADMIN_TELEGRAM_USER_ID, NO_ACCESS_ADMIN_TELEGRAM_USER_ID] } }
  });
}

async function setup() {
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Guards Resolve Effective Role CI", type: "supergroup" }
  });
  // A GLOBAL admin's role field is the only thing resolveEffectiveChatRole
  // should ever consult for scope: "GLOBAL" -- picking VIEWER here (an
  // otherwise-inert value elsewhere in this codebase) makes it obvious the
  // function isn't quietly promoting/demoting anyone.
  const globalAdmin = await prisma.adminUser.create({
    data: { email: GLOBAL_ADMIN_EMAIL, displayName: "CI Global Viewer", passwordHash: "not-used-in-test", role: "VIEWER", scope: "GLOBAL" }
  });
  const chatAdmin = await prisma.adminUser.create({
    data: {
      scope: "CHAT",
      role: "VIEWER",
      displayName: "CI Chat Admin",
      telegramUserId: CHAT_ADMIN_TELEGRAM_USER_ID
    }
  });
  await prisma.chatAdminAccess.create({
    data: { chatId: chat.id, adminId: chatAdmin.id, role: "ADMIN", grantedVia: "MANUAL" }
  });
  const noAccessChatAdmin = await prisma.adminUser.create({
    data: {
      scope: "CHAT",
      role: "VIEWER",
      displayName: "CI Chat Admin (no access)",
      telegramUserId: NO_ACCESS_ADMIN_TELEGRAM_USER_ID
    }
  });
  return { chat, globalAdmin, chatAdmin, noAccessChatAdmin };
}

test("resolveEffectiveChatRole: a GLOBAL admin's role passes through completely unchanged", async () => {
  await cleanup();
  const { chat, globalAdmin } = await setup();
  try {
    const resolved = await resolveEffectiveChatRole(globalAdmin, chat.id);
    // Byte-for-byte the same value as admin.role -- zero behavior change.
    assert.equal(resolved, globalAdmin.role);
    assert.equal(resolved, "VIEWER");
  } finally {
    await cleanup();
  }
});

test("resolveEffectiveChatRole: a CHAT admin resolves their ChatAdminAccess.role for that specific chat", async () => {
  await cleanup();
  const { chat, chatAdmin } = await setup();
  try {
    const resolved = await resolveEffectiveChatRole(chatAdmin, chat.id);
    assert.equal(resolved, "ADMIN");
    // Their inert global `role` field ("VIEWER") must never leak through.
    assert.notEqual(resolved, chatAdmin.role);
  } finally {
    await cleanup();
  }
});

test("resolveEffectiveChatRole: a CHAT admin with no ChatAdminAccess row for this chat falls back to VIEWER", async () => {
  await cleanup();
  const { chat, noAccessChatAdmin } = await setup();
  try {
    const resolved = await resolveEffectiveChatRole(noAccessChatAdmin, chat.id);
    assert.equal(resolved, "VIEWER");
  } finally {
    await cleanup();
  }
});

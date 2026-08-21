import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  AutoResponseError,
  createAutoResponseRule,
  deleteAutoResponseRule,
  findMatchingAutoResponse,
  listAutoResponseRules,
  MAX_AUTO_RESPONSE_RULES_PER_CHAT,
  updateAutoResponseRule
} from "./auto-response-service";

const CHAT_ID = -1009000020001n;
const ADMIN_EMAIL = "auto-response-service-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

async function setup() {
  const chat = await prisma.chat.create({ data: { telegramChatId: CHAT_ID, title: "Auto Response CI", type: "supergroup" } });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  return { chat, admin };
}

test("createAutoResponseRule normalizes the trigger, rejects a too-short trigger, and writes an audit log", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    const rule = await createAutoResponseRule({
      chatId: chat.id,
      actingAdminId: admin.id,
      trigger: "  Где ПРАВИЛА  ",
      matchType: "CONTAINS",
      responseText: "Смотрите /rules",
      enabled: true
    });
    assert.equal(rule.trigger, "где правила");

    const log = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "AUTO_RESPONSE_CREATED" } });
    assert.ok(log);

    await assert.rejects(
      () => createAutoResponseRule({ chatId: chat.id, actingAdminId: admin.id, trigger: "я", matchType: "CONTAINS", responseText: "x", enabled: true }),
      (error: unknown) => error instanceof AutoResponseError && error.code === "TRIGGER_TOO_SHORT"
    );
  } finally {
    await cleanup();
  }
});

test("createAutoResponseRule enforces the per-chat rule limit", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    for (let index = 0; index < MAX_AUTO_RESPONSE_RULES_PER_CHAT; index += 1) {
      await createAutoResponseRule({
        chatId: chat.id,
        actingAdminId: admin.id,
        trigger: `trigger-${index}`,
        matchType: "CONTAINS",
        responseText: "reply",
        enabled: true
      });
    }

    await assert.rejects(
      () => createAutoResponseRule({ chatId: chat.id, actingAdminId: admin.id, trigger: "one-too-many", matchType: "CONTAINS", responseText: "reply", enabled: true }),
      (error: unknown) => error instanceof AutoResponseError && error.code === "LIMIT_REACHED"
    );

    const rules = await listAutoResponseRules(chat.id);
    assert.equal(rules.length, MAX_AUTO_RESPONSE_RULES_PER_CHAT);
  } finally {
    await cleanup();
  }
});

test("updateAutoResponseRule rejects a rule id from a different chat; deleteAutoResponseRule removes it", async () => {
  await cleanup();
  const { chat, admin } = await setup();
  const other = await prisma.chat.create({ data: { telegramChatId: -1009000020002n, title: "Other CI", type: "supergroup" } });

  try {
    const rule = await createAutoResponseRule({ chatId: chat.id, actingAdminId: admin.id, trigger: "faq", matchType: "CONTAINS", responseText: "See /rules", enabled: true });

    await assert.rejects(
      () => updateAutoResponseRule({ chatId: other.id, ruleId: rule.id, actingAdminId: admin.id, trigger: "faq", matchType: "CONTAINS", responseText: "x", enabled: true }),
      (error: unknown) => error instanceof AutoResponseError && error.code === "RULE_NOT_FOUND"
    );

    await deleteAutoResponseRule({ chatId: chat.id, ruleId: rule.id, actingAdminId: admin.id });
    assert.deepEqual(await listAutoResponseRules(chat.id), []);

    const log = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "AUTO_RESPONSE_DELETED" } });
    assert.ok(log);
  } finally {
    await prisma.chat.delete({ where: { id: other.id } });
    await cleanup();
  }
});

test("findMatchingAutoResponse: CONTAINS matches a substring, EXACT requires the whole message, disabled rules never match", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    await createAutoResponseRule({ chatId: chat.id, actingAdminId: admin.id, trigger: "правила", matchType: "CONTAINS", responseText: "See /rules", enabled: true });
    await createAutoResponseRule({ chatId: chat.id, actingAdminId: admin.id, trigger: "цена", matchType: "EXACT", responseText: "100 руб.", enabled: true });
    await createAutoResponseRule({ chatId: chat.id, actingAdminId: admin.id, trigger: "выключено", matchType: "CONTAINS", responseText: "never", enabled: false });

    const containsMatch = await findMatchingAutoResponse(chat.id, "а где Правила чата?");
    assert.equal(containsMatch?.responseText, "See /rules");

    const exactMatch = await findMatchingAutoResponse(chat.id, "Цена");
    assert.equal(exactMatch?.responseText, "100 руб.");

    assert.equal(await findMatchingAutoResponse(chat.id, "сколько цена товара"), null);
    assert.equal(await findMatchingAutoResponse(chat.id, "тут выключено правило"), null);
    assert.equal(await findMatchingAutoResponse(chat.id, "просто сообщение"), null);
  } finally {
    await cleanup();
  }
});

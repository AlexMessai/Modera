import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  createCustomCommand,
  CustomCommandError,
  deleteCustomCommand,
  findCustomCommand,
  listCustomCommands,
  MAX_CUSTOM_COMMANDS_PER_CHAT,
  updateCustomCommand
} from "./custom-command-service";

const CHAT_ID = -1009000021001n;
const ADMIN_EMAIL = "custom-command-service-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

async function setup() {
  const chat = await prisma.chat.create({ data: { telegramChatId: CHAT_ID, title: "Custom Command CI", type: "supergroup" } });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  return { chat, admin };
}

test("createCustomCommand normalizes the trigger, rejects a reserved built-in name, and writes an audit log", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    const command = await createCustomCommand({ chatId: chat.id, actingAdminId: admin.id, trigger: "/PRICE", responseText: "100 руб.", adminOnly: false, enabled: true });
    assert.equal(command.trigger, "price");

    const log = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "CUSTOM_COMMAND_CREATED" } });
    assert.ok(log);

    await assert.rejects(
      () => createCustomCommand({ chatId: chat.id, actingAdminId: admin.id, trigger: "ban", responseText: "x", adminOnly: false, enabled: true }),
      (error: unknown) => error instanceof CustomCommandError && error.code === "RESERVED_TRIGGER"
    );

    await assert.rejects(
      () => createCustomCommand({ chatId: chat.id, actingAdminId: admin.id, trigger: "no spaces!", responseText: "x", adminOnly: false, enabled: true }),
      (error: unknown) => error instanceof CustomCommandError && error.code === "INVALID_TRIGGER"
    );
  } finally {
    await cleanup();
  }
});

test("createCustomCommand rejects a duplicate trigger in the same chat but allows it in a different chat", async () => {
  await cleanup();
  const { chat, admin } = await setup();
  const other = await prisma.chat.create({ data: { telegramChatId: -1009000021002n, title: "Other CI", type: "supergroup" } });

  try {
    await createCustomCommand({ chatId: chat.id, actingAdminId: admin.id, trigger: "faq", responseText: "See rules", adminOnly: false, enabled: true });

    await assert.rejects(
      () => createCustomCommand({ chatId: chat.id, actingAdminId: admin.id, trigger: "FAQ", responseText: "duplicate", adminOnly: false, enabled: true }),
      (error: unknown) => error instanceof CustomCommandError && error.code === "TRIGGER_TAKEN"
    );

    const inOtherChat = await createCustomCommand({ chatId: other.id, actingAdminId: admin.id, trigger: "faq", responseText: "different chat, same name", adminOnly: false, enabled: true });
    assert.equal(inOtherChat.trigger, "faq");
  } finally {
    await prisma.chat.delete({ where: { id: other.id } });
    await cleanup();
  }
});

test("createCustomCommand enforces the per-chat limit", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    for (let index = 0; index < MAX_CUSTOM_COMMANDS_PER_CHAT; index += 1) {
      await createCustomCommand({ chatId: chat.id, actingAdminId: admin.id, trigger: `cmd${index}`, responseText: "reply", adminOnly: false, enabled: true });
    }

    await assert.rejects(
      () => createCustomCommand({ chatId: chat.id, actingAdminId: admin.id, trigger: "onetoomany", responseText: "reply", adminOnly: false, enabled: true }),
      (error: unknown) => error instanceof CustomCommandError && error.code === "LIMIT_REACHED"
    );
  } finally {
    await cleanup();
  }
});

test("updateCustomCommand rejects a command id from a different chat; deleteCustomCommand removes it", async () => {
  await cleanup();
  const { chat, admin } = await setup();
  const other = await prisma.chat.create({ data: { telegramChatId: -1009000021003n, title: "Other CI", type: "supergroup" } });

  try {
    const command = await createCustomCommand({ chatId: chat.id, actingAdminId: admin.id, trigger: "contacts", responseText: "@support", adminOnly: false, enabled: true });

    await assert.rejects(
      () => updateCustomCommand({ chatId: other.id, commandId: command.id, actingAdminId: admin.id, trigger: "contacts", responseText: "x", adminOnly: false, enabled: true }),
      (error: unknown) => error instanceof CustomCommandError && error.code === "COMMAND_NOT_FOUND"
    );

    await deleteCustomCommand({ chatId: chat.id, commandId: command.id, actingAdminId: admin.id });
    assert.deepEqual(await listCustomCommands(chat.id), []);
  } finally {
    await prisma.chat.delete({ where: { id: other.id } });
    await cleanup();
  }
});

test("findCustomCommand: case-insensitive, only matches enabled commands", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    await createCustomCommand({ chatId: chat.id, actingAdminId: admin.id, trigger: "price", responseText: "100 руб.", adminOnly: false, enabled: true });
    await createCustomCommand({ chatId: chat.id, actingAdminId: admin.id, trigger: "disabled", responseText: "never", adminOnly: false, enabled: false });

    assert.equal((await findCustomCommand(chat.id, "PRICE"))?.responseText, "100 руб.");
    assert.equal(await findCustomCommand(chat.id, "disabled"), null);
    assert.equal(await findCustomCommand(chat.id, "unknown"), null);
  } finally {
    await cleanup();
  }
});

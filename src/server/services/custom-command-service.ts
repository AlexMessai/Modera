import { prisma } from "@/server/db/prisma";
import type { CustomCommand } from "@/generated/prisma/client";

export const MAX_CUSTOM_COMMANDS_PER_CHAT = 20;
const TRIGGER_PATTERN = /^[a-z0-9_]{2,32}$/;

// Every built-in group/private command this bot already handles -- a
// custom command reusing one of these would either be silently shadowed
// (built-ins are checked first, see update-handler.ts) or, worse, look like
// it did something when it's actually inert. Rejected outright at
// create/update time rather than relying solely on dispatch order.
const RESERVED_TRIGGERS = new Set([
  "warn", "unwarn", "mute", "unmute", "ban", "unban", "kick",
  "warns", "info", "rules", "silence", "unsilence", "report",
  "settings", "appeal", "start", "help", "status", "link"
]);

export type CustomCommandValue = {
  id: string;
  trigger: string;
  responseText: string;
  adminOnly: boolean;
  enabled: boolean;
};

function serialize(command: CustomCommand): CustomCommandValue {
  return { id: command.id, trigger: command.trigger, responseText: command.responseText, adminOnly: command.adminOnly, enabled: command.enabled };
}

export class CustomCommandError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CustomCommandError";
  }
}

function normalizeTrigger(value: string) {
  const trimmed = value.trim().toLowerCase().replace(/^\//, "");
  if (!TRIGGER_PATTERN.test(trimmed)) {
    throw new CustomCommandError("INVALID_TRIGGER", "Название команды: 2-32 символа, только латинские буквы, цифры и подчёркивание.");
  }
  if (RESERVED_TRIGGERS.has(trimmed)) {
    throw new CustomCommandError("RESERVED_TRIGGER", `/${trimmed} — уже встроенная команда бота, выберите другое название.`);
  }
  return trimmed;
}

function normalizeResponseText(value: string) {
  const trimmed = value.trim().slice(0, 1000);
  if (!trimmed) throw new CustomCommandError("RESPONSE_REQUIRED", "Укажите текст ответа.");
  return trimmed;
}

export async function listCustomCommands(chatId: string): Promise<CustomCommandValue[]> {
  const commands = await prisma.customCommand.findMany({ where: { chatId }, orderBy: { createdAt: "asc" } });
  return commands.map(serialize);
}

export async function createCustomCommand(input: {
  chatId: string;
  actingAdminId: string;
  trigger: string;
  responseText: string;
  adminOnly: boolean;
  enabled: boolean;
}): Promise<CustomCommandValue> {
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) throw new CustomCommandError("CHAT_NOT_FOUND", "Чат не найден.");

  const count = await prisma.customCommand.count({ where: { chatId: input.chatId } });
  if (count >= MAX_CUSTOM_COMMANDS_PER_CHAT) {
    throw new CustomCommandError("LIMIT_REACHED", `Достигнут лимит команд на чат (${MAX_CUSTOM_COMMANDS_PER_CHAT}).`);
  }

  const trigger = normalizeTrigger(input.trigger);
  const responseText = normalizeResponseText(input.responseText);

  const existing = await prisma.customCommand.findUnique({ where: { chatId_trigger: { chatId: input.chatId, trigger } } });
  if (existing) throw new CustomCommandError("TRIGGER_TAKEN", `Команда /${trigger} уже существует в этом чате.`);

  return prisma.$transaction(async (tx) => {
    const command = await tx.customCommand.create({
      data: { chatId: input.chatId, trigger, responseText, adminOnly: input.adminOnly, enabled: input.enabled }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CUSTOM_COMMAND_CREATED",
        metadata: { commandId: command.id, trigger: command.trigger }
      }
    });
    return command;
  }).then(serialize);
}

export async function updateCustomCommand(input: {
  chatId: string;
  commandId: string;
  actingAdminId: string;
  trigger: string;
  responseText: string;
  adminOnly: boolean;
  enabled: boolean;
}): Promise<CustomCommandValue> {
  const existing = await prisma.customCommand.findUnique({ where: { id: input.commandId } });
  if (!existing || existing.chatId !== input.chatId) throw new CustomCommandError("COMMAND_NOT_FOUND", "Команда не найдена в этом чате.");

  const trigger = normalizeTrigger(input.trigger);
  const responseText = normalizeResponseText(input.responseText);

  if (trigger !== existing.trigger) {
    const collision = await prisma.customCommand.findUnique({ where: { chatId_trigger: { chatId: input.chatId, trigger } } });
    if (collision) throw new CustomCommandError("TRIGGER_TAKEN", `Команда /${trigger} уже существует в этом чате.`);
  }

  return prisma.$transaction(async (tx) => {
    const command = await tx.customCommand.update({
      where: { id: input.commandId },
      data: { trigger, responseText, adminOnly: input.adminOnly, enabled: input.enabled }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CUSTOM_COMMAND_UPDATED",
        metadata: { commandId: command.id, trigger: command.trigger, enabled: command.enabled }
      }
    });
    return command;
  }).then(serialize);
}

export async function deleteCustomCommand(input: { chatId: string; commandId: string; actingAdminId: string }) {
  const existing = await prisma.customCommand.findUnique({ where: { id: input.commandId } });
  if (!existing || existing.chatId !== input.chatId) throw new CustomCommandError("COMMAND_NOT_FOUND", "Команда не найдена в этом чате.");

  await prisma.$transaction(async (tx) => {
    await tx.customCommand.delete({ where: { id: input.commandId } });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CUSTOM_COMMAND_DELETED",
        metadata: { commandId: input.commandId, trigger: existing.trigger }
      }
    });
  });
}

/** Matches a group message's command word (already lowercased, without the leading slash or @botname) against this chat's enabled custom commands. */
export async function findCustomCommand(chatId: string, commandWord: string) {
  return prisma.customCommand.findFirst({ where: { chatId, trigger: commandWord.toLowerCase(), enabled: true } });
}

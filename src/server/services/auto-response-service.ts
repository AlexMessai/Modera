import { prisma } from "@/server/db/prisma";
import type { AutoResponseMatch, AutoResponseRule } from "@/generated/prisma/client";

export const AUTO_RESPONSE_MATCH_TYPES = ["CONTAINS", "EXACT"] as const;
export const MAX_AUTO_RESPONSE_RULES_PER_CHAT = 20;
const MIN_TRIGGER_LENGTH = 2;

export type AutoResponseRuleValue = {
  id: string;
  trigger: string;
  matchType: AutoResponseMatch;
  responseText: string;
  enabled: boolean;
};

function serializeAutoResponseRule(rule: AutoResponseRule): AutoResponseRuleValue {
  return { id: rule.id, trigger: rule.trigger, matchType: rule.matchType, responseText: rule.responseText, enabled: rule.enabled };
}

export class AutoResponseError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AutoResponseError";
  }
}

function normalizeTrigger(value: string) {
  const trimmed = value.trim().toLowerCase().slice(0, 200);
  if (trimmed.length < MIN_TRIGGER_LENGTH) {
    throw new AutoResponseError("TRIGGER_TOO_SHORT", `Триггер должен быть не короче ${MIN_TRIGGER_LENGTH} символов.`);
  }
  return trimmed;
}

function normalizeResponseText(value: string) {
  const trimmed = value.trim().slice(0, 1000);
  if (!trimmed) throw new AutoResponseError("RESPONSE_REQUIRED", "Укажите текст ответа.");
  return trimmed;
}

export async function listAutoResponseRules(chatId: string): Promise<AutoResponseRuleValue[]> {
  const rules = await prisma.autoResponseRule.findMany({ where: { chatId }, orderBy: { createdAt: "asc" } });
  return rules.map(serializeAutoResponseRule);
}

export async function createAutoResponseRule(input: {
  chatId: string;
  actingAdminId: string;
  trigger: string;
  matchType: AutoResponseMatch;
  responseText: string;
  enabled: boolean;
}) {
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) throw new AutoResponseError("CHAT_NOT_FOUND", "Чат не найден.");

  const count = await prisma.autoResponseRule.count({ where: { chatId: input.chatId } });
  if (count >= MAX_AUTO_RESPONSE_RULES_PER_CHAT) {
    throw new AutoResponseError("LIMIT_REACHED", `Достигнут лимит правил на чат (${MAX_AUTO_RESPONSE_RULES_PER_CHAT}).`);
  }

  const trigger = normalizeTrigger(input.trigger);
  const responseText = normalizeResponseText(input.responseText);

  return prisma.$transaction(async (tx) => {
    const rule = await tx.autoResponseRule.create({
      data: { chatId: input.chatId, trigger, matchType: input.matchType, responseText, enabled: input.enabled }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "AUTO_RESPONSE_CREATED",
        metadata: { ruleId: rule.id, trigger: rule.trigger, matchType: rule.matchType }
      }
    });
    return rule;
  }).then(serializeAutoResponseRule);
}

export async function updateAutoResponseRule(input: {
  chatId: string;
  ruleId: string;
  actingAdminId: string;
  trigger: string;
  matchType: AutoResponseMatch;
  responseText: string;
  enabled: boolean;
}) {
  const existing = await prisma.autoResponseRule.findUnique({ where: { id: input.ruleId } });
  if (!existing || existing.chatId !== input.chatId) throw new AutoResponseError("RULE_NOT_FOUND", "Правило не найдено в этом чате.");

  const trigger = normalizeTrigger(input.trigger);
  const responseText = normalizeResponseText(input.responseText);

  return prisma.$transaction(async (tx) => {
    const rule = await tx.autoResponseRule.update({
      where: { id: input.ruleId },
      data: { trigger, matchType: input.matchType, responseText, enabled: input.enabled }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "AUTO_RESPONSE_UPDATED",
        metadata: { ruleId: rule.id, trigger: rule.trigger, matchType: rule.matchType, enabled: rule.enabled }
      }
    });
    return rule;
  }).then(serializeAutoResponseRule);
}

export async function deleteAutoResponseRule(input: { chatId: string; ruleId: string; actingAdminId: string }) {
  const existing = await prisma.autoResponseRule.findUnique({ where: { id: input.ruleId } });
  if (!existing || existing.chatId !== input.chatId) throw new AutoResponseError("RULE_NOT_FOUND", "Правило не найдено в этом чате.");

  await prisma.$transaction(async (tx) => {
    await tx.autoResponseRule.delete({ where: { id: input.ruleId } });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "AUTO_RESPONSE_DELETED",
        metadata: { ruleId: input.ruleId, trigger: existing.trigger }
      }
    });
  });
}

/** Checked against every regular (non-command) group message text -- see update-handler.ts. Case-insensitive; returns the first enabled rule that matches, in creation order. */
export async function findMatchingAutoResponse(chatId: string, messageText: string) {
  const text = messageText.trim().toLowerCase();
  if (!text) return null;

  const rules = await prisma.autoResponseRule.findMany({
    where: { chatId, enabled: true },
    orderBy: { createdAt: "asc" }
  });

  for (const rule of rules) {
    if (rule.matchType === "EXACT" ? text === rule.trigger : text.includes(rule.trigger)) {
      return rule;
    }
  }
  return null;
}

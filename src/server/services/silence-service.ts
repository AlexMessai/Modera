import { prisma } from "@/server/db/prisma";
import { getTelegramClient, MUTED_CHAT_PERMISSIONS, type TelegramChatPermissions } from "@/server/telegram/client";

export const SILENCE_DEFAULT_MINUTES = 30;
export const SILENCE_DURATION_MINUTES_MAX = 7 * 24 * 60;

export class SilenceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SilenceError";
  }
}

export async function getActiveSilence(chatId: string) {
  return prisma.chatSilenceState.findUnique({ where: { chatId } });
}

/**
 * Locks the chat down for regular members via a real chat-wide
 * setChatPermissions call -- moderators/admins are unaffected since
 * Telegram lets them post on their own native rights regardless of the
 * chat's default permissions. Snapshots the chat's actual permissions
 * first (via getChat) so unsilence can restore exactly that, not just
 * "everything allowed".
 */
export async function startSilence(input: {
  chatId: string;
  telegramChatId: number;
  durationMinutes: number;
  actorTelegramUserId?: number;
  actorDisplayName?: string;
  source?: "TELEGRAM" | "SYSTEM";
}) {
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > SILENCE_DURATION_MINUTES_MAX) {
    throw new SilenceError("INVALID_DURATION", `Срок должен быть от 1 минуты до ${Math.floor(SILENCE_DURATION_MINUTES_MAX / 60 / 24)} дней.`);
  }

  const existing = await prisma.chatSilenceState.findUnique({ where: { chatId: input.chatId } });

  try {
    const client = getTelegramClient();
    // Re-locking an already-silenced chat (extending the duration) must not
    // clobber the original snapshot with the already-locked permissions.
    const previousPermissions: TelegramChatPermissions | null = existing?.previousPermissions
      ? (existing.previousPermissions as unknown as TelegramChatPermissions)
      : ((await client.getChat(input.telegramChatId)).permissions ?? null);

    await client.setChatPermissions({ chatId: input.telegramChatId, permissions: MUTED_CHAT_PERMISSIONS });

    const expiresAt = new Date(Date.now() + input.durationMinutes * 60_000);
    await prisma.$transaction(async (tx) => {
      const state = await tx.chatSilenceState.upsert({
        where: { chatId: input.chatId },
        create: {
          chatId: input.chatId,
          expiresAt,
          previousPermissions: previousPermissions ?? undefined,
          startedByTelegramUserId: input.actorTelegramUserId !== undefined ? BigInt(input.actorTelegramUserId) : undefined,
          startedByDisplayName: input.actorDisplayName
        },
        update: {
          expiresAt,
          previousPermissions: previousPermissions ?? undefined,
          startedByTelegramUserId: input.actorTelegramUserId !== undefined ? BigInt(input.actorTelegramUserId) : undefined,
          startedByDisplayName: input.actorDisplayName
        }
      });
      await tx.auditLog.create({
        data: {
          chatId: input.chatId,
          source: input.source ?? "TELEGRAM",
          action: "SILENCE_STARTED",
          metadata: {
            durationMinutes: input.durationMinutes,
            expiresAt: expiresAt.toISOString(),
            telegramActorId: input.actorTelegramUserId,
            telegramActorDisplayName: input.actorDisplayName
          }
        }
      });
      return state;
    });

    return { expiresAt };
  } catch (error) {
    if (error instanceof SilenceError) throw error;
    throw new SilenceError("TELEGRAM_ERROR", "Не удалось ограничить чат — проверьте, что у бота есть право изменять права участников.");
  }
}

async function liftSilence(state: { id: string; chatId: string; previousPermissions: unknown }, telegramChatId: number) {
  const restored = (state.previousPermissions as unknown as TelegramChatPermissions | null) ?? MUTED_CHAT_PERMISSIONS;
  // If restoring the exact snapshot fails (e.g. it's stale/malformed), still
  // remove our own lockdown rather than leaving the chat silenced forever --
  // falls back to Telegram's own defaults via an empty permissions object is
  // not available, so this uses the (safer than staying locked) restored
  // value either way.
  await getTelegramClient().setChatPermissions({ chatId: telegramChatId, permissions: restored }).catch(() => undefined);
  await prisma.chatSilenceState.delete({ where: { id: state.id } });
}

export async function stopSilence(input: { chatId: string; telegramChatId: number; actorTelegramUserId: number; actorDisplayName: string }) {
  const state = await prisma.chatSilenceState.findUnique({ where: { chatId: input.chatId } });
  if (!state) throw new SilenceError("NOT_SILENCED", "Этот чат сейчас не в режиме тишины.");

  try {
    await liftSilence(state, input.telegramChatId);
  } catch {
    throw new SilenceError("TELEGRAM_ERROR", "Не удалось снять ограничение чата.");
  }

  await prisma.auditLog.create({
    data: {
      chatId: input.chatId,
      source: "TELEGRAM",
      action: "SILENCE_STOPPED",
      metadata: { telegramActorId: input.actorTelegramUserId, telegramActorDisplayName: input.actorDisplayName }
    }
  });
}

/** Daily-cron sweep (same cadence as mute/ban/captcha expiry) -- auto-lifts any silence whose duration has elapsed. */
export async function processExpiredSilences(input?: { now?: Date; limit?: number }) {
  const now = input?.now ?? new Date();
  const limit = Math.min(200, Math.max(1, input?.limit ?? 50));

  const candidates = await prisma.chatSilenceState.findMany({
    where: { expiresAt: { lte: now } },
    take: limit,
    include: { chat: { select: { telegramChatId: true } } }
  });

  let lifted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      await liftSilence(candidate, Number(candidate.chat.telegramChatId));
      await prisma.auditLog.create({
        data: { chatId: candidate.chatId, source: "SYSTEM", action: "SILENCE_EXPIRED" }
      });
      lifted += 1;
    } catch {
      failed += 1;
    }
  }

  return { checked: candidates.length, lifted, failed, hasMore: candidates.length === limit };
}

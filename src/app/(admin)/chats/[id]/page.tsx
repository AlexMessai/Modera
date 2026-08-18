import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ChatModerationSettings } from "@/components/chat-moderation-settings";
import { canManageChatSettings } from "@/server/auth/permissions";
import { requireAdminPage } from "@/server/auth/guards";
import { getChatModerationProfile } from "@/server/services/chat-moderation-settings-service";

export const dynamic = "force-dynamic";

const eventLabels: Record<string, string> = {
  AUTOMOD_LINK_DELETED: "Удалена запрещённая ссылка",
  AUTOMOD_TERM_DELETED: "Удалено запрещённое слово или фраза",
  AUTOMOD_MEDIA_DELETED: "Удалён запрещённый тип контента",
  AUTOMOD_MENTIONS_DELETED: "Удалено за массовые упоминания",
  AUTOMOD_DUPLICATE_DELETED: "Удалено повторяющееся сообщение",
  AUTOMOD_SPAM_DELETED: "Удалено сообщение за флуд",
  AUTOMOD_DELETE_FAILED: "Telegram не удалил сообщение",
  AUTOMOD_SETTINGS_UPDATED: "Настройки автомодерации изменены"
};

const botStatusLabels: Record<string, string> = {
  ACTIVE: "Активен",
  CONNECTED: "Подключён",
  NOT_ADMIN: "Не администратор",
  INSUFFICIENT_PERMISSIONS: "Недостаточно прав",
  REMOVED: "Удалён из чата",
  DISABLED: "Отключён",
  TELEGRAM_ERROR: "Ошибка Telegram"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default async function ChatModerationPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdminPage();
  const { id } = await params;
  const profile = await getChatModerationProfile(id);
  if (!profile) notFound();

  return (
    <main className="page">
      <header className="page-header chat-detail-header">
        <div>
          <Link className="back-link" href="/chats">
            <ArrowLeft size={15} /> Чаты
          </Link>
          <span className="eyebrow">Telegram · Автомодерация</span>
          <h1>{profile.chat.title}</h1>
          <p>
            {profile.chat.username ? `@${profile.chat.username} · ` : ""}
            {profile.chat.type === "supergroup" ? "Супергруппа" : "Группа"} · ID {profile.chat.telegramChatId}
          </p>
        </div>
        <div className="chat-detail-status">
          <span className={`badge badge--${profile.bot.status.toLowerCase()}`}>
            {botStatusLabels[profile.bot.status] ?? profile.bot.status}
          </span>
          <small>
            Удаление сообщений: {profile.bot.canDeleteMessages ? "разрешено" : "нет права"}
          </small>
        </div>
      </header>

      <section className="panel profile-section">
        <div className="panel-header">
          <div>
            <h2>Правила чата</h2>
            <p>Все автоматические удаления выключены по умолчанию и включаются только явно.</p>
          </div>
        </div>
        <ChatModerationSettings
          chatId={profile.chat.id}
          initial={profile.settings}
          canEdit={canManageChatSettings(admin.role)}
          botCanDeleteMessages={profile.bot.canDeleteMessages}
        />
      </section>

      <section className="panel profile-section">
        <div className="panel-header">
          <div>
            <h2>Журнал автомодерации</h2>
            <p>Только реальные удаления, ошибки Telegram и изменения правил.</p>
          </div>
        </div>

        {profile.events.length === 0 ? (
          <div className="state-box state-box--compact">
            <strong>Событий пока нет</strong>
            <p>После срабатывания правил здесь появится запись с пользователем и причиной.</p>
          </div>
        ) : (
          <div className="audit-list automod-audit-list">
            {profile.events.map((event) => (
              <div className="audit-row" key={event.id}>
                <span className="audit-dot" />
                <div>
                  <strong>{eventLabels[event.action] ?? "Системное событие"}</strong>
                  <span>
                    {event.affectedUser?.displayName ?? event.actingAdmin?.displayName ?? "Система"}
                    {event.reason ? ` · ${event.reason}` : ""}
                  </span>
                </div>
                <time>{formatDate(event.createdAt)}</time>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

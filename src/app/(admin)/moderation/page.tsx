import Link from "next/link";
import { AlertTriangle, ArrowUpRight, ShieldCheck } from "lucide-react";
import { getModerationDashboard } from "@/server/services/moderation-dashboard-service";

export const dynamic = "force-dynamic";

const ruleLabels: Record<string, string> = {
  LINKS: "Ссылки",
  TERMS: "Слова",
  FLOOD: "Флуд",
  DUPLICATES: "Повторы",
  MENTIONS: "Упоминания",
  MEDIA: "Контент"
};

const statusLabels: Record<string, string> = {
  ACTIVE: "Активен",
  CONNECTED: "Подключён",
  NOT_ADMIN: "Не администратор",
  INSUFFICIENT_PERMISSIONS: "Недостаточно прав",
  REMOVED: "Удалён",
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

export default async function ModerationPage() {
  const data = await getModerationDashboard();

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Политики и автоматизация</span>
          <h1>Модерация</h1>
          <p>Состояние правил по всем чатам, права Telegram-бота и реальные срабатывания за последние 24 часа.</p>
        </div>
      </header>

      <section className="metrics-grid moderation-metrics">
        <article className="metric-card"><span>Чатов</span><strong>{data.metrics.totalChats.toLocaleString("ru-RU")}</strong><small>Получены через Telegram</small></article>
        <article className="metric-card"><span>С правилами</span><strong>{data.metrics.configuredChats.toLocaleString("ru-RU")}</strong><small>Хотя бы одно правило включено</small></article>
        <article className="metric-card"><span>Срабатываний за 24 ч</span><strong>{data.metrics.automod24h.toLocaleString("ru-RU")}</strong><small>Успешные автоматические удаления</small></article>
        <article className="metric-card"><span>Ошибок за 24 ч</span><strong>{data.metrics.errors24h.toLocaleString("ru-RU")}</strong><small>Telegram не выполнил удаление</small></article>
      </section>

      {data.metrics.chatsWithoutDeletePermission > 0 ? (
        <div className="moderation-notice moderation-overview-warning">
          <AlertTriangle size={17} />
          <span>
            В {data.metrics.chatsWithoutDeletePermission} {data.metrics.chatsWithoutDeletePermission === 1 ? "чате" : "чатах"} правила включены, но по последней проверке у бота нет права удаления сообщений.
          </span>
        </div>
      ) : null}

      <section className="panel table-panel moderation-chat-panel">
        <div className="panel-header">
          <div>
            <h2>Политики чатов</h2>
            <p>Нажмите на чат, чтобы изменить правила. Все автоматические удаления остаются opt-in.</p>
          </div>
          <ShieldCheck size={19} />
        </div>

        {data.chats.length === 0 ? (
          <div className="state-box"><strong>Чатов пока нет</strong><p>После первого Telegram update чат появится здесь автоматически.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table moderation-chat-table">
              <thead><tr><th>Чат</th><th>Правила</th><th>Удаление сообщений</th><th>Статус бота</th><th>Активность</th><th /></tr></thead>
              <tbody>
                {data.chats.map((chat) => (
                  <tr key={chat.id}>
                    <td><div className="stacked-cell"><strong>{chat.title}</strong><span>{chat.username ? `@${chat.username}` : chat.telegramChatId}</span></div></td>
                    <td>
                      {chat.rules.length ? <div className="rule-chip-list">{chat.rules.map((rule) => <span className="rule-chip" key={rule}>{ruleLabels[rule] ?? rule}</span>)}</div> : <span className="muted">Выключены</span>}
                    </td>
                    <td><span className={`badge ${chat.canDeleteMessages ? "badge--active" : chat.rules.length ? "badge--danger" : ""}`}>{chat.canDeleteMessages ? "Есть право" : "Нет права"}</span></td>
                    <td><span className={`badge badge--${chat.botStatus.toLowerCase()}`}>{statusLabels[chat.botStatus] ?? chat.botStatus}</span>{chat.lastError ? <div className="row-note">{chat.lastError}</div> : null}</td>
                    <td>{formatDate(chat.lastActivityAt)}</td>
                    <td><Link className="icon-button" href={`/chats/${chat.id}`} title="Открыть правила" aria-label="Открыть правила"><ArrowUpRight size={16} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

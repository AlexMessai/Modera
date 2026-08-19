import Link from "next/link";
import { AlertTriangle, ArrowUpRight, ShieldCheck } from "lucide-react";
import { ModerationWorkspace } from "@/components/moderation-workspace-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { getGlobalCaptchaProfile } from "@/server/services/captcha-settings-service";
import { getModerationDashboard } from "@/server/services/moderation-dashboard-service";

export const dynamic = "force-dynamic";

const ruleLabels: Record<string, string> = {
  LINKS: "Ссылки", TERMS: "Слова", FLOOD: "Флуд", DUPLICATES: "Повторы", MENTIONS: "Упоминания", MEDIA: "Контент", PUNISHMENTS: "Автонаказания"
};

const statusLabels: Record<string, string> = {
  ACTIVE: "Активен", CONNECTED: "Подключён", NOT_ADMIN: "Не администратор", INSUFFICIENT_PERMISSIONS: "Недостаточно прав", REMOVED: "Удалён", DISABLED: "Отключён", TELEGRAM_ERROR: "Ошибка Telegram"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default async function ModerationPage() {
  const [admin, data, captchaProfile] = await Promise.all([
    requireAdminPage(),
    getModerationDashboard(),
    getGlobalCaptchaProfile()
  ]);
  const canEdit = canManageChatSettings(admin.role);

  return (
    <main className="page">
      <header className="page-header"><div><span className="eyebrow">Политики и автоматизация</span><h1>Модерация</h1><p>Глобальная политика, капча и индивидуальные правила чатов в одном месте.</p></div></header>

      <ModerationWorkspace
        automodInitial={data.globalProfile.settings}
        captchaInitial={captchaProfile.settings}
        canEdit={canEdit}
      />

      <section className="metrics-grid moderation-metrics">
        <article className="metric-card"><span>Чатов</span><strong>{data.metrics.totalChats.toLocaleString("ru-RU")}</strong><small>Получены через Telegram</small></article>
        <article className="metric-card"><span>С правилами</span><strong>{data.metrics.configuredChats.toLocaleString("ru-RU")}</strong><small>По эффективной политике</small></article>
        <article className="metric-card"><span>Наследуют глобальные</span><strong>{data.metrics.inheritedChats.toLocaleString("ru-RU")}</strong><small>Переключены вручную</small></article>
        <article className="metric-card"><span>Событий automod за 24 ч</span><strong>{data.metrics.automod24h.toLocaleString("ru-RU")}</strong><small>{data.metrics.errors24h.toLocaleString("ru-RU")} ошибок</small></article>
      </section>

      {data.metrics.chatsWithoutDeletePermission > 0 ? <div className="moderation-notice moderation-overview-warning"><AlertTriangle size={17} /><span>В {data.metrics.chatsWithoutDeletePermission} {data.metrics.chatsWithoutDeletePermission === 1 ? "чате" : "чатах"} правила удаления включены, но у бота нет права удаления сообщений.</span></div> : null}
      {data.metrics.escalationWithoutRestrictPermission > 0 ? <div className="moderation-notice moderation-overview-warning"><AlertTriangle size={17} /><span>В {data.metrics.escalationWithoutRestrictPermission} {data.metrics.escalationWithoutRestrictPermission === 1 ? "чате" : "чатах"} включены автонаказания, но у бота нет права ограничивать участников.</span></div> : null}

      <section className="panel table-panel moderation-chat-panel">
        <div className="panel-header"><div><h2>Политики чатов</h2><p>Откройте чат, чтобы выбрать глобальное наследование или изменить индивидуальные правила.</p></div><ShieldCheck size={19} /></div>
        {data.chats.length === 0 ? <div className="state-box"><strong>Чатов пока нет</strong><p>После первого Telegram update чат появится здесь автоматически.</p></div> : (
          <div className="table-wrap"><table className="data-table moderation-chat-table"><thead><tr><th>Чат</th><th>Профиль</th><th>Правила</th><th>Права бота</th><th>Статус</th><th>Активность</th><th /></tr></thead><tbody>
            {data.chats.map((chat) => <tr key={chat.id}>
              <td><div className="stacked-cell"><strong>{chat.title}</strong><span>{chat.username ? `@${chat.username}` : chat.telegramChatId}</span></div></td>
              <td><span className={`badge ${chat.policySource === "GLOBAL" ? "badge--active" : ""}`}>{chat.policySource === "GLOBAL" ? "Глобальный" : "Индивидуальный"}</span></td>
              <td>{chat.rules.length ? <div className="rule-chip-list">{chat.rules.map((rule) => <span className="rule-chip" key={rule}>{ruleLabels[rule] ?? rule}</span>)}</div> : <span className="muted">Выключены</span>}</td>
              <td><div className="stacked-cell"><span className={`badge ${chat.canDeleteMessages ? "badge--active" : ""}`}>Удаление: {chat.canDeleteMessages ? "да" : "нет"}</span><span className={`badge ${chat.canRestrictMembers ? "badge--active" : chat.autoEscalationEnabled ? "badge--danger" : ""}`}>Ограничения: {chat.canRestrictMembers ? "да" : "нет"}</span></div></td>
              <td><span className={`badge badge--${chat.botStatus.toLowerCase()}`}>{statusLabels[chat.botStatus] ?? chat.botStatus}</span>{chat.lastError ? <div className="row-note">{chat.lastError}</div> : null}</td>
              <td>{formatDate(chat.lastActivityAt)}</td>
              <td><Link className="icon-button" href={`/chats/${chat.id}`} title="Открыть правила" aria-label="Открыть правила"><ArrowUpRight size={16} /></Link></td>
            </tr>)}
          </tbody></table></div>
        )}
      </section>
    </main>
  );
}
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Database,
  RefreshCw,
  Send,
  ServerCog,
  Webhook
} from "lucide-react";

type CheckStatus = "ok" | "warning" | "error" | "not_configured";

type Diagnostics = {
  checkedAt: string;
  checks: {
    database: { status: CheckStatus; latencyMs: number | null; error: string | null };
    telegram: { status: CheckStatus; latencyMs: number | null; botId: string | null; username: string | null; firstName: string | null; error: string | null };
    webhook: { status: CheckStatus; url: string | null; expectedUrl: string | null; urlMatchesExpected: boolean | null; pendingUpdateCount: number | null; lastErrorAt: string | null; lastErrorMessage: string | null; error: string | null };
  };
  application: {
    chats: number;
    activeBotLinks: number;
    problematicBotLinks: number;
    pendingModerationActions: number;
    failedModerationActions24h: number;
    automodDeleteErrors24h: number;
    messages24h: number;
  };
  configuration: {
    appUrlConfigured: boolean;
    appUrl: string | null;
    databaseConfigured: boolean;
    telegramBotTokenConfigured: boolean;
    telegramWebhookSecretConfigured: boolean;
    telegramWebhookUrlConfigured: boolean;
    adminEmailConfigured: boolean;
    adminPasswordConfigured: boolean;
    environment: string;
    nodeEnv: string;
  };
  problemChats: Array<{ id: string; title: string; telegramChatId: string; status: string; lastError: string | null; updatedAt: string }>;
  recentErrors: Array<{ id: string; action: string; reason: string | null; createdAt: string; chat: { id: string; title: string } | null; affectedUser: { id: string; displayName: string } | null }>;
};

const statusLabels: Record<CheckStatus, string> = {
  ok: "Работает",
  warning: "Требует внимания",
  error: "Ошибка",
  not_configured: "Не настроено"
};

const botStatusLabels: Record<string, string> = {
  ACTIVE: "Активен",
  CONNECTED: "Подключён",
  NOT_ADMIN: "Не администратор",
  INSUFFICIENT_PERMISSIONS: "Недостаточно прав",
  REMOVED: "Удалён",
  DISABLED: "Отключён",
  TELEGRAM_ERROR: "Ошибка Telegram"
};

const errorLabels: Record<string, string> = {
  MODERATION_ACTION_FAILED: "Ошибка ручной модерации",
  AUTOMOD_DELETE_FAILED: "Ошибка автоматического удаления",
  AUTOMOD_ESCALATION_FAILED: "Ошибка автоматического наказания",
  MANUAL_MESSAGE_DELETE_FAILED: "Ошибка ручного удаления сообщения"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

async function requestDiagnostics() {
  const response = await fetch("/api/system/status", { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось получить системную диагностику.");
  return payload.data as Diagnostics;
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "ok") return <CheckCircle2 size={18} />;
  if (status === "warning") return <AlertTriangle size={18} />;
  return <CircleAlert size={18} />;
}

function ConfigRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string | null }) {
  return (
    <div className="system-config-row">
      <span className={`system-config-dot ${ok ? "system-config-dot--ok" : "system-config-dot--bad"}`} />
      <div><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</div>
      <span>{ok ? "Настроено" : "Не настроено"}</span>
    </div>
  );
}

export function SystemClient() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const update = () => {
      void requestDiagnostics()
        .then((next) => {
          if (!active) return;
          setData(next);
          setError(null);
          setLoading(false);
        })
        .catch((caught: unknown) => {
          if (!active) return;
          setError(caught instanceof Error ? caught.message : "Не удалось получить диагностику.");
          setLoading(false);
        });
    };
    update();
    const interval = window.setInterval(update, 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  function refresh() {
    setLoading(true);
    void requestDiagnostics()
      .then((next) => { setData(next); setError(null); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Не удалось получить диагностику."))
      .finally(() => setLoading(false));
  }

  if (!data && loading) return <div className="panel state-box">Проверяю PostgreSQL, Telegram и webhook…</div>;
  if (!data) return <div className="panel state-box state-box--error">{error ?? "Диагностика недоступна."}</div>;

  const checks = [
    { key: "database", title: "PostgreSQL", subtitle: data.checks.database.latencyMs !== null ? `${data.checks.database.latencyMs} мс` : "Нет ответа", status: data.checks.database.status, error: data.checks.database.error, icon: Database },
    { key: "telegram", title: "Telegram Bot API", subtitle: data.checks.telegram.username ? `@${data.checks.telegram.username}` : data.checks.telegram.firstName ?? "Бот", status: data.checks.telegram.status, error: data.checks.telegram.error, icon: Send },
    { key: "webhook", title: "Telegram webhook", subtitle: data.checks.webhook.pendingUpdateCount !== null ? `В очереди: ${data.checks.webhook.pendingUpdateCount}` : "Нет данных", status: data.checks.webhook.status, error: data.checks.webhook.error, icon: Webhook }
  ] as const;

  return (
    <div className="system-stack">
      <div className="system-toolbar">
        <span>Последняя проверка: {formatDate(data.checkedAt)} · автообновление каждые 15 секунд</span>
        <button className="button button--secondary" type="button" onClick={refresh} disabled={loading}><RefreshCw size={16} /> {loading ? "Проверяю…" : "Проверить сейчас"}</button>
      </div>

      {error ? <div className="state-box state-box--error">{error}</div> : null}

      <section className="system-check-grid">
        {checks.map((check) => {
          const Icon = check.icon;
          return (
            <article className={`system-check-card system-check-card--${check.status}`} key={check.key}>
              <div className="system-check-icon"><Icon size={19} /></div>
              <div className="system-check-copy"><span>{check.title}</span><strong>{statusLabels[check.status]}</strong><small>{check.error ?? check.subtitle}</small></div>
              <StatusIcon status={check.status} />
            </article>
          );
        })}
      </section>

      <section className="metrics-grid system-metrics">
        <article className="metric-card"><span>Чатов</span><strong>{data.application.chats.toLocaleString("ru-RU")}</strong><small>В PostgreSQL</small></article>
        <article className="metric-card"><span>Активных подключений</span><strong>{data.application.activeBotLinks.toLocaleString("ru-RU")}</strong><small>BotChat = ACTIVE</small></article>
        <article className="metric-card"><span>Сообщений за 24 ч</span><strong>{data.application.messages24h.toLocaleString("ru-RU")}</strong><small>Реально получены ботом</small></article>
        <article className="metric-card"><span>PENDING действий</span><strong>{data.application.pendingModerationActions.toLocaleString("ru-RU")}</strong><small>Нуждаются в сверке</small></article>
        <article className="metric-card"><span>Ошибок модерации</span><strong>{data.application.failedModerationActions24h.toLocaleString("ru-RU")}</strong><small>За последние 24 часа</small></article>
        <article className="metric-card"><span>Ошибок автомода</span><strong>{data.application.automodDeleteErrors24h.toLocaleString("ru-RU")}</strong><small>Удаление или наказание отклонено Telegram</small></article>
      </section>

      <section className="system-columns">
        <article className="panel system-panel">
          <div className="panel-header"><div><h2>Webhook</h2><p>Текущее состояние регистрации в Telegram.</p></div><Webhook size={18} /></div>
          <dl className="system-detail-list">
            <div><dt>Текущий URL</dt><dd>{data.checks.webhook.url ?? "Не зарегистрирован"}</dd></div>
            <div><dt>Ожидаемый URL</dt><dd>{data.checks.webhook.expectedUrl ?? "Не задан"}</dd></div>
            <div><dt>Совпадает</dt><dd>{data.checks.webhook.urlMatchesExpected === null ? "—" : data.checks.webhook.urlMatchesExpected ? "Да" : "Нет"}</dd></div>
            <div><dt>Updates в очереди</dt><dd>{data.checks.webhook.pendingUpdateCount ?? "—"}</dd></div>
          </dl>
          {data.checks.webhook.lastErrorMessage ? (
            <div className="system-history-warning"><AlertTriangle size={16} /><div><strong>Последняя ошибка, сохранённая Telegram</strong><span>{data.checks.webhook.lastErrorMessage}</span>{data.checks.webhook.lastErrorAt ? <small>{formatDate(data.checks.webhook.lastErrorAt)}</small> : null}<small>Это историческое поле Telegram и само по себе не означает, что webhook сейчас не работает.</small></div></div>
          ) : null}
        </article>

        <article className="panel system-panel">
          <div className="panel-header"><div><h2>Конфигурация</h2><p>Показываются только безопасные признаки наличия переменных.</p></div><ServerCog size={18} /></div>
          <div className="system-config-list">
            <ConfigRow label="DATABASE_URL" ok={data.configuration.databaseConfigured} />
            <ConfigRow label="TELEGRAM_BOT_TOKEN" ok={data.configuration.telegramBotTokenConfigured} />
            <ConfigRow label="TELEGRAM_WEBHOOK_SECRET" ok={data.configuration.telegramWebhookSecretConfigured} />
            <ConfigRow label="TELEGRAM_WEBHOOK_URL" ok={data.configuration.telegramWebhookUrlConfigured} detail={data.configuration.telegramWebhookUrlConfigured ? data.checks.webhook.expectedUrl : null} />
            <ConfigRow label="APP_URL" ok={data.configuration.appUrlConfigured} detail={data.configuration.appUrl} />
            <ConfigRow label="ADMIN_EMAIL" ok={data.configuration.adminEmailConfigured} />
            <ConfigRow label="ADMIN_PASSWORD" ok={data.configuration.adminPasswordConfigured} />
          </div>
          <div className="system-runtime-note">Vercel environment: <strong>{data.configuration.environment}</strong> · Node: <strong>{data.configuration.nodeEnv}</strong></div>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-header"><div><h2>Проблемные чаты</h2><p>Последние подключения, где бот не активен или Telegram сообщил проблему.</p></div><span className="badge badge--warning">{data.application.problematicBotLinks}</span></div>
        {data.problemChats.length === 0 ? (
          <div className="state-box state-box--compact"><strong>Проблемных подключений нет</strong><p>Все известные BotChat-связи находятся в рабочем состоянии.</p></div>
        ) : (
          <div className="table-wrap"><table className="data-table system-table"><thead><tr><th>Чат</th><th>Статус</th><th>Последняя ошибка</th><th>Обновлено</th></tr></thead><tbody>
            {data.problemChats.map((chat) => <tr key={`${chat.id}-${chat.updatedAt}`}><td><Link className="stacked-cell table-link" href={`/chats/${chat.id}`}><strong>{chat.title}</strong><span>{chat.telegramChatId}</span></Link></td><td><span className={`badge badge--${chat.status.toLowerCase()}`}>{botStatusLabels[chat.status] ?? chat.status}</span></td><td>{chat.lastError ?? "—"}</td><td>{formatDate(chat.updatedAt)}</td></tr>)}
          </tbody></table></div>
        )}
      </section>

      <section className="panel table-panel">
        <div className="panel-header"><div><h2>Ошибки за 24 часа</h2><p>Реальные ошибки ручной модерации, автомодерации и удаления сообщений.</p></div><CircleAlert size={18} /></div>
        {data.recentErrors.length === 0 ? (
          <div className="state-box state-box--compact"><strong>Ошибок нет</strong><p>За последние 24 часа журнал не зафиксировал ошибок модерации.</p></div>
        ) : (
          <div className="table-wrap"><table className="data-table system-table"><thead><tr><th>Событие</th><th>Чат</th><th>Участник</th><th>Причина</th><th>Время</th></tr></thead><tbody>
            {data.recentErrors.map((item) => <tr key={item.id}><td>{errorLabels[item.action] ?? item.action}</td><td>{item.chat ? <Link className="table-link" href={`/chats/${item.chat.id}`}>{item.chat.title}</Link> : "—"}</td><td>{item.affectedUser ? <Link className="table-link" href={`/members/${item.affectedUser.id}`}>{item.affectedUser.displayName}</Link> : "—"}</td><td>{item.reason ?? "—"}</td><td>{formatDate(item.createdAt)}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}
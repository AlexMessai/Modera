"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  Bot,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserRoundPlus,
  UsersRound
} from "lucide-react";

type Period = "24H" | "7D" | "30D";
type Metric = { current: number; previous: number; deltaPercent: number | null };
type DashboardData = {
  generatedAt: string;
  period: Period;
  totals: { chats: number; activeBotLinks: number; knownUsers: number; trustedUsers: number };
  metrics: {
    messages: Metric;
    newMembers: Metric;
    joinRequests: Metric;
    moderationActions: Metric;
    automodActions: Metric;
    raids: Metric;
  };
  attention: {
    pendingJoinRequests: number;
    pendingModerationActions: number;
    problematicBotLinks: number;
    activeRaids: number;
    errors: number;
  };
  trend: Array<{
    at: string;
    label: string;
    messages: number;
    newMembers: number;
    moderationActions: number;
  }>;
  topChats: Array<{ id: string; title: string; telegramChatId: string; messages: number }>;
  recentEvents: Array<{
    id: string;
    action: string;
    reason: string | null;
    createdAt: string;
    source: string;
    chat: { id: string; title: string } | null;
    affectedUser: { id: string; displayName: string; username: string | null } | null;
    actingAdmin: { displayName: string } | null;
  }>;
};

type ChartMetric = "messages" | "newMembers" | "moderationActions";

const periodLabels: Record<Period, string> = {
  "24H": "24 часа",
  "7D": "7 дней",
  "30D": "30 дней"
};

const chartLabels: Record<ChartMetric, string> = {
  messages: "Сообщения",
  newMembers: "Новые участники",
  moderationActions: "Модерация"
};

const actionLabels: Record<string, string> = {
  RAID_STARTED: "Обнаружен рейд",
  RAID_ENDED: "Рейд завершён",
  RAID_MEMBER_MUTED: "Anti-Raid ограничил участника",
  AUTOMOD_AUTO_MUTE: "Автоматический mute",
  AUTOMOD_AUTO_BAN: "Автоматическая блокировка",
  MODERATION_MUTE: "Выдан mute",
  MODERATION_BAN: "Пользователь заблокирован",
  TRUSTED_MEMBER_ADDED: "Добавлен доверенный пользователь",
  TRUSTED_MEMBER_REMOVED: "Удалён доверенный пользователь",
  MEMBER_TAG_UPDATED: "Тег участника изменён",
  MEMBER_TAG_REMOVED: "Тег участника удалён",
  TELEGRAM_MEMBER_TAG_CHANGED: "Тег синхронизирован из Telegram",
  TELEGRAM_MEMBER_TAG_REMOVED: "Тег удалён в Telegram",
  MEMBER_TAG_UPDATE_FAILED: "Ошибка изменения тега",
  JOIN_REQUEST_APPROVED: "Заявка принята",
  JOIN_REQUEST_DECLINED: "Заявка отклонена",
  MODERATION_ACTION_FAILED: "Ошибка модерации",
  MODERATION_RECONCILIATION_CHECK_FAILED: "Ошибка сверки Telegram",
  AUTOMOD_DELETE_FAILED: "Ошибка автомодерации",
  AUTOMOD_ESCALATION_FAILED: "Ошибка автонаказания",
  MANUAL_MESSAGE_DELETE_FAILED: "Ошибка удаления сообщения",
  RAID_MITIGATION_FAILED: "Ошибка Anti-Raid"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function Delta({ metric }: { metric: Metric }) {
  if (metric.deltaPercent === null) {
    return <span className="dashboard-delta dashboard-delta--neutral">Новый период</span>;
  }
  if (metric.deltaPercent === 0) {
    return <span className="dashboard-delta dashboard-delta--neutral">Без изменений</span>;
  }
  const up = metric.deltaPercent > 0;
  return (
    <span className={`dashboard-delta ${up ? "dashboard-delta--up" : "dashboard-delta--down"}`}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {Math.abs(metric.deltaPercent).toLocaleString("ru-RU")}%
    </span>
  );
}

function MetricCard({ label, detail, metric }: { label: string; detail: string; metric: Metric }) {
  return (
    <article className="metric-card dashboard-metric-card">
      <span>{label}</span>
      <div className="dashboard-metric-value">
        <strong>{metric.current.toLocaleString("ru-RU")}</strong>
        <Delta metric={metric} />
      </div>
      <small>{detail}</small>
    </article>
  );
}

function TrendChart({ data, metric }: { data: DashboardData["trend"]; metric: ChartMetric }) {
  const values = data.map((item) => item[metric]);
  const max = Math.max(1, ...values);
  const width = 800;
  const height = 220;
  const paddingX = 10;
  const paddingY = 18;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const points = values.map((value, index) => {
    const x = paddingX + (data.length <= 1 ? 0 : (index / (data.length - 1)) * usableWidth);
    const y = paddingY + usableHeight - (value / max) * usableHeight;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="dashboard-chart-wrap">
      <div className="dashboard-chart-scale"><span>{max.toLocaleString("ru-RU")}</span><span>0</span></div>
      <svg className="dashboard-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Динамика: ${chartLabels[metric]}`}>
        <line x1="10" y1="202" x2="790" y2="202" className="dashboard-chart-grid" />
        <line x1="10" y1="110" x2="790" y2="110" className="dashboard-chart-grid" />
        <polyline points={points} className="dashboard-chart-line" vectorEffect="non-scaling-stroke" />
        {values.map((value, index) => {
          const [x, y] = points.split(" ")[index].split(",");
          return <circle key={`${data[index].at}-${metric}`} cx={x} cy={y} r="3.2" className="dashboard-chart-point"><title>{`${data[index].label}: ${value}`}</title></circle>;
        })}
      </svg>
      <div className="dashboard-chart-labels">
        {data.map((item, index) => {
          const show = data.length <= 8 || index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 6) === 0;
          return <span key={item.at} className={show ? "" : "dashboard-chart-label--hidden"}>{item.label}</span>;
        })}
      </div>
    </div>
  );
}

async function requestDashboard(period: Period) {
  const response = await fetch(`/api/overview?period=${period}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось обновить аналитику.");
  return payload.data as DashboardData;
}

export function DashboardClient({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [period, setPeriod] = useState<Period>(initial.period);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("messages");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(nextPeriod: Period) {
    setLoading(true);
    setError(null);
    try {
      const next = await requestDashboard(nextPeriod);
      setData(next);
      setPeriod(nextPeriod);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось обновить аналитику.");
    } finally {
      setLoading(false);
    }
  }

  const attentionTotal = useMemo(
    () => data.attention.pendingJoinRequests + data.attention.pendingModerationActions + data.attention.problematicBotLinks + data.attention.activeRaids + data.attention.errors,
    [data]
  );

  return (
    <div className="dashboard-stack">
      <div className="dashboard-toolbar">
        <div className="dashboard-periods" aria-label="Период аналитики">
          {(Object.keys(periodLabels) as Period[]).map((value) => (
            <button key={value} className={`dashboard-period ${period === value ? "dashboard-period--active" : ""}`} type="button" disabled={loading} onClick={() => void load(value)}>{periodLabels[value]}</button>
          ))}
        </div>
        <button className="button button--secondary" type="button" disabled={loading} onClick={() => void load(period)}><RefreshCw size={16} /> {loading ? "Обновляю…" : "Обновить"}</button>
      </div>

      {error ? <div className="state-box state-box--error">{error}</div> : null}

      <section className="dashboard-total-strip">
        <div><span>Чаты</span><strong>{data.totals.chats.toLocaleString("ru-RU")}</strong></div>
        <div><span>Бот активен</span><strong>{data.totals.activeBotLinks.toLocaleString("ru-RU")}</strong></div>
        <div><span>Известные пользователи</span><strong>{data.totals.knownUsers.toLocaleString("ru-RU")}</strong></div>
        <div><span>Доверенные</span><strong>{data.totals.trustedUsers.toLocaleString("ru-RU")}</strong></div>
        <small>Обновлено {formatDate(data.generatedAt)}</small>
      </section>

      <section className="metrics-grid dashboard-metrics" aria-label="Показатели периода">
        <MetricCard label="Сообщения" detail={`За ${periodLabels[period].toLowerCase()}`} metric={data.metrics.messages} />
        <MetricCard label="Новые участники" detail="Впервые замечены Modera" metric={data.metrics.newMembers} />
        <MetricCard label="Заявки" detail="Запросы на вступление" metric={data.metrics.joinRequests} />
        <MetricCard label="Automod" detail="Реальные срабатывания и наказания" metric={data.metrics.automodActions} />
        <MetricCard label="Модерация" detail="Warn / mute / ban / unban" metric={data.metrics.moderationActions} />
        <MetricCard label="Anti-Raid" detail="Новые raid incidents" metric={data.metrics.raids} />
      </section>

      <section className="dashboard-main-grid">
        <article className="panel dashboard-chart-panel">
          <div className="panel-header">
            <div><h2>Динамика</h2><p>Сравнение активности внутри выбранного периода.</p></div>
            <div className="dashboard-chart-tabs">
              {(Object.keys(chartLabels) as ChartMetric[]).map((value) => <button type="button" key={value} onClick={() => setChartMetric(value)} className={chartMetric === value ? "dashboard-chart-tab--active" : ""}>{chartLabels[value]}</button>)}
            </div>
          </div>
          <TrendChart data={data.trend} metric={chartMetric} />
        </article>

        <article className={`panel dashboard-attention ${attentionTotal > 0 ? "dashboard-attention--has-items" : ""}`}>
          <div className="panel-header"><div><h2>Требует внимания</h2><p>Текущие очереди и проблемы, а не исторические события.</p></div>{attentionTotal > 0 ? <span className="badge badge--warning">{attentionTotal}</span> : <ShieldCheck size={19} />}</div>
          <div className="dashboard-attention-list">
            <Link href="/join-requests"><UserRoundPlus size={17} /><span><strong>Заявки ожидают решения</strong><small>Очередь PENDING</small></span><b>{data.attention.pendingJoinRequests}</b></Link>
            <Link href="/journal"><RefreshCw size={17} /><span><strong>Действия требуют сверки</strong><small>PENDING moderation actions</small></span><b>{data.attention.pendingModerationActions}</b></Link>
            <Link href="/system"><Bot size={17} /><span><strong>Проблемные подключения</strong><small>Бот не в ACTIVE</small></span><b>{data.attention.problematicBotLinks}</b></Link>
            <Link href="/moderation"><ShieldAlert size={17} /><span><strong>Активные рейды</strong><small>Защитный режим сейчас</small></span><b>{data.attention.activeRaids}</b></Link>
            <Link href="/journal"><AlertTriangle size={17} /><span><strong>Ошибки за период</strong><small>Модерация / automod / Anti-Raid</small></span><b>{data.attention.errors}</b></Link>
          </div>
        </article>
      </section>

      <section className="dashboard-lower-grid">
        <article className="panel dashboard-ranking">
          <div className="panel-header"><div><h2>Самые активные чаты</h2><p>По количеству реально полученных сообщений.</p></div><MessageSquareText size={18} /></div>
          {data.topChats.length === 0 ? <div className="state-box state-box--compact">Нет сообщений за выбранный период.</div> : <div className="dashboard-ranking-list">
            {data.topChats.map((chat, index) => <Link href={`/chats/${chat.id}`} key={chat.id}><span className="dashboard-rank">{index + 1}</span><div><strong>{chat.title}</strong><small>{chat.telegramChatId}</small></div><b>{chat.messages.toLocaleString("ru-RU")}</b></Link>)}
          </div>}
        </article>

        <article className="panel dashboard-events">
          <div className="panel-header"><div><h2>Последние важные события</h2><p>Наказания, рейды, заявки, исключения и ошибки.</p></div><ShieldCheck size={18} /></div>
          {data.recentEvents.length === 0 ? <div className="state-box state-box--compact">Важных событий за период нет.</div> : <div className="dashboard-events-list">
            {data.recentEvents.map((event) => <div className="dashboard-event" key={event.id}><span className={`dashboard-event-icon ${event.action.includes("FAILED") ? "dashboard-event-icon--danger" : ""}`}>{event.action.includes("BAN") ? <Ban size={15} /> : event.action.startsWith("RAID_") ? <ShieldAlert size={15} /> : event.action.includes("JOIN_REQUEST") ? <UserRoundPlus size={15} /> : <UsersRound size={15} />}</span><div><strong>{actionLabels[event.action] ?? event.action}</strong><span>{event.chat?.title ?? "Система"}{event.affectedUser ? ` · ${event.affectedUser.displayName}` : ""}{event.actingAdmin ? ` · ${event.actingAdmin.displayName}` : ""}</span>{event.reason ? <small>{event.reason}</small> : null}</div><time>{formatDate(event.createdAt)}</time></div>)}
          </div>}
        </article>
      </section>
    </div>
  );
}

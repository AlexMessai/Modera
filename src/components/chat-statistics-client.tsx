"use client";

import Link from "next/link";
import { useState } from "react";
import { RefreshCw, ShieldAlert, UsersRound } from "lucide-react";

type Period = "24H" | "7D" | "30D";
type ChartMetric = "messages" | "newMembers" | "moderationActions";

export type ChatStatisticsValue = {
  period: Period;
  generatedAt: string;
  trend: Array<{
    at: string;
    label: string;
    messages: number;
    newMembers: number;
    moderationActions: number;
  }>;
  topMembers: Array<{ membershipId: string; displayName: string; username: string | null; messages: number }>;
  ruleBreakdown: Array<{ rule: string; count: number }>;
};

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

function TrendChart({ data, metric }: { data: ChatStatisticsValue["trend"]; metric: ChartMetric }) {
  const values = data.map((item) => item[metric]);
  const max = Math.max(1, ...values);
  const width = 800;
  const height = 200;
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
        <line x1="10" y1="182" x2="790" y2="182" className="dashboard-chart-grid" />
        <line x1="10" y1="100" x2="790" y2="100" className="dashboard-chart-grid" />
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

async function requestChatStatistics(chatId: string, period: Period) {
  const response = await fetch(`/api/chats/${chatId}/statistics?period=${period}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось загрузить статистику.");
  return payload.data as ChatStatisticsValue;
}

export function ChatStatistics({ chatId, initial }: { chatId: string; initial: ChatStatisticsValue }) {
  const [data, setData] = useState(initial);
  const [period, setPeriod] = useState<Period>(initial.period);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("messages");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(nextPeriod: Period) {
    setLoading(true);
    setError(null);
    try {
      const next = await requestChatStatistics(chatId, nextPeriod);
      setData(next);
      setPeriod(nextPeriod);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить статистику.");
    } finally {
      setLoading(false);
    }
  }

  const maxRuleCount = Math.max(1, ...data.ruleBreakdown.map((row) => row.count));

  return (
    <div className="dashboard-stack">
      <div className="dashboard-toolbar">
        <div className="dashboard-periods" aria-label="Период статистики">
          {(Object.keys(periodLabels) as Period[]).map((value) => (
            <button key={value} className={`dashboard-period ${period === value ? "dashboard-period--active" : ""}`} type="button" disabled={loading} onClick={() => void load(value)}>{periodLabels[value]}</button>
          ))}
        </div>
        <button className="button button--secondary" type="button" disabled={loading} onClick={() => void load(period)}><RefreshCw size={16} /> {loading ? "Обновляю…" : "Обновить"}</button>
      </div>

      {error ? <div className="state-box state-box--error">{error}</div> : null}

      <div className="dashboard-main-grid">
        <article className="panel dashboard-chart-panel">
          <div className="panel-header">
            <div><h2>Динамика</h2><p>Активность этого чата за выбранный период.</p></div>
            <div className="dashboard-chart-tabs">
              {(Object.keys(chartLabels) as ChartMetric[]).map((value) => <button type="button" key={value} onClick={() => setChartMetric(value)} className={chartMetric === value ? "dashboard-chart-tab--active" : ""}>{chartLabels[value]}</button>)}
            </div>
          </div>
          <TrendChart data={data.trend} metric={chartMetric} />
        </article>

        <article className="panel dashboard-attention">
          <div className="panel-header"><div><h2>Правила automod</h2><p>Что чаще всего срабатывает в этом чате.</p></div><ShieldAlert size={19} /></div>
          {data.ruleBreakdown.length === 0 ? <div className="state-box state-box--compact">За период срабатываний automod не было.</div> : (
            <div className="statistics-rule-list">
              {data.ruleBreakdown.map((row) => (
                <div className="statistics-rule-row" key={row.rule}>
                  <span>{row.rule}</span>
                  <div className="statistics-rule-bar-track"><div className="statistics-rule-bar-fill" style={{ width: `${(row.count / maxRuleCount) * 100}%` }} /></div>
                  <b>{row.count.toLocaleString("ru-RU")}</b>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="panel dashboard-ranking">
        <div className="panel-header"><div><h2>Топ активных участников</h2><p>По количеству сообщений за выбранный период.</p></div><UsersRound size={18} /></div>
        {data.topMembers.length === 0 ? <div className="state-box state-box--compact">Нет сообщений за выбранный период.</div> : (
          <div className="dashboard-ranking-list">
            {data.topMembers.map((member, index) => (
              <Link href={`/members/${member.membershipId}`} key={member.membershipId}>
                <span className="dashboard-rank">{index + 1}</span>
                <div><strong>{member.displayName}</strong><small>{member.username ? `@${member.username}` : ""}</small></div>
                <b>{member.messages.toLocaleString("ru-RU")}</b>
              </Link>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

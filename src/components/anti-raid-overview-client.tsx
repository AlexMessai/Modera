"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { AntiRaidMode } from "@/components/anti-raid-settings";

type ChatRow = {
  id: string;
  title: string;
  telegramChatId: string;
  useGlobalProfile: boolean;
  localEnabled: boolean;
  botStatus: string;
  canRestrictMembers: boolean;
  activeIncident: null | { id: string; mode: AntiRaidMode; signalCount: number; startedAt: string; activeUntil: string };
};
type Incident = {
  id: string;
  status: "ACTIVE" | "ENDED";
  mode: AntiRaidMode;
  triggeredBy: string;
  signalCount: number;
  joinRequestCount: number;
  joinCount: number;
  startedAt: string;
  activeUntil: string;
  endedAt: string | null;
  chat: { id: string; title: string };
};
type Overview = {
  globalPersisted: boolean;
  activeIncidents: number;
  incidents24h: number;
  chats: ChatRow[];
  incidents: Incident[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

async function loadOverview() {
  const response = await fetch("/api/anti-raid/overview", { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось загрузить Anti-Raid данные.");
  return payload.data as Overview;
}

export function AntiRaidOverviewClient({ initial }: { initial: Overview }) {
  const [overview, setOverview] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const interval = window.setInterval(() => {
      void loadOverview().then((next) => { if (active) setOverview(next); }).catch(() => undefined);
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  async function refresh() {
    try {
      setOverview(await loadOverview());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось обновить Anti-Raid данные.");
    }
  }

  return (
    <div className="anti-raid-stack">
      <div className="anti-raid-toolbar">
        <span>Детектор работает по данным PostgreSQL · обновление каждые 10 секунд</span>
        <button className="button button--secondary" type="button" onClick={() => void refresh()}><RefreshCw size={16} /> Обновить</button>
      </div>

      {error ? <div className="state-box state-box--error" role="alert">{error}</div> : null}

      <section className="metrics-grid anti-raid-metrics">
        <article className="metric-card"><span>Активных рейдов</span><strong>{overview.activeIncidents}</strong><small>Защитный режим сейчас</small></article>
        <article className="metric-card"><span>Инцидентов за 24 ч</span><strong>{overview.incidents24h}</strong><small>Реально зафиксированы детектором</small></article>
        <article className="metric-card"><span>Чатов под наблюдением</span><strong>{overview.chats.length}</strong><small>Из PostgreSQL</small></article>
      </section>

      <section className="panel table-panel">
        <div className="panel-header"><div><h2>Чаты</h2><p>Источник политики, готовность прав бота и текущий статус рейда. Откройте чат, чтобы изменить индивидуальные настройки.</p></div></div>
        <div className="table-wrap"><table className="data-table anti-raid-table"><thead><tr><th>Чат</th><th>Политика</th><th>Бот</th><th>Статус рейда</th><th /></tr></thead><tbody>
          {overview.chats.map((chat) => <tr key={chat.id}>
            <td><Link className="stacked-cell table-link" href={`/chats/${chat.id}`}><strong>{chat.title}</strong><span>{chat.telegramChatId}</span></Link></td>
            <td>{chat.useGlobalProfile ? "Глобальная" : chat.localEnabled ? "Индивидуальная · включена" : "Индивидуальная · выключена"}</td>
            <td><span className={`badge ${chat.canRestrictMembers ? "badge--active" : "badge--warning"}`}>{chat.canRestrictMembers ? "restrict: есть" : "нет restrict"}</span></td>
            <td>{chat.activeIncident ? <span className="badge badge--danger">Активен · {chat.activeIncident.signalCount}</span> : <span className="badge">Норма</span>}</td>
            <td><Link className="icon-button" href={`/chats/${chat.id}`} title="Открыть настройки" aria-label="Открыть настройки"><ArrowUpRight size={16} /></Link></td>
          </tr>)}
        </tbody></table></div>
      </section>

      <section className="panel table-panel">
        <div className="panel-header"><div><h2>Инциденты за 24 часа</h2><p>История реальных срабатываний детектора.</p></div></div>
        {overview.incidents.length === 0 ? <div className="state-box state-box--compact"><strong>Рейдов не зафиксировано</strong><p>Здесь появятся только реальные срабатывания Anti-Raid.</p></div> : <div className="table-wrap"><table className="data-table anti-raid-table"><thead><tr><th>Чат</th><th>Статус</th><th>Сигналы</th><th>Причина</th><th>Начало</th><th>До</th></tr></thead><tbody>
          {overview.incidents.map((incident) => <tr key={incident.id}>
            <td><Link className="table-link" href={`/chats/${incident.chat.id}`}>{incident.chat.title}</Link></td>
            <td><span className={`badge ${incident.status === "ACTIVE" ? "badge--danger" : "badge--active"}`}>{incident.status === "ACTIVE" ? "Активен" : "Завершён"}</span></td>
            <td>{incident.signalCount} <small>({incident.joinRequestCount} заявок / {incident.joinCount} вступлений)</small></td>
            <td>{incident.triggeredBy === "JOIN_REQUEST" ? "Заявки" : "Вступления"}</td>
            <td>{formatDate(incident.startedAt)}</td><td>{formatDate(incident.activeUntil)}</td>
          </tr>)}
        </tbody></table></div>}
      </section>
    </div>
  );
}

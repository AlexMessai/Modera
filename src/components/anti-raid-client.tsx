"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { AntiRaidSettings, type AntiRaidMode, type AntiRaidSettingsValue } from "@/components/anti-raid-settings";

type ChatRow = {
  id: string;
  title: string;
  telegramChatId: string;
  useGlobalProfile: boolean;
  localEnabled: boolean;
  botStatus: string;
  canRestrictMembers: boolean;
  activeIncident: null | {
    id: string;
    mode: AntiRaidMode;
    signalCount: number;
    startedAt: string;
    activeUntil: string;
  };
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
type ChatProfile = {
  chat: { id: string; title: string; telegramChatId: string; type: string };
  policy: { useGlobalProfile: boolean; effectiveSource: "CHAT" | "GLOBAL"; globalProfilePersisted: boolean };
  settings: AntiRaidSettingsValue;
  effectiveSettings: AntiRaidSettingsValue;
  globalSettings: AntiRaidSettingsValue;
  bot: { status: string; canRestrictMembers: boolean; canInviteUsers: boolean; lastError: string | null; checkedAt: string | null };
  activeIncident: null | { id: string; mode: AntiRaidMode; triggeredBy: string; signalCount: number; startedAt: string; activeUntil: string };
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

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось загрузить Anti-Raid данные.");
  return payload.data as T;
}

export function AntiRaidClient({ canManage }: { canManage: boolean }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [globalSettings, setGlobalSettings] = useState<AntiRaidSettingsValue | null>(null);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [chatProfile, setChatProfile] = useState<ChatProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadOverview() {
    const data = await readJson<Overview>("/api/anti-raid/overview");
    setOverview(data);
    return data;
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      readJson<Overview>("/api/anti-raid/overview"),
      readJson<{ persisted: boolean; settings: AntiRaidSettingsValue }>("/api/anti-raid/global")
    ]).then(([nextOverview, global]) => {
      if (!active) return;
      setOverview(nextOverview);
      setGlobalSettings(global.settings);
      setLoading(false);
    }).catch((caught: unknown) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить Anti-Raid.");
      setLoading(false);
    });

    const interval = window.setInterval(() => {
      void readJson<Overview>("/api/anti-raid/overview").then((next) => {
        if (active) setOverview(next);
      }).catch(() => undefined);
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedChatId) return;
    void readJson<ChatProfile>(`/api/chats/${selectedChatId}/anti-raid`).then((profile) => {
      setChatProfile(profile);
      setError(null);
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить настройки чата.");
    });
  }, [selectedChatId]);

  const selectedChat = useMemo(
    () => overview?.chats.find((chat) => chat.id === selectedChatId) ?? null,
    [overview, selectedChatId]
  );

  if (loading && !overview) return <div className="panel state-box">Загружаю Anti-Raid…</div>;
  if (!overview || !globalSettings) return <div className="panel state-box state-box--error">{error ?? "Anti-Raid недоступен."}</div>;

  return (
    <div className="anti-raid-stack">
      <div className="anti-raid-toolbar">
        <span>Детектор работает по данным PostgreSQL · обновление каждые 10 секунд</span>
        <button className="button button--secondary" type="button" onClick={() => void loadOverview()}><RefreshCw size={16} /> Обновить</button>
      </div>

      {error ? <div className="state-box state-box--error" role="alert">{error}</div> : null}

      <section className="metrics-grid anti-raid-metrics">
        <article className="metric-card"><span>Активных рейдов</span><strong>{overview.activeIncidents}</strong><small>Защитный режим сейчас</small></article>
        <article className="metric-card"><span>Инцидентов за 24 ч</span><strong>{overview.incidents24h}</strong><small>Реально зафиксированы детектором</small></article>
        <article className="metric-card"><span>Чатов под наблюдением</span><strong>{overview.chats.length}</strong><small>Из PostgreSQL</small></article>
      </section>

      <section className="panel anti-raid-policy-panel">
        <div className="panel-header">
          <div><span className="eyebrow">По умолчанию для наследующих чатов</span><h2>Глобальная Anti-Raid политика</h2><p>Не применяется к существующему чату, пока он явно не переключён на глобальный профиль.</p></div>
          <ShieldAlert size={20} />
        </div>
        <AntiRaidSettings scope="global" initial={globalSettings} canEdit={canManage} onSaved={() => void loadOverview()} />
      </section>

      <section className="panel table-panel">
        <div className="panel-header"><div><h2>Чаты</h2><p>Источник политики, готовность прав бота и текущий статус рейда.</p></div></div>
        <div className="table-wrap"><table className="data-table anti-raid-table"><thead><tr><th>Чат</th><th>Политика</th><th>Бот</th><th>Статус рейда</th><th></th></tr></thead><tbody>
          {overview.chats.map((chat) => <tr key={chat.id}>
            <td><Link className="stacked-cell table-link" href={`/chats/${chat.id}`}><strong>{chat.title}</strong><span>{chat.telegramChatId}</span></Link></td>
            <td>{chat.useGlobalProfile ? "Глобальная" : chat.localEnabled ? "Индивидуальная · включена" : "Индивидуальная · выключена"}</td>
            <td><span className={`badge ${chat.canRestrictMembers ? "badge--active" : "badge--warning"}`}>{chat.canRestrictMembers ? "restrict: есть" : "нет restrict"}</span></td>
            <td>{chat.activeIncident ? <span className="badge badge--danger">Активен · {chat.activeIncident.signalCount}</span> : <span className="badge">Норма</span>}</td>
            <td><button className="button button--compact" type="button" onClick={() => setSelectedChatId(chat.id)}>{selectedChatId === chat.id ? "Открыто" : "Настроить"}</button></td>
          </tr>)}
        </tbody></table></div>
      </section>

      {selectedChat && chatProfile ? <section className="panel anti-raid-policy-panel">
        <div className="panel-header"><div><span className="eyebrow">Локальная политика</span><h2>{chatProfile.chat.title}</h2><p>Telegram ID: {chatProfile.chat.telegramChatId}</p></div></div>
        <AntiRaidSettings
          key={selectedChatId}
          scope="chat"
          chatId={selectedChatId}
          initial={chatProfile.settings}
          initialUseGlobalProfile={chatProfile.policy.useGlobalProfile}
          globalSettings={chatProfile.globalSettings}
          canEdit={canManage}
          botCanRestrictMembers={chatProfile.bot.canRestrictMembers}
          activeIncident={chatProfile.activeIncident}
          onSaved={() => void loadOverview()}
        />
      </section> : null}

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

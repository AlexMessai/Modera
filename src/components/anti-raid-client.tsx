"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";

type Mode = "ALERT" | "MUTE_NEW_MEMBERS";
type Settings = {
  enabled: boolean;
  joinThreshold: number;
  windowSeconds: number;
  protectionDurationMinutes: number;
  mode: Mode;
  newMemberMuteMinutes: number;
};
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
    mode: Mode;
    signalCount: number;
    startedAt: string;
    activeUntil: string;
  };
};
type Incident = {
  id: string;
  status: "ACTIVE" | "ENDED";
  mode: Mode;
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
  settings: Settings;
  effectiveSettings: Settings;
  globalSettings: Settings;
  bot: { status: string; canRestrictMembers: boolean; canInviteUsers: boolean; lastError: string | null; checkedAt: string | null };
  activeIncident: null | { id: string; mode: Mode; triggeredBy: string; signalCount: number; startedAt: string; activeUntil: string };
};

const modeLabels: Record<Mode, string> = {
  ALERT: "Только зафиксировать и предупредить",
  MUTE_NEW_MEMBERS: "Временно mute новых участников"
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

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить Anti-Raid настройки.");
  return payload.data as T;
}

function SettingsFields({
  value,
  onChange,
  disabled
}: {
  value: Settings;
  onChange: (next: Settings) => void;
  disabled: boolean;
}) {
  const setNumber = (key: keyof Settings, raw: string) => {
    const number = Number(raw);
    if (Number.isFinite(number)) onChange({ ...value, [key]: number });
  };

  return (
    <div className="anti-raid-form-grid">
      <label className="anti-raid-toggle-row">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          disabled={disabled}
        />
        <span><strong>Anti-Raid включён</strong><small>Режим активируется только после достижения заданного порога.</small></span>
      </label>

      <label>
        <span>Порог вступлений / заявок</span>
        <input className="input-control" type="number" min={3} max={500} value={value.joinThreshold} disabled={disabled} onChange={(event) => setNumber("joinThreshold", event.target.value)} />
      </label>
      <label>
        <span>Окно, секунд</span>
        <input className="input-control" type="number" min={10} max={600} value={value.windowSeconds} disabled={disabled} onChange={(event) => setNumber("windowSeconds", event.target.value)} />
      </label>
      <label>
        <span>Защитный режим, минут</span>
        <input className="input-control" type="number" min={1} max={1440} value={value.protectionDurationMinutes} disabled={disabled} onChange={(event) => setNumber("protectionDurationMinutes", event.target.value)} />
      </label>
      <label>
        <span>Реакция</span>
        <select className="select-control" value={value.mode} disabled={disabled} onChange={(event) => onChange({ ...value, mode: event.target.value as Mode })}>
          <option value="ALERT">{modeLabels.ALERT}</option>
          <option value="MUTE_NEW_MEMBERS">{modeLabels.MUTE_NEW_MEMBERS}</option>
        </select>
      </label>
      <label>
        <span>Mute нового участника, минут</span>
        <input className="input-control" type="number" min={1} max={10080} value={value.newMemberMuteMinutes} disabled={disabled || value.mode !== "MUTE_NEW_MEMBERS"} onChange={(event) => setNumber("newMemberMuteMinutes", event.target.value)} />
      </label>
    </div>
  );
}

export function AntiRaidClient({ canManage }: { canManage: boolean }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [globalSettings, setGlobalSettings] = useState<Settings | null>(null);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [chatProfile, setChatProfile] = useState<ChatProfile | null>(null);
  const [chatSettings, setChatSettings] = useState<Settings | null>(null);
  const [useGlobalProfile, setUseGlobalProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadOverview() {
    const data = await readJson<Overview>("/api/anti-raid/overview");
    setOverview(data);
    return data;
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      readJson<Overview>("/api/anti-raid/overview"),
      readJson<{ persisted: boolean; settings: Settings }>("/api/anti-raid/global")
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
    if (!selectedChatId) {
      setChatProfile(null);
      setChatSettings(null);
      return;
    }
    void readJson<ChatProfile>(`/api/chats/${selectedChatId}/anti-raid`).then((profile) => {
      setChatProfile(profile);
      setChatSettings(profile.settings);
      setUseGlobalProfile(profile.policy.useGlobalProfile);
      setError(null);
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить настройки чата.");
    });
  }, [selectedChatId]);

  const selectedChat = useMemo(
    () => overview?.chats.find((chat) => chat.id === selectedChatId) ?? null,
    [overview, selectedChatId]
  );

  async function saveGlobal() {
    if (!globalSettings) return;
    setSaving(true);
    setNotice(null);
    try {
      const saved = await patchJson<Settings>("/api/anti-raid/global", globalSettings);
      setGlobalSettings(saved);
      setNotice("Глобальная Anti-Raid политика сохранена.");
      await loadOverview();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить глобальную политику.");
    } finally {
      setSaving(false);
    }
  }

  async function saveChat() {
    if (!chatSettings || !selectedChatId) return;
    setSaving(true);
    setNotice(null);
    try {
      await patchJson(`/api/chats/${selectedChatId}/anti-raid`, {
        useGlobalProfile,
        ...chatSettings
      });
      const profile = await readJson<ChatProfile>(`/api/chats/${selectedChatId}/anti-raid`);
      setChatProfile(profile);
      setChatSettings(profile.settings);
      setUseGlobalProfile(profile.policy.useGlobalProfile);
      setNotice(`Anti-Raid настройки «${profile.chat.title}» сохранены.`);
      await loadOverview();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки чата.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !overview) return <div className="panel state-box">Загружаю Anti-Raid…</div>;
  if (!overview || !globalSettings) return <div className="panel state-box state-box--error">{error ?? "Anti-Raid недоступен."}</div>;

  return (
    <div className="anti-raid-stack">
      <div className="anti-raid-toolbar">
        <span>Детектор работает по данным PostgreSQL · обновление каждые 10 секунд</span>
        <button className="button button--secondary" type="button" onClick={() => void loadOverview()}><RefreshCw size={16} /> Обновить</button>
      </div>

      {error ? <div className="state-box state-box--error" role="alert">{error}</div> : null}
      {notice ? <div className="state-box state-box--success">{notice}</div> : null}

      <section className="metrics-grid anti-raid-metrics">
        <article className="metric-card"><span>Активных рейдов</span><strong>{overview.activeIncidents}</strong><small>Защитный режим сейчас</small></article>
        <article className="metric-card"><span>Инцидентов за 24 ч</span><strong>{overview.incidents24h}</strong><small>Реально зафиксированы detector'ом</small></article>
        <article className="metric-card"><span>Чатов под наблюдением</span><strong>{overview.chats.length}</strong><small>Из PostgreSQL</small></article>
      </section>

      <section className="panel anti-raid-policy-panel">
        <div className="panel-header">
          <div><span className="eyebrow">По умолчанию для наследующих чатов</span><h2>Глобальная Anti-Raid политика</h2><p>Не применяется к существующему чату, пока он явно не переключён на глобальный профиль.</p></div>
          <ShieldAlert size={20} />
        </div>
        <SettingsFields value={globalSettings} onChange={setGlobalSettings} disabled={!canManage} />
        {canManage ? <div className="anti-raid-actions"><button className="button" type="button" onClick={saveGlobal} disabled={saving}>{saving ? "Сохраняю…" : "Сохранить глобальную политику"}</button></div> : <div className="state-box state-box--compact">У вашей роли режим просмотра.</div>}
      </section>

      <section className="panel table-panel">
        <div className="panel-header"><div><h2>Чаты</h2><p>Источник политики, готовность прав бота и текущий raid status.</p></div></div>
        <div className="table-wrap"><table className="data-table anti-raid-table"><thead><tr><th>Чат</th><th>Политика</th><th>Бот</th><th>Raid status</th><th></th></tr></thead><tbody>
          {overview.chats.map((chat) => <tr key={chat.id}>
            <td><Link className="stacked-cell table-link" href={`/chats/${chat.id}`}><strong>{chat.title}</strong><span>{chat.telegramChatId}</span></Link></td>
            <td>{chat.useGlobalProfile ? "Глобальная" : chat.localEnabled ? "Индивидуальная · включена" : "Индивидуальная · выключена"}</td>
            <td><span className={`badge ${chat.canRestrictMembers ? "badge--active" : "badge--warning"}`}>{chat.canRestrictMembers ? "restrict: есть" : "нет restrict"}</span></td>
            <td>{chat.activeIncident ? <span className="badge badge--danger">Активен · {chat.activeIncident.signalCount}</span> : <span className="badge">Норма</span>}</td>
            <td><button className="button button--compact" type="button" onClick={() => setSelectedChatId(chat.id)}>{selectedChatId === chat.id ? "Открыто" : "Настроить"}</button></td>
          </tr>)}
        </tbody></table></div>
      </section>

      {selectedChat && chatProfile && chatSettings ? <section className="panel anti-raid-policy-panel">
        <div className="panel-header"><div><span className="eyebrow">Локальная политика</span><h2>{chatProfile.chat.title}</h2><p>Telegram ID: {chatProfile.chat.telegramChatId}</p></div></div>
        <label className="anti-raid-toggle-row anti-raid-inherit-row">
          <input type="checkbox" checked={useGlobalProfile} onChange={(event) => setUseGlobalProfile(event.target.checked)} disabled={!canManage} />
          <span><strong>Использовать глобальную Anti-Raid политику</strong><small>Локальные значения сохраняются и снова вступят в силу после отключения наследования.</small></span>
        </label>
        {useGlobalProfile ? <div className="state-box state-box--compact">Сейчас detector использует глобальные значения. Локальные настройки ниже временно неактивны.</div> : null}
        <SettingsFields value={chatSettings} onChange={setChatSettings} disabled={!canManage || useGlobalProfile} />
        {chatSettings.mode === "MUTE_NEW_MEMBERS" && !chatProfile.bot.canRestrictMembers && !useGlobalProfile ? <div className="state-box state-box--error"><AlertTriangle size={16} /> Для автоматического mute у бота нет права restrict_members.</div> : null}
        {chatProfile.activeIncident ? <div className="anti-raid-live"><strong>Сейчас действует защитный режим</strong><span>{modeLabels[chatProfile.activeIncident.mode]} · до {formatDate(chatProfile.activeIncident.activeUntil)}</span></div> : null}
        {canManage ? <div className="anti-raid-actions"><button className="button" type="button" onClick={saveChat} disabled={saving}>{saving ? "Сохраняю…" : "Сохранить настройки чата"}</button></div> : null}
      </section> : null}

      <section className="panel table-panel">
        <div className="panel-header"><div><h2>Инциденты за 24 часа</h2><p>История реальных срабатываний detector'а.</p></div></div>
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
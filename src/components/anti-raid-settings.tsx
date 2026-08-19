"use client";

import { useState } from "react";
import { AlertTriangle, Globe2, ShieldCheck } from "lucide-react";

export type AntiRaidMode = "ALERT" | "MUTE_NEW_MEMBERS";

export type AntiRaidSettingsValue = {
  enabled: boolean;
  joinThreshold: number;
  windowSeconds: number;
  protectionDurationMinutes: number;
  mode: AntiRaidMode;
  newMemberMuteMinutes: number;
};

type Props = {
  chatId?: string;
  initial: AntiRaidSettingsValue;
  canEdit: boolean;
  botCanRestrictMembers?: boolean;
  scope?: "chat" | "global";
  initialUseGlobalProfile?: boolean;
  globalSettings?: AntiRaidSettingsValue;
  activeIncident?: { mode: AntiRaidMode; activeUntil: string } | null;
  onSaved?: (saved: AntiRaidSettingsValue) => void;
};

const modeLabels: Record<AntiRaidMode, string> = {
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

export function AntiRaidSettings({
  chatId,
  initial,
  canEdit,
  botCanRestrictMembers = true,
  scope = "chat",
  initialUseGlobalProfile = false,
  globalSettings,
  activeIncident = null,
  onSaved
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [useGlobalProfile, setUseGlobalProfile] = useState(initialUseGlobalProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isGlobalScope = scope === "global";
  const inherited = !isGlobalScope && useGlobalProfile && Boolean(globalSettings);
  const visibleSettings = inherited && globalSettings ? globalSettings : settings;
  const fieldsDisabled = !canEdit || saving || inherited;

  function setNumber(key: keyof AntiRaidSettingsValue, raw: string) {
    const number = Number(raw);
    if (Number.isFinite(number)) setSettings((current) => ({ ...current, [key]: number }));
  }

  async function save() {
    if (!isGlobalScope && !chatId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(isGlobalScope ? "/api/anti-raid/global" : `/api/chats/${chatId}/anti-raid`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settings, ...(isGlobalScope ? {} : { useGlobalProfile }) })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить Anti-Raid настройки.");

      if (isGlobalScope) {
        const savedSettings = payload.data as AntiRaidSettingsValue;
        setSettings(savedSettings);
        setSuccess("Глобальная Anti-Raid политика сохранена.");
        onSaved?.(savedSettings);
      } else {
        const saved = payload.data as AntiRaidSettingsValue & { useGlobalProfile: boolean };
        const { useGlobalProfile: savedMode, ...savedSettings } = saved;
        setUseGlobalProfile(savedMode);
        setSettings(savedSettings);
        setSuccess(savedMode ? "Чат переключён на глобальную Anti-Raid политику." : "Индивидуальные настройки Anti-Raid сохранены.");
        onSaved?.(savedSettings);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить Anti-Raid настройки.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="anti-raid-form-stack">
      {!isGlobalScope ? (
        <label className="anti-raid-toggle-row anti-raid-inherit-row">
          <input type="checkbox" checked={useGlobalProfile} disabled={!canEdit || saving} onChange={(event) => setUseGlobalProfile(event.target.checked)} />
          <span><strong>Использовать глобальную Anti-Raid политику</strong><small>Локальные значения сохраняются и снова вступят в силу после отключения наследования.</small></span>
        </label>
      ) : null}
      {inherited ? <div className="moderation-readonly"><Globe2 size={18} /><div><strong>Глобальное наследование включено</strong><p>Сейчас детектор использует глобальные значения. Локальные настройки ниже временно неактивны.</p></div></div> : null}
      {!canEdit ? <div className="moderation-readonly"><ShieldCheck size={18} /><div><strong>Только просмотр</strong><p>Изменять {isGlobalScope ? "глобальную политику" : "настройки чата"} могут OWNER и ADMIN.</p></div></div> : null}

      <div className="anti-raid-form-grid">
        <label className="anti-raid-toggle-row">
          <input type="checkbox" checked={visibleSettings.enabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} />
          <span><strong>Anti-Raid включён</strong><small>Режим активируется только после достижения заданного порога.</small></span>
        </label>
        <label>
          <span>Порог вступлений / заявок</span>
          <input className="input-control" type="number" min={3} max={500} value={visibleSettings.joinThreshold} disabled={fieldsDisabled} onChange={(event) => setNumber("joinThreshold", event.target.value)} />
        </label>
        <label>
          <span>Окно, секунд</span>
          <input className="input-control" type="number" min={10} max={600} value={visibleSettings.windowSeconds} disabled={fieldsDisabled} onChange={(event) => setNumber("windowSeconds", event.target.value)} />
        </label>
        <label>
          <span>Защитный режим, минут</span>
          <input className="input-control" type="number" min={1} max={1440} value={visibleSettings.protectionDurationMinutes} disabled={fieldsDisabled} onChange={(event) => setNumber("protectionDurationMinutes", event.target.value)} />
        </label>
        <label>
          <span>Реакция</span>
          <select className="select-control" value={visibleSettings.mode} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, mode: event.target.value as AntiRaidMode }))}>
            <option value="ALERT">{modeLabels.ALERT}</option>
            <option value="MUTE_NEW_MEMBERS">{modeLabels.MUTE_NEW_MEMBERS}</option>
          </select>
        </label>
        <label>
          <span>Mute нового участника, минут</span>
          <input className="input-control" type="number" min={1} max={10080} value={visibleSettings.newMemberMuteMinutes} disabled={fieldsDisabled || visibleSettings.mode !== "MUTE_NEW_MEMBERS"} onChange={(event) => setNumber("newMemberMuteMinutes", event.target.value)} />
        </label>
      </div>

      {!isGlobalScope && visibleSettings.enabled && visibleSettings.mode === "MUTE_NEW_MEMBERS" && !botCanRestrictMembers ? (
        <div className="state-box state-box--error"><AlertTriangle size={16} /> Для автоматического mute у бота нет права restrict_members.</div>
      ) : null}
      {activeIncident ? <div className="anti-raid-live"><strong>Сейчас действует защитный режим</strong><span>{modeLabels[activeIncident.mode]} · до {formatDate(activeIncident.activeUntil)}</span></div> : null}

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? <div className="anti-raid-actions"><button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? "Сохраняю…" : isGlobalScope ? "Сохранить глобальную политику" : "Сохранить настройки чата"}</button></div> : null}
    </div>
  );
}

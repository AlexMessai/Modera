"use client";

import { useState } from "react";
import { Check, Globe2, ShieldCheck } from "lucide-react";

export type AntiRaidSettingsValue = {
  enabled: boolean;
  joinThreshold: number;
  windowSeconds: number;
  cooldownMinutes: number;
  forceCaptcha: boolean;
};

type Props = {
  chatId?: string;
  initial: AntiRaidSettingsValue;
  canEdit: boolean;
  scope?: "chat" | "global";
  initialUseGlobalProfile?: boolean;
  globalSettings?: AntiRaidSettingsValue;
  onSaved?: (saved: AntiRaidSettingsValue) => void;
};

export function AntiRaidSettings({
  chatId,
  initial,
  canEdit,
  scope = "chat",
  initialUseGlobalProfile = false,
  globalSettings,
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
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки Anti-Raid.");

      if (isGlobalScope) {
        const savedSettings = payload.data as AntiRaidSettingsValue;
        setSettings(savedSettings);
        setSuccess("Глобальная политика Anti-Raid сохранена.");
        onSaved?.(savedSettings);
      } else {
        const saved = payload.data as AntiRaidSettingsValue & { useGlobalProfile: boolean };
        const { useGlobalProfile: savedMode, ...savedSettings } = saved;
        setUseGlobalProfile(savedMode);
        setSettings(savedSettings);
        setSuccess(savedMode ? "Чат переключён на глобальную политику Anti-Raid." : "Настройки Anti-Raid чата сохранены.");
        onSaved?.(savedSettings);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки Anti-Raid.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="automod-settings">
      {!isGlobalScope ? (
        <div className="automod-rule">
          <label className="automod-toggle-row">
            <input
              type="checkbox"
              checked={useGlobalProfile}
              disabled={!canEdit || saving}
              onChange={(event) => setUseGlobalProfile(event.target.checked)}
            />
            <span><strong>Использовать глобальную политику Anti-Raid</strong><small>Настройки этого чата будут автоматически следовать глобальным значениям из раздела «Модерация».</small></span>
          </label>
          {useGlobalProfile ? (
            <div className="moderation-readonly">
              <Globe2 size={18} />
              <div><strong>Глобальное наследование включено</strong><p>Индивидуальные значения сохранены, но пока не применяются. Отключите наследование, чтобы вернуться к ним.</p></div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!canEdit ? (
        <div className="moderation-readonly">
          <ShieldCheck size={18} />
          <div><strong>Только просмотр</strong><p>{isGlobalScope ? "Изменять глобальную политику могут OWNER и ADMIN." : "Изменять настройки чата могут OWNER и ADMIN."}</p></div>
        </div>
      ) : null}

      <div className="automod-rule">
        <label className="automod-toggle-row">
          <input
            type="checkbox"
            checked={visibleSettings.enabled}
            disabled={fieldsDisabled}
            onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span><strong>Защита от массового вступления</strong><small>Если за короткое время в чат вступает подозрительно много участников, бот усиливает защиту, пока наплыв не прекратится.</small></span>
        </label>
        {visibleSettings.enabled ? <>
          <div className="automod-number-grid">
            <label className="automod-field"><span>Порог, участников</span><input type="number" min={3} max={500} value={visibleSettings.joinThreshold} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, joinThreshold: Number(event.target.value) }))} /></label>
            <label className="automod-field"><span>Окно, секунд</span><input type="number" min={5} max={600} value={visibleSettings.windowSeconds} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, windowSeconds: Number(event.target.value) }))} /></label>
            <label className="automod-field"><span>Затишье до снятия, минут</span><input type="number" min={1} max={1440} value={visibleSettings.cooldownMinutes} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, cooldownMinutes: Number(event.target.value) }))} /></label>
          </div>
          <small className="hint-note">Пример: порог 30 и окно 20 секунд — рейд считается начавшимся, если 30 участников вступили за 20 секунд. Снимается ежедневной проверкой после указанного затишья — может занять до суток (как и таймаут капчи).</small>

          <label className="automod-toggle-row automod-toggle-row--compact">
            <input
              type="checkbox"
              checked={visibleSettings.forceCaptcha}
              disabled={fieldsDisabled}
              onChange={(event) => setSettings((current) => ({ ...current, forceCaptcha: event.target.checked }))}
            />
            <span><strong>Принудительная капча во время рейда</strong><small>Каждый новый участник проходит проверку «Я не бот», даже если капча в чате обычно выключена.</small></span>
          </label>
        </> : null}
      </div>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? (
        <div className="automod-actions">
          <button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}>
            <Check size={16} />{saving ? "Сохраняю…" : isGlobalScope ? "Сохранить глобальную политику" : "Сохранить настройки"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { BellRing, Check, MessageCircle, Radio, ShieldCheck, UserRound } from "lucide-react";
import { SettingsRow } from "@/components/settings-row";

export type ModerationNotificationEvent = "WARNING" | "UNWARN" | "MUTE" | "UNMUTE" | "BAN" | "UNBAN" | "KICK";
export type ModerationNotificationAudience = "OFFENDER" | "PUBLIC" | "MODERATOR";
export type ModerationNotificationProfile = {
  event: ModerationNotificationEvent;
  channels: Record<ModerationNotificationAudience, { enabled: boolean; text: string }>;
};

const EVENT_META: Record<ModerationNotificationEvent, { label: string; description: string; sources: string[] }> = {
  WARNING: { label: "Warn", description: "Выдача предупреждения", sources: ["Telegram", "Web Admin", "Automod"] },
  UNWARN: { label: "Снятие Warn", description: "Отзыв предупреждения", sources: ["Telegram", "Web Admin", "Апелляция"] },
  MUTE: { label: "Mute", description: "Временное ограничение", sources: ["Telegram", "Web Admin", "Automod"] },
  UNMUTE: { label: "Unmute", description: "Снятие ограничения", sources: ["Telegram", "Web Admin", "Автоматически"] },
  BAN: { label: "Ban", description: "Блокировка участника", sources: ["Telegram", "Web Admin", "Automod"] },
  UNBAN: { label: "Unban", description: "Снятие блокировки", sources: ["Telegram", "Web Admin", "Автоматически"] },
  KICK: { label: "Kick", description: "Исключение из чата", sources: ["Telegram", "Web Admin"] }
};

const AUDIENCES: Array<{ key: ModerationNotificationAudience; label: string; description: string; icon: typeof UserRound }> = [
  { key: "OFFENDER", label: "Нарушитель", description: "Персональное ephemeral-сообщение в группе.", icon: UserRound },
  { key: "PUBLIC", label: "Публично в чат", description: "Обычное сообщение, видимое всем участникам.", icon: Radio },
  { key: "MODERATOR", label: "Модератор", description: "Персональное подтверждение тому, кто выполнил действие.", icon: ShieldCheck }
];

const SAMPLE: Record<string, string> = {
  "%admin%": "Алексей", "%target%": "@alex_test", "%reason%": "Повторяющийся спам",
  "%duration%": "3 ч.", "%warns%": "2", "%warns_limit%": "3", "%chat%": "Modera Test", "%contact%": "@modera_bot"
};

function preview(text: string) {
  return Object.entries(SAMPLE).reduce((result, [key, value]) => result.replaceAll(key, value), text);
}

export function ModerationNotificationCenter({ initial, canEdit }: { initial: ModerationNotificationProfile[]; canEdit: boolean }) {
  const [profiles, setProfiles] = useState(initial);
  const [selectedEvent, setSelectedEvent] = useState<ModerationNotificationEvent>(initial[0]?.event ?? "WARNING");
  const [selectedAudience, setSelectedAudience] = useState<ModerationNotificationAudience>("OFFENDER");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const selected = profiles.find((profile) => profile.event === selectedEvent) ?? profiles[0];
  const enabledCount = useMemo(() => profiles.reduce((sum, profile) => sum + Object.values(profile.channels).filter((channel) => channel.enabled).length, 0), [profiles]);
  const totalCount = profiles.length * 3;

  function updateChannel(audience: ModerationNotificationAudience, patch: Partial<ModerationNotificationProfile["channels"][ModerationNotificationAudience]>) {
    setProfiles((current) => current.map((profile) => profile.event === selectedEvent
      ? { ...profile, channels: { ...profile.channels, [audience]: { ...profile.channels[audience], ...patch } } }
      : profile));
    setSuccess(null);
  }

  async function save() {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/moderation-notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ profiles }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить центр уведомлений.");
      setProfiles(payload.data.profiles as ModerationNotificationProfile[]);
      setSuccess("Изменения сохранены и уже применяются ботом.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить центр уведомлений.");
    } finally { setSaving(false); }
  }

  if (!selected) return null;
  const meta = EVENT_META[selected.event];
  const channel = selected.channels[selectedAudience];
  const audienceMeta = AUDIENCES.find((item) => item.key === selectedAudience)!;

  return (
    <section className="notification-center">
      <div className="notification-center__header">
        <div className="notification-center__title"><span className="notification-center__mark"><BellRing size={20} /></span><div><h2>Центр уведомлений модерации</h2><p>Одна точка управления сообщениями ручной и автоматической модерации.</p></div></div>
        <div className="notification-center__health"><strong>{enabledCount}/{totalCount}</strong><span>каналов включено</span></div>
      </div>
      <div className="notification-center__workspace">
        <nav className="notification-events" aria-label="События модерации">
          {profiles.map((profile) => { const eventMeta = EVENT_META[profile.event]; return (
            <button type="button" className={`notification-event ${profile.event === selected.event ? "is-active" : ""}`} onClick={() => setSelectedEvent(profile.event)} key={profile.event}>
              <span className="notification-event__copy"><strong>{eventMeta.label}</strong><small>{eventMeta.description}</small></span>
              <span className="notification-event__channels" aria-label="Состояние каналов">{AUDIENCES.map(({ key, label }) => <i key={key} className={profile.channels[key].enabled ? "is-on" : ""} title={`${label}: ${profile.channels[key].enabled ? "включено" : "выключено"}`} />)}</span>
            </button>
          ); })}
        </nav>
        <div className="notification-editor">
          <header className="notification-editor__header"><div><span className="eyebrow">Событие</span><h3>{meta.label}</h3><p>{meta.description}</p></div><div className="notification-source-list">{meta.sources.map((source) => <span key={source}>{source}</span>)}</div></header>
          <div className="notification-audience-tabs" role="tablist" aria-label="Получатель уведомления">
            {AUDIENCES.map(({ key, label, icon: Icon }) => <button type="button" role="tab" aria-selected={selectedAudience === key} className={selectedAudience === key ? "is-active" : ""} onClick={() => setSelectedAudience(key)} key={key}><Icon size={16} /><span>{label}</span><i className={selected.channels[key].enabled ? "is-on" : ""} /></button>)}
          </div>
          <div className="notification-channel">
            <SettingsRow title={`${audienceMeta.label}: уведомление`} description={audienceMeta.description} checked={channel.enabled} disabled={!canEdit || saving} onChange={(enabled) => updateChannel(selectedAudience, { enabled })} />
            <label className="notification-template-field"><span>Текст сообщения</span><textarea rows={7} maxLength={1000} value={channel.text} disabled={!canEdit || saving} onChange={(event) => updateChannel(selectedAudience, { text: event.target.value })} /><small>%admin% · %target% · %reason% · %duration% · %warns% · %warns_limit% · %chat% · %contact%</small></label>
            <div className="notification-preview"><span><MessageCircle size={14} /> Предпросмотр</span><p>{preview(channel.text)}</p></div>
          </div>
        </div>
      </div>
      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? <div className="notification-center__actions"><button className="button button--primary" type="button" disabled={saving} onClick={() => void save()}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить изменения"}</button></div> : null}
    </section>
  );
}

"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Check, ChevronRight, Contact, Dices, FileText, Film, Image, MapPin, MessageCircle, Mic, Music, ShieldCheck, SlidersHorizontal, Sticker, TriangleAlert, Video, X } from "lucide-react";
import { MEDIA_FILTER_LABELS, MEDIA_FILTER_ORDER, MUTE_DURATIONS, type MediaFilterRuleValue, type MediaFilterType, type ModerationSettingsValue } from "@/components/chat-moderation-settings";

type Props = { chatId: string; initial: ModerationSettingsValue; canEdit: boolean; botCanDeleteMessages?: boolean; botCanRestrictMembers?: boolean; onSaved?: (saved: ModerationSettingsValue) => void };

const FILTER_DESCRIPTIONS: Record<MediaFilterType, string> = {
  PHOTO: "Фотографии и изображения.", VIDEO: "Обычные видеозаписи.", ANIMATION: "GIF и анимации.", VOICE: "Голосовые сообщения.", AUDIO: "Музыка и аудиофайлы.", VIDEO_NOTE: "Круглые видеосообщения.", DICE: "Кости, дартс и другие Telegram-эмодзи.", DOCUMENT: "Документы и прикреплённые файлы.", STICKER: "Статичные и анимированные стикеры.", POLL: "Опросы и викторины.", LOCATION: "Геопозиции и места.", CONTACT: "Карточки контактов."
};
const FILTER_ICONS: Record<MediaFilterType, ComponentType<{ size?: number }>> = {
  PHOTO: Image, VIDEO: Video, ANIMATION: Film, VOICE: Mic, AUDIO: Music, VIDEO_NOTE: MessageCircle, DICE: Dices, DOCUMENT: FileText, STICKER: Sticker, POLL: SlidersHorizontal, LOCATION: MapPin, CONTACT: Contact
};

function durationLabel(minutes: number) { return MUTE_DURATIONS.find(([value]) => value === minutes)?.[1] ?? `${minutes} мин.`; }
function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <button type="button" className={`switch ${checked ? "switch--on" : ""}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span className="switch-thumb" /></button>;
}
function BinarySetting({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <div className="automod-binary-setting"><div><strong>{title}</strong><span>{description}</span></div><Toggle checked={checked} disabled={disabled} label={title} onChange={onChange} /></div>;
}

export function ChatMediaFilters({ chatId, initial, canEdit, botCanDeleteMessages = true, botCanRestrictMembers = true, onSaved }: Props) {
  const [settings, setSettings] = useState(initial);
  const [activeType, setActiveType] = useState<MediaFilterType | null>(null);
  const [draft, setDraft] = useState<MediaFilterRuleValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const disabled = !canEdit || saving;
  const activeCount = settings.mediaFilters.filter((rule) => rule.enabled).length;
  const anyDeleteEnabled = settings.mediaFilters.some((rule) => rule.enabled && rule.deleteMessage);
  const anyMuteEnabled = settings.mediaFilters.some((rule) => rule.enabled && rule.punishmentEnabled && rule.punishmentAction === "MUTE");

  useEffect(() => {
    if (!activeType) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeModal(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", closeOnEscape); };
  }, [activeType]);

  function updateMediaFilter(type: MediaFilterType, patch: Partial<MediaFilterRuleValue>) {
    setSettings((current) => ({ ...current, mediaFilters: current.mediaFilters.map((rule) => rule.type === type ? { ...rule, ...patch } : rule) }));
  }
  function openRule(type: MediaFilterType) { const rule = settings.mediaFilters.find((item) => item.type === type); if (rule) { setDraft(structuredClone(rule)); setActiveType(type); } }
  function closeModal() { setActiveType(null); setDraft(null); }
  function applyModal() { if (activeType && draft) updateMediaFilter(activeType, { ...draft, deleteMessage: draft.enabled, warnOnTrigger: draft.enabled && draft.punishmentEnabled && draft.punishmentAction === "WARN" }); closeModal(); }
  function updateDraft(patch: Partial<MediaFilterRuleValue>) { setDraft((current) => current ? { ...current, ...patch } : current); }

  async function save() {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/moderation`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить фильтры.");
      const saved = payload.data as ModerationSettingsValue;
      setSettings(saved); setSuccess("Фильтры сохранены и применяются к новым Telegram-событиям."); onSaved?.(saved);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить фильтры."); }
    finally { setSaving(false); }
  }

  return <section className="panel profile-section automod-page-panel">
    <div className="panel-header automod-page-header"><div><h2>Фильтры</h2><p>Для каждого типа контента выберите: разрешать его или удалять.</p></div><div className="automod-active-count"><strong>{activeCount}</strong><span>типов удаляются</span></div></div>
    <div className="automod-settings automod-settings--modal-list">
      {!botCanDeleteMessages && anyDeleteEnabled ? <div className="moderation-notice"><TriangleAlert size={16} /><span>У бота нет права удаления сообщений. Фильтры продолжат обнаруживать контент, но Telegram отклонит удаление.</span></div> : null}
      {!botCanRestrictMembers && anyMuteEnabled ? <div className="moderation-notice"><TriangleAlert size={16} /><span>У бота нет права ограничивать участников. Warn сохранится, но Mute будет завершаться ошибкой до выдачи права.</span></div> : null}
      {!canEdit ? <div className="moderation-readonly"><ShieldCheck size={18} /><div><strong>Только просмотр</strong><p>Изменять фильтры чата могут OWNER и ADMIN.</p></div></div> : null}
      <div className="automod-rule-list">{MEDIA_FILTER_ORDER.map((type) => {
        const rule = settings.mediaFilters.find((item) => item.type === type); if (!rule) return null; const Icon = FILTER_ICONS[type];
        return <article className={`automod-rule-card filter-rule-card ${rule.enabled ? "" : "automod-rule-card--disabled"}`} key={type}><button type="button" className="automod-rule-open filter-rule-open" onClick={() => openRule(type)} aria-label={`Настроить: ${MEDIA_FILTER_LABELS[type]}`}><span className="automod-rule-icon"><Icon size={19} /></span><span className="automod-rule-copy"><strong>{MEDIA_FILTER_LABELS[type]}</strong><small>{FILTER_DESCRIPTIONS[type]}</small></span><span className={`filter-rule-status ${rule.enabled ? "filter-rule-status--delete" : ""}`}>{rule.enabled ? "Удалять" : "Разрешать"}</span><span className="automod-rule-chevron"><ChevronRight size={17} /></span></button></article>;
      })}</div>
      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}{success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? <div className="automod-actions"><button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить фильтры"}</button></div> : null}
    </div>
    {activeType && draft ? <div className="automod-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}><div className="automod-modal" role="dialog" aria-modal="true" aria-labelledby="filter-modal-title"><div className="automod-modal-header"><div className="automod-modal-heading"><span><SlidersHorizontal size={19} /></span><div><h3 id="filter-modal-title">{MEDIA_FILTER_LABELS[activeType]}</h3><p>{FILTER_DESCRIPTIONS[activeType]}</p></div></div><button type="button" className="icon-button" aria-label="Закрыть" onClick={closeModal}><X size={18} /></button></div><div className="automod-modal-body"><FilterOutcomeFields draft={draft} disabled={disabled} update={updateDraft} /></div><div className="automod-modal-footer"><button type="button" className="button" onClick={closeModal}>Отмена</button>{canEdit ? <button type="button" className="button button--primary" onClick={applyModal}>Применить</button> : null}</div></div></div> : null}
  </section>;
}

function FilterOutcomeFields({ draft, disabled, update }: { draft: MediaFilterRuleValue; disabled: boolean; update: (patch: Partial<MediaFilterRuleValue>) => void }) {
  return <div className="automod-outcome-stack"><fieldset className="filter-decision" disabled={disabled}><legend>Действие с контентом</legend><label className={`filter-decision-option ${!draft.enabled ? "filter-decision-option--selected" : ""}`}><span><strong>Разрешать</strong><small>Контент останется в чате.</small></span><input type="radio" name="filter-decision" value="ALLOW" checked={!draft.enabled} onChange={() => update({ enabled: false, deleteMessage: false })} /></label><label className={`filter-decision-option ${draft.enabled ? "filter-decision-option--selected" : ""}`}><span><strong>Удалять</strong><small>Modera удалит такой контент из чата.</small></span><input type="radio" name="filter-decision" value="DELETE" checked={draft.enabled} onChange={() => update({ enabled: true, deleteMessage: true })} /></label></fieldset>{draft.enabled ? <><div className="automod-conditional-block"><BinarySetting title="Выдать наказание" description={!draft.punishmentEnabled ? "Наказание не применяется." : draft.punishmentAction === "WARN" ? "Пользователь получит +1 Warn." : `Пользователь получит Mute на ${durationLabel(draft.muteDurationMinutes)}.`} checked={draft.punishmentEnabled} disabled={disabled} onChange={(checked) => update({ punishmentEnabled: checked })} />{draft.punishmentEnabled ? <div className="automod-conditional-grid"><label className="automod-field"><span>Тип наказания</span><select value={draft.punishmentAction} disabled={disabled} onChange={(event) => update({ punishmentAction: event.target.value as "WARN" | "MUTE" })}><option value="WARN">Warn</option><option value="MUTE">Mute</option></select></label>{draft.punishmentAction === "MUTE" ? <label className="automod-field"><span>Срок наказания</span><select value={draft.muteDurationMinutes} disabled={disabled} onChange={(event) => update({ muteDurationMinutes: Number(event.target.value) })}>{MUTE_DURATIONS.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}</select></label> : null}</div> : null}</div><div className="automod-conditional-block"><BinarySetting title="Отправлять сообщение при срабатывании" description={draft.notifyEnabled ? "Modera отправит указанный ниже текст." : "Дополнительное сообщение не отправляется."} checked={draft.notifyEnabled} disabled={disabled} onChange={(checked) => update({ notifyEnabled: checked })} />{draft.notifyEnabled ? <label className="automod-field automod-message-editor"><span>Текст сообщения</span><textarea rows={5} value={draft.notifyText} disabled={disabled} onChange={(event) => update({ notifyText: event.target.value })} placeholder="Введите текст сообщения…" /><small>Поле пустое по умолчанию. Доступны переменные %target% и %chat%.</small></label> : null}</div></> : <p className="automod-modal-note">Для разрешённого контента наказание и сообщение не применяются.</p>}</div>;
}

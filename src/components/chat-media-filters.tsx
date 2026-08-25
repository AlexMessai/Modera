"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Check, ChevronRight, Contact, Dices, FileText, Film, Image, Link2, ListFilter, MapPin, MessageCircle, Mic, Music, ShieldCheck, SlidersHorizontal, Sticker, TriangleAlert, Video, X } from "lucide-react";
import { FormattedTextarea } from "@/components/formatted-textarea";
import { MEDIA_FILTER_LABELS, MEDIA_FILTER_ORDER, MUTE_DURATIONS, type AutomodActionRule, type AutomodRuleActionValue, type MediaFilterRuleValue, type MediaFilterType, type ModerationSettingsValue } from "@/components/chat-moderation-settings";

type Props = { chatId: string; initial: ModerationSettingsValue; canEdit: boolean; botCanDeleteMessages?: boolean; botCanRestrictMembers?: boolean; onSaved?: (saved: ModerationSettingsValue) => void };
type TextFilterType = "LINK" | "TERM";
type FilterType = TextFilterType | MediaFilterType;

const TEXT_FILTERS: Array<{ type: TextFilterType; label: string; description: string; icon: ComponentType<{ size?: number }> }> = [
  { type: "LINK", label: "Ссылки (домены)", description: "Ссылки в тексте сообщений и подписях.", icon: Link2 },
  { type: "TERM", label: "Фильтр слов", description: "Запрещённые слова и фразы в сообщениях.", icon: ListFilter }
];
const FILTER_DESCRIPTIONS: Record<MediaFilterType, string> = {
  PHOTO: "Фотографии и изображения.", VIDEO: "Обычные видеозаписи.", ANIMATION: "GIF и анимации.", VOICE: "Голосовые сообщения.", AUDIO: "Музыка и аудиофайлы.", VIDEO_NOTE: "Круглые видеосообщения.", DICE: "Кости, дартс и другие Telegram-эмодзи.", DOCUMENT: "Документы и прикреплённые файлы.", STICKER: "Статичные и анимированные стикеры.", POLL: "Опросы и викторины.", LOCATION: "Геопозиции и места.", CONTACT: "Карточки контактов."
};
const FILTER_ICONS: Record<MediaFilterType, ComponentType<{ size?: number }>> = {
  PHOTO: Image, VIDEO: Video, ANIMATION: Film, VOICE: Mic, AUDIO: Music, VIDEO_NOTE: MessageCircle, DICE: Dices, DOCUMENT: FileText, STICKER: Sticker, POLL: SlidersHorizontal, LOCATION: MapPin, CONTACT: Contact
};
function cleanLines(values: string[]) { return values.map((value) => value.trim()).filter(Boolean); }
function splitLines(value: string) { return value.split(/\r?\n/); }
function durationLabel(minutes: number) { return MUTE_DURATIONS.find(([value]) => value === minutes)?.[1] ?? `${minutes} мин.`; }
function actionFor(settings: ModerationSettingsValue, rule: AutomodActionRule) { return settings.ruleActions.find((item) => item.rule === rule)!; }
function textFilterEnabled(settings: ModerationSettingsValue, type: TextFilterType) { return type === "LINK" ? settings.linkEnabled : settings.blockedTermsEnabled; }
function linksForbiddenByDefault(settings: ModerationSettingsValue) { return settings.linkProtectionMode === "BLOCK_ALL" || settings.linkProtectionMode === "WHITELIST_ONLY"; }
function linkExceptions(settings: ModerationSettingsValue) { return linksForbiddenByDefault(settings) ? settings.allowedDomains : settings.blockedDomains; }
function setLinkDecision(settings: ModerationSettingsValue, forbidden: boolean): ModerationSettingsValue {
  const exceptions = linkExceptions(settings);
  const hasExceptions = cleanLines(exceptions).length > 0;
  return forbidden
    ? { ...settings, linkEnabled: true, linkProtectionMode: hasExceptions ? "WHITELIST_ONLY" : "BLOCK_ALL", allowedDomains: exceptions }
    : { ...settings, linkEnabled: hasExceptions, linkProtectionMode: hasExceptions ? "BLACKLIST_ONLY" : "ALLOW_ALL", blockedDomains: exceptions };
}
function setLinkExceptions(settings: ModerationSettingsValue, exceptions: string[]): ModerationSettingsValue {
  const hasExceptions = cleanLines(exceptions).length > 0;
  return linksForbiddenByDefault(settings)
    ? { ...settings, linkEnabled: true, linkProtectionMode: hasExceptions ? "WHITELIST_ONLY" : "BLOCK_ALL", allowedDomains: exceptions }
    : { ...settings, linkEnabled: hasExceptions, linkProtectionMode: hasExceptions ? "BLACKLIST_ONLY" : "ALLOW_ALL", blockedDomains: exceptions };
}
function setTextFilterEnabled(settings: ModerationSettingsValue, type: TextFilterType, enabled: boolean): ModerationSettingsValue {
  return { ...settings, ...(type === "LINK" ? { linkEnabled: enabled } : { blockedTermsEnabled: enabled }), ruleActions: settings.ruleActions.map((action) => action.rule === type ? { ...action, deleteMessage: enabled } : action) };
}
function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <button type="button" className={`switch ${checked ? "switch--on" : ""}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span className="switch-thumb" /></button>;
}
function BinarySetting({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <div className="automod-binary-setting"><div><strong>{title}</strong><span>{description}</span></div><Toggle checked={checked} disabled={disabled} label={title} onChange={onChange} /></div>;
}

export function ChatMediaFilters({ chatId, initial, canEdit, botCanDeleteMessages = true, botCanRestrictMembers = true, onSaved }: Props) {
  const [settings, setSettings] = useState(initial);
  const [activeType, setActiveType] = useState<FilterType | null>(null);
  const [draft, setDraft] = useState<ModerationSettingsValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const disabled = !canEdit || saving;
  const activeCount = settings.mediaFilters.filter((rule) => rule.enabled).length + Number(settings.linkEnabled) + Number(settings.blockedTermsEnabled);
  const textActions = [actionFor(settings, "LINK"), actionFor(settings, "TERM")];
  const anyDeleteEnabled = settings.linkEnabled || settings.blockedTermsEnabled || settings.mediaFilters.some((rule) => rule.enabled);
  const anyMuteEnabled = textActions.some((rule) => rule.punishmentEnabled && rule.punishmentAction === "MUTE") || settings.mediaFilters.some((rule) => rule.enabled && rule.punishmentEnabled && rule.punishmentAction === "MUTE");

  useEffect(() => {
    if (!activeType) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) closeModal(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", closeOnEscape); };
  }, [activeType, saving]);

  function openRule(type: FilterType) { setDraft(structuredClone(settings)); setActiveType(type); setError(null); }
  function closeModal() { setActiveType(null); setDraft(null); }
  function updateDraft(patch: Partial<ModerationSettingsValue>) { setDraft((current) => current ? { ...current, ...patch } : current); }
  function updateAction(rule: TextFilterType, patch: Partial<AutomodRuleActionValue>) { setDraft((current) => current ? { ...current, ruleActions: current.ruleActions.map((action) => action.rule === rule ? { ...action, ...patch } : action) } : current); }
  function updateMedia(type: MediaFilterType, patch: Partial<MediaFilterRuleValue>) { setDraft((current) => current ? { ...current, mediaFilters: current.mediaFilters.map((rule) => rule.type === type ? { ...rule, ...patch } : rule) } : current); }

  async function saveModal() {
    if (!activeType || !draft) return;
    const nextSettings: ModerationSettingsValue = { ...draft, linkEnabled: draft.linkProtectionMode !== "ALLOW_ALL", allowedDomains: cleanLines(draft.allowedDomains), blockedDomains: cleanLines(draft.blockedDomains), blockedTerms: cleanLines(draft.blockedTerms), mediaFilters: draft.mediaFilters.map((rule) => ({ ...rule, deleteMessage: rule.enabled, warnOnTrigger: rule.enabled && rule.punishmentEnabled && rule.punishmentAction === "WARN" })) };
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/moderation`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(nextSettings) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить фильтры.");
      const saved = payload.data as ModerationSettingsValue;
      setSettings(saved); setSuccess("Фильтр сохранён и применяется к новым Telegram-событиям."); onSaved?.(saved); closeModal();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить фильтры."); }
    finally { setSaving(false); }
  }

  const modalTitle = activeType === "LINK" || activeType === "TERM" ? TEXT_FILTERS.find((item) => item.type === activeType)?.label : activeType ? MEDIA_FILTER_LABELS[activeType] : "";
  const modalDescription = activeType === "LINK" || activeType === "TERM" ? TEXT_FILTERS.find((item) => item.type === activeType)?.description : activeType ? FILTER_DESCRIPTIONS[activeType] : "";

  return <section className="panel profile-section automod-page-panel">
    <div className="panel-header automod-page-header"><div><h2>Фильтры</h2><p>Для каждого вида содержимого выберите: разрешать его или удалять.</p></div><div className="automod-active-count"><strong>{activeCount}</strong><span>фильтров удаляют</span></div></div>
    <div className="automod-settings automod-settings--modal-list">
      {!botCanDeleteMessages && anyDeleteEnabled ? <div className="moderation-notice"><TriangleAlert size={16} /><span>У бота нет права удаления сообщений. Фильтры продолжат обнаруживать контент, но Telegram отклонит удаление.</span></div> : null}
      {!botCanRestrictMembers && anyMuteEnabled ? <div className="moderation-notice"><TriangleAlert size={16} /><span>У бота нет права ограничивать участников. Warn сохранится, но Mute будет завершаться ошибкой до выдачи права.</span></div> : null}
      {!canEdit ? <div className="moderation-readonly"><ShieldCheck size={18} /><div><strong>Только просмотр</strong><p>Изменять фильтры чата могут OWNER и ADMIN.</p></div></div> : null}
      <div className="automod-rule-list">
        {TEXT_FILTERS.map(({ type, label, description, icon: Icon }) => { const enabled = textFilterEnabled(settings, type); const deleting = type === "LINK" ? linksForbiddenByDefault(settings) : enabled; const status = type === "LINK" ? (deleting ? "Запрещено" : "Разрешено") : (enabled ? "Удалять" : "Нет"); return <article className={`automod-rule-card filter-rule-card ${enabled ? "" : "automod-rule-card--disabled"}`} key={type}><button type="button" className="automod-rule-open filter-rule-open" onClick={() => openRule(type)} aria-label={`Настроить: ${label}`}><span className="automod-rule-icon"><Icon size={19} /></span><span className="automod-rule-copy"><strong>{label}</strong><small>{description}</small></span><span className={`filter-rule-status ${deleting ? "filter-rule-status--delete" : ""}`}>{status}</span><span className="automod-rule-chevron"><ChevronRight size={17} /></span></button></article>; })}
        {MEDIA_FILTER_ORDER.map((type) => { const rule = settings.mediaFilters.find((item) => item.type === type); if (!rule) return null; const Icon = FILTER_ICONS[type]; return <article className={`automod-rule-card filter-rule-card ${rule.enabled ? "" : "automod-rule-card--disabled"}`} key={type}><button type="button" className="automod-rule-open filter-rule-open" onClick={() => openRule(type)} aria-label={`Настроить: ${MEDIA_FILTER_LABELS[type]}`}><span className="automod-rule-icon"><Icon size={19} /></span><span className="automod-rule-copy"><strong>{MEDIA_FILTER_LABELS[type]}</strong><small>{FILTER_DESCRIPTIONS[type]}</small></span><span className={`filter-rule-status ${rule.enabled ? "filter-rule-status--delete" : ""}`}>{rule.enabled ? "Удалять" : "Разрешать"}</span><span className="automod-rule-chevron"><ChevronRight size={17} /></span></button></article>; })}
      </div>
      {!activeType && error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}{success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
    </div>
    {activeType && draft ? <div className="automod-modal-backdrop" role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) closeModal(); }}><div className="automod-modal" role="dialog" aria-modal="true" aria-labelledby="filter-modal-title"><div className="automod-modal-header"><div className="automod-modal-heading"><span><SlidersHorizontal size={19} /></span><div><h3 id="filter-modal-title">{modalTitle}</h3><p>{modalDescription}</p></div></div><button type="button" className="icon-button" aria-label="Закрыть" disabled={saving} onClick={closeModal}><X size={18} /></button></div><div className="automod-modal-body">
      {activeType === "LINK" ? <TextFilterFields type="LINK" draft={draft} disabled={disabled} updateDraft={updateDraft} updateAction={updateAction} /> : null}
      {activeType === "TERM" ? <TextFilterFields type="TERM" draft={draft} disabled={disabled} updateDraft={updateDraft} updateAction={updateAction} /> : null}
      {activeType !== "LINK" && activeType !== "TERM" ? <MediaFilterFields draft={draft.mediaFilters.find((rule) => rule.type === activeType)!} disabled={disabled} update={(patch) => updateMedia(activeType, patch)} /> : null}
      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
    </div><div className="automod-modal-footer"><button type="button" className="button" disabled={saving} onClick={closeModal}>Отмена</button>{canEdit ? <button type="button" className="button button--primary" disabled={saving} onClick={() => void saveModal()}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить"}</button> : null}</div></div></div> : null}
  </section>;
}

function Decision({ enabled, disabled, offLabel = "Разрешать", onLabel = "Удалять", offDescription = "Содержимое останется в чате.", onDescription = "Modera удалит сообщение из чата.", onChange }: { enabled: boolean; disabled: boolean; offLabel?: string; onLabel?: string; offDescription?: string; onDescription?: string; onChange: (enabled: boolean) => void }) {
  return <fieldset className="filter-decision" disabled={disabled}><legend>Действие с содержимым</legend><label className={`filter-decision-option ${!enabled ? "filter-decision-option--selected" : ""}`}><span><strong>{offLabel}</strong><small>{offDescription}</small></span><input type="radio" name="filter-decision" checked={!enabled} onChange={() => onChange(false)} /></label><label className={`filter-decision-option ${enabled ? "filter-decision-option--selected" : ""}`}><span><strong>{onLabel}</strong><small>{onDescription}</small></span><input type="radio" name="filter-decision" checked={enabled} onChange={() => onChange(true)} /></label></fieldset>;
}
function OutcomeSettings({ action, disabled, update }: { action: AutomodRuleActionValue | MediaFilterRuleValue; disabled: boolean; update: (patch: Partial<AutomodRuleActionValue & MediaFilterRuleValue>) => void }) {
  return <><div className="automod-conditional-block"><BinarySetting title="Выдать наказание" description={!action.punishmentEnabled ? "Наказание не применяется." : action.punishmentAction === "WARN" ? "Пользователь получит +1 Warn." : `Пользователь получит Mute на ${durationLabel(action.muteDurationMinutes)}.`} checked={action.punishmentEnabled} disabled={disabled} onChange={(checked) => update({ punishmentEnabled: checked })} />{action.punishmentEnabled ? <div className="automod-conditional-grid"><label className="automod-field"><span>Тип наказания</span><select value={action.punishmentAction} disabled={disabled} onChange={(event) => update({ punishmentAction: event.target.value as "WARN" | "MUTE" })}><option value="WARN">Warn</option><option value="MUTE">Mute</option></select></label>{action.punishmentAction === "MUTE" ? <label className="automod-field"><span>Срок наказания</span><select value={action.muteDurationMinutes} disabled={disabled} onChange={(event) => update({ muteDurationMinutes: Number(event.target.value) })}>{MUTE_DURATIONS.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}</select></label> : null}</div> : null}</div><div className="automod-conditional-block"><BinarySetting title="Отправлять сообщение при срабатывании" description={action.notifyEnabled ? "Modera отправит указанный ниже текст." : "Дополнительное сообщение не отправляется."} checked={action.notifyEnabled} disabled={disabled} onChange={(checked) => update({ notifyEnabled: checked })} />{action.notifyEnabled ? <label className="automod-field automod-message-editor"><span>Текст сообщения</span><FormattedTextarea rows={5} value={action.notifyText} disabled={disabled} onChange={(value) => update({ notifyText: value })} placeholder="Введите текст сообщения…" /><small>Доступны переменные %target% и %chat%.</small></label> : null}</div></>;
}
function TextFilterFields({ type, draft, disabled, updateDraft, updateAction }: { type: TextFilterType; draft: ModerationSettingsValue; disabled: boolean; updateDraft: (patch: Partial<ModerationSettingsValue>) => void; updateAction: (rule: TextFilterType, patch: Partial<AutomodRuleActionValue>) => void }) {
  const enabled = textFilterEnabled(draft, type);
  const action = actionFor(draft, type);
  const linksForbidden = linksForbiddenByDefault(draft);
  const exceptions = linkExceptions(draft);
  return <div className="automod-outcome-stack">
    {type === "LINK"
      ? <><Decision enabled={linksForbidden} disabled={disabled} offLabel="Разрешено" onLabel="Запрещено" offDescription="Ссылки разрешены, кроме указанных исключений." onDescription="Ссылки удаляются, кроме указанных исключений." onChange={(forbidden) => updateDraft(setLinkDecision(draft, forbidden))} /><label className="automod-field automod-field--full-row"><span>Исключения</span><textarea rows={5} value={exceptions.join("\n")} disabled={disabled} onChange={(event) => updateDraft(setLinkExceptions(draft, splitLines(event.target.value)))} placeholder={"example.com\nt.me/modera"} /><small>{linksForbidden ? "Укажите разрешённые ссылки — по одной на строку." : "Укажите запрещённые ссылки — по одной на строку."}</small></label></>
      : <><Decision enabled={enabled} disabled={disabled} offLabel="Нет" offDescription="Фильтр слов не применяется." onChange={(value) => updateDraft(setTextFilterEnabled(draft, type, value))} />{enabled ? <label className="automod-field automod-field--full-row"><span>Запрещённые слова и фразы</span><textarea rows={7} value={draft.blockedTerms.join("\n")} disabled={disabled} onChange={(event) => updateDraft({ blockedTerms: splitLines(event.target.value) })} placeholder={"рекламная фраза\nзапрещённое слово"} /><small>По одному выражению на строку, до 200 значений.</small></label> : null}</>}
    {enabled ? <OutcomeSettings action={action} disabled={disabled} update={(patch) => updateAction(type, patch)} /> : <p className="automod-modal-note">Фильтр не применяет наказание.</p>}
  </div>;
}
function MediaFilterFields({ draft, disabled, update }: { draft: MediaFilterRuleValue; disabled: boolean; update: (patch: Partial<MediaFilterRuleValue>) => void }) {
  return <div className="automod-outcome-stack"><Decision enabled={draft.enabled} disabled={disabled} onChange={(enabled) => update({ enabled, deleteMessage: enabled })} />{draft.enabled ? <OutcomeSettings action={draft} disabled={disabled} update={update} /> : <p className="automod-modal-note">Фильтр разрешает содержимое и не применяет наказание.</p>}</div>;
}

"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { ArrowDown, ArrowUp, Check, ChevronRight, Link2, ListFilter, MessageSquareText, Plus, Repeat2, ShieldCheck, SlidersHorizontal, TimerReset, Trash2, TriangleAlert, X, Zap } from "lucide-react";

export type MediaFilterType = "PHOTO" | "VIDEO" | "ANIMATION" | "VOICE" | "AUDIO" | "VIDEO_NOTE" | "DICE" | "DOCUMENT" | "STICKER" | "POLL" | "LOCATION" | "CONTACT";
export type MediaFilterRuleValue = { type: MediaFilterType; enabled: boolean; warnOnTrigger: boolean; notifyEnabled: boolean; notifyText: string };
export const MEDIA_FILTER_LABELS: Record<MediaFilterType, string> = { PHOTO: "Изображения", VIDEO: "Видео", ANIMATION: "GIF", VOICE: "Голосовые сообщения", AUDIO: "Аудиофайлы", VIDEO_NOTE: "Видеосообщения", DICE: "Анимированные кости", DOCUMENT: "Файлы", STICKER: "Стикеры", POLL: "Опросы", LOCATION: "Геолокация", CONTACT: "Контакты" };
export const MEDIA_FILTER_ORDER: MediaFilterType[] = ["PHOTO", "VIDEO", "ANIMATION", "VOICE", "AUDIO", "VIDEO_NOTE", "DICE", "DOCUMENT", "STICKER", "POLL", "LOCATION", "CONTACT"];

export type EscalationRuleValue = { order: number; thresholdWarnings: number; action: "MUTE" | "BAN"; durationMinutes: number | null };
export const LINK_PROTECTION_MODES = ["ALLOW_ALL", "BLOCK_ALL", "WHITELIST_ONLY", "BLACKLIST_ONLY"] as const;
export type LinkProtectionMode = (typeof LINK_PROTECTION_MODES)[number];
const LINK_MODE_LABELS: Record<LinkProtectionMode, string> = { ALLOW_ALL: "Разрешать все ссылки", BLOCK_ALL: "Блокировать все ссылки", WHITELIST_ONLY: "Разрешать только из списка", BLACKLIST_ONLY: "Блокировать только из списка" };

export type AutomodActionRule = "LINK" | "TERM" | "SPAM" | "DUPLICATE" | "MENTIONS";
export type AutomodRuleActionValue = { rule: AutomodActionRule; deleteMessage: boolean; punishmentEnabled: boolean; punishmentAction: "WARN" | "MUTE"; muteDurationMinutes: number; notifyEnabled: boolean; notifyText: string };
export type ModerationSettingsValue = {
  linkEnabled: boolean; linkProtectionMode: LinkProtectionMode; allowedDomains: string[]; blockedDomains: string[];
  spamEnabled: boolean; spamWindowSeconds: number; spamMaxMessages: number;
  blockedTermsEnabled: boolean; blockedTerms: string[];
  massMentionsEnabled: boolean; maxMentions: number;
  duplicateEnabled: boolean; duplicateWindowSeconds: number; duplicateMaxMessages: number;
  ignoreAdmins: boolean; autoEscalationEnabled: boolean; escalationRules: EscalationRuleValue[]; warningExpiryDays: number;
  announceEscalationEnabled: boolean; escalationMuteMessageTemplate: string; escalationBanMessageTemplate: string;
  mediaFilters: MediaFilterRuleValue[]; ruleActions: AutomodRuleActionValue[];
};

type Props = { chatId: string; initial: ModerationSettingsValue; canEdit: boolean; botCanDeleteMessages?: boolean; botCanRestrictMembers?: boolean; onSaved?: (saved: ModerationSettingsValue) => void };
type EditableRule = AutomodActionRule | "ESCALATION";
type RuleDefinition = { key: AutomodActionRule; title: string; description: string; icon: ComponentType<{ size?: number }>; enabled: (value: ModerationSettingsValue) => boolean; setEnabled: (value: ModerationSettingsValue, enabled: boolean) => ModerationSettingsValue };

const RULES: RuleDefinition[] = [
  { key: "LINK", title: "Защита от ссылок", description: "Контролирует внешние ссылки и доменные списки.", icon: Link2, enabled: (s) => s.linkEnabled, setEnabled: (s, enabled) => ({ ...s, linkEnabled: enabled }) },
  { key: "TERM", title: "Запрещённые слова и фразы", description: "Проверяет текст сообщений и подписи к медиа.", icon: ListFilter, enabled: (s) => s.blockedTermsEnabled, setEnabled: (s, enabled) => ({ ...s, blockedTermsEnabled: enabled }) },
  { key: "SPAM", title: "Антифлуд", description: "Срабатывает при превышении лимита сообщений.", icon: Zap, enabled: (s) => s.spamEnabled, setEnabled: (s, enabled) => ({ ...s, spamEnabled: enabled }) },
  { key: "DUPLICATE", title: "Повторяющиеся сообщения", description: "Находит одинаковые сообщения за выбранный период.", icon: Repeat2, enabled: (s) => s.duplicateEnabled, setEnabled: (s, enabled) => ({ ...s, duplicateEnabled: enabled }) },
  { key: "MENTIONS", title: "Массовые упоминания", description: "Ограничивает число упоминаний в одном сообщении.", icon: MessageSquareText, enabled: (s) => s.massMentionsEnabled, setEnabled: (s, enabled) => ({ ...s, massMentionsEnabled: enabled }) }
];
const MUTE_DURATIONS = [[15, "15 минут"], [60, "1 час"], [360, "6 часов"], [720, "12 часов"], [1440, "1 день"], [4320, "3 дня"], [10080, "7 дней"], [43200, "30 дней"]] as const;
const PRESETS = {
  LOW: { spamWindowSeconds: 20, spamMaxMessages: 10, duplicateWindowSeconds: 120, duplicateMaxMessages: 5, maxMentions: 10 },
  NORMAL: { spamWindowSeconds: 10, spamMaxMessages: 5, duplicateWindowSeconds: 60, duplicateMaxMessages: 2, maxMentions: 5 },
  STRICT: { spamWindowSeconds: 5, spamMaxMessages: 3, duplicateWindowSeconds: 30, duplicateMaxMessages: 1, maxMentions: 3 }
} as const;
type Preset = keyof typeof PRESETS;

function matchingPreset(settings: ModerationSettingsValue): Preset | "CUSTOM" {
  if (!settings.spamEnabled || !settings.duplicateEnabled || !settings.massMentionsEnabled) return "CUSTOM";
  return (Object.keys(PRESETS) as Preset[]).find((key) => Object.entries(PRESETS[key]).every(([field, value]) => settings[field as keyof typeof PRESETS[typeof key]] === value)) ?? "CUSTOM";
}
function splitDraftLines(value: string) { return value.split(/\r?\n/); }
function cleanLines(values: string[]) { return values.map((item) => item.trim()).filter(Boolean); }
function renumber(rules: EscalationRuleValue[]) { return rules.map((rule, index) => ({ ...rule, order: index + 1 })); }
function actionFor(settings: ModerationSettingsValue, rule: AutomodActionRule) { return settings.ruleActions.find((item) => item.rule === rule)!; }
function durationLabel(minutes: number) { return MUTE_DURATIONS.find(([value]) => value === minutes)?.[1] ?? `${minutes} мин.`; }
function ruleSummary(settings: ModerationSettingsValue, rule: AutomodActionRule) {
  const action = actionFor(settings, rule);
  const result = [action.deleteMessage ? "Удаление" : "Оставить сообщение"];
  result.push(!action.punishmentEnabled ? "Без наказания" : action.punishmentAction === "WARN" ? "Warn" : `Mute · ${durationLabel(action.muteDurationMinutes)}`);
  if (action.notifyEnabled) result.push("Сообщение");
  return result.join(" · ");
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <button type="button" className={`switch ${checked ? "switch--on" : ""}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span className="switch-thumb" /></button>;
}
function BinarySetting({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <div className="automod-binary-setting"><div><strong>{title}</strong><span>{description}</span></div><Toggle checked={checked} disabled={disabled} label={title} onChange={onChange} /></div>;
}

export function ChatModerationSettings({ chatId, initial, canEdit, botCanDeleteMessages = true, botCanRestrictMembers = true, onSaved }: Props) {
  const [settings, setSettings] = useState(initial);
  const [activeRule, setActiveRule] = useState<EditableRule | null>(null);
  const [draft, setDraft] = useState<ModerationSettingsValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const disabled = !canEdit || saving;
  const activeCount = RULES.filter((rule) => rule.enabled(settings)).length + (settings.autoEscalationEnabled ? 1 : 0);
  const activePreset = useMemo(() => matchingPreset(settings), [settings]);
  const anyDeleteEnabled = RULES.some((rule) => rule.enabled(settings) && actionFor(settings, rule.key).deleteMessage);
  const anyMuteEnabled = RULES.some((rule) => { const action = actionFor(settings, rule.key); return rule.enabled(settings) && action.punishmentEnabled && action.punishmentAction === "MUTE"; }) || settings.autoEscalationEnabled;

  useEffect(() => {
    if (!activeRule) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setActiveRule(null); setDraft(null); } };
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", closeOnEscape); };
  }, [activeRule]);

  function openRule(rule: EditableRule) { setDraft(structuredClone(settings)); setActiveRule(rule); }
  function closeModal() { setActiveRule(null); setDraft(null); }
  function applyModal() { if (draft) setSettings(draft); closeModal(); }
  function updateDraft(patch: Partial<ModerationSettingsValue>) { setDraft((current) => current ? { ...current, ...patch } : current); }
  function updateDraftAction(rule: AutomodActionRule, patch: Partial<AutomodRuleActionValue>) { setDraft((current) => current ? { ...current, ruleActions: current.ruleActions.map((action) => action.rule === rule ? { ...action, ...patch } : action) } : current); }
  function applyPreset(key: Preset) { setSettings((current) => ({ ...current, spamEnabled: true, duplicateEnabled: true, massMentionsEnabled: true, ...PRESETS[key] })); }
  async function save() {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/moderation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...settings,
          allowedDomains: cleanLines(settings.allowedDomains),
          blockedDomains: cleanLines(settings.blockedDomains),
          blockedTerms: cleanLines(settings.blockedTerms)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки.");
      const saved = payload.data as ModerationSettingsValue;
      setSettings(saved); setSuccess("Правила сохранены и применяются к новым Telegram-событиям."); onSaved?.(saved);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки."); }
    finally { setSaving(false); }
  }

  return <section className="panel profile-section automod-page-panel">
    <div className="panel-header automod-page-header"><div><h2>Automod</h2><p>Включайте правила отдельно и настраивайте результат каждого срабатывания.</p></div><div className="automod-active-count"><strong>{activeCount}</strong><span>активных правил</span></div></div>
    <div className="automod-settings automod-settings--modal-list">
      {!botCanDeleteMessages && anyDeleteEnabled ? <div className="moderation-notice"><TriangleAlert size={16} /><span>У бота нет права удаления сообщений. Правила продолжат обнаруживать нарушения, но Telegram отклонит удаление.</span></div> : null}
      {!botCanRestrictMembers && anyMuteEnabled ? <div className="moderation-notice"><TriangleAlert size={16} /><span>У бота нет права ограничивать участников. Warn сохранится, но Mute будет завершаться ошибкой до выдачи права.</span></div> : null}
      {!canEdit ? <div className="moderation-readonly"><ShieldCheck size={18} /><div><strong>Только просмотр</strong><p>Изменять правила чата могут OWNER и ADMIN.</p></div></div> : null}
      <div className="automod-global-row"><div className="automod-global-icon"><ShieldCheck size={18} /></div><div><strong>Не применять правила к администраторам Telegram</strong><span>Единое исключение для всех правил Automod.</span></div><Toggle checked={settings.ignoreAdmins} disabled={disabled} label="Не применять правила к администраторам Telegram" onChange={(checked) => setSettings((current) => ({ ...current, ignoreAdmins: checked }))} /></div>
      <div className="automod-preset-strip"><div><strong>Быстрая настройка антиспама</strong><span>Меняет лимиты антифлуда, повторов и упоминаний; детали остаются доступны в правилах.</span></div><div className="preset-row">{(["LOW", "NORMAL", "STRICT"] as Preset[]).map((key) => <button key={key} type="button" className={`preset-button ${activePreset === key ? "preset-button--active" : ""}`} disabled={disabled} onClick={() => applyPreset(key)}>{{ LOW: "Мягкий", NORMAL: "Обычный", STRICT: "Строгий" }[key]}</button>)}{activePreset === "CUSTOM" ? <span className="preset-button preset-button--status preset-button--active">Свой</span> : null}</div></div>
      <div className="automod-rule-list">
        {RULES.map((definition) => { const enabled = definition.enabled(settings); const Icon = definition.icon; return <article className={`automod-rule-card ${enabled ? "" : "automod-rule-card--disabled"}`} key={definition.key}><button type="button" className="automod-rule-open" onClick={() => openRule(definition.key)} aria-label={`Настроить: ${definition.title}`}><span className="automod-rule-icon"><Icon size={19} /></span><span className="automod-rule-copy"><strong>{definition.title}</strong><small>{enabled ? ruleSummary(settings, definition.key) : "Выключено"}</small></span><span className="automod-rule-chevron"><ChevronRight size={17} /></span></button><Toggle checked={enabled} disabled={disabled} label={`Включить: ${definition.title}`} onChange={(checked) => setSettings((current) => definition.setEnabled(current, checked))} /></article>; })}
        <article className={`automod-rule-card ${settings.autoEscalationEnabled ? "" : "automod-rule-card--disabled"}`}><button type="button" className="automod-rule-open" onClick={() => openRule("ESCALATION")} aria-label="Настроить автоматическую эскалацию"><span className="automod-rule-icon"><TimerReset size={19} /></span><span className="automod-rule-copy"><strong>Автоматическая эскалация</strong><small>{settings.autoEscalationEnabled ? `${settings.escalationRules.length} уровней · история ${settings.warningExpiryDays ? `${settings.warningExpiryDays} дн.` : "без срока"}` : "Выключено"}</small></span><span className="automod-rule-chevron"><ChevronRight size={17} /></span></button><Toggle checked={settings.autoEscalationEnabled} disabled={disabled} label="Включить автоматическую эскалацию" onChange={(checked) => setSettings((current) => ({ ...current, autoEscalationEnabled: checked }))} /></article>
      </div>
      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}{success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? <div className="automod-actions"><button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить правила"}</button></div> : null}
    </div>
    {activeRule && draft ? <RuleModal activeRule={activeRule} draft={draft} disabled={disabled} canEdit={canEdit} close={closeModal} apply={applyModal} updateDraft={updateDraft} updateAction={updateDraftAction} /> : null}
  </section>;
}

type ModalFieldsProps = { draft: ModerationSettingsValue; disabled: boolean; updateDraft: (patch: Partial<ModerationSettingsValue>) => void };
function RuleModal({ activeRule, draft, disabled, canEdit, close, apply, updateDraft, updateAction }: { activeRule: EditableRule; draft: ModerationSettingsValue; disabled: boolean; canEdit: boolean; close: () => void; apply: () => void; updateDraft: ModalFieldsProps["updateDraft"]; updateAction: (rule: AutomodActionRule, patch: Partial<AutomodRuleActionValue>) => void }) {
  return <div className="automod-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className="automod-modal" role="dialog" aria-modal="true" aria-labelledby="automod-modal-title"><div className="automod-modal-header"><div className="automod-modal-heading"><span><SlidersHorizontal size={19} /></span><div><h3 id="automod-modal-title">{activeRule === "ESCALATION" ? "Автоматическая эскалация" : RULES.find((rule) => rule.key === activeRule)?.title}</h3><p>{activeRule === "ESCALATION" ? "Общая цепочка после Warn от правил Automod." : ruleSummary(draft, activeRule)}</p></div></div><button type="button" className="icon-button" aria-label="Закрыть" onClick={close}><X size={18} /></button></div><div className="automod-modal-body">
    {activeRule === "LINK" ? <LinkRuleFields draft={draft} disabled={disabled} updateDraft={updateDraft} /> : null}{activeRule === "TERM" ? <TermsRuleFields draft={draft} disabled={disabled} updateDraft={updateDraft} /> : null}{activeRule === "SPAM" ? <SpamRuleFields draft={draft} disabled={disabled} updateDraft={updateDraft} /> : null}{activeRule === "DUPLICATE" ? <DuplicateRuleFields draft={draft} disabled={disabled} updateDraft={updateDraft} /> : null}{activeRule === "MENTIONS" ? <MentionsRuleFields draft={draft} disabled={disabled} updateDraft={updateDraft} /> : null}
    {activeRule !== "ESCALATION" ? <RuleOutcomeFields rule={activeRule} draft={draft} disabled={disabled} updateAction={updateAction} /> : <EscalationFields draft={draft} disabled={disabled} updateDraft={updateDraft} />}
  </div><div className="automod-modal-footer"><button type="button" className="button" onClick={close}>Отмена</button>{canEdit ? <button type="button" className="button button--primary" onClick={apply}>Применить</button> : null}</div></div></div>;
}

function LinkRuleFields({ draft, disabled, updateDraft }: ModalFieldsProps) {
  const listMode = draft.linkProtectionMode === "WHITELIST_ONLY" || draft.linkProtectionMode === "BLACKLIST_ONLY";
  const values = draft.linkProtectionMode === "WHITELIST_ONLY" ? draft.allowedDomains : draft.blockedDomains;
  return <div className="automod-modal-trigger-fields"><label className="automod-field"><span>Режим</span><select value={draft.linkProtectionMode} disabled={disabled} onChange={(event) => updateDraft({ linkProtectionMode: event.target.value as LinkProtectionMode })}>{LINK_PROTECTION_MODES.map((mode) => <option key={mode} value={mode}>{LINK_MODE_LABELS[mode]}</option>)}</select></label>{listMode ? <label className="automod-field automod-field--full-row"><span>{draft.linkProtectionMode === "WHITELIST_ONLY" ? "Разрешённые домены" : "Запрещённые домены"}</span><textarea rows={4} value={values.join("\n")} disabled={disabled} onChange={(event) => updateDraft(draft.linkProtectionMode === "WHITELIST_ONLY" ? { allowedDomains: splitDraftLines(event.target.value) } : { blockedDomains: splitDraftLines(event.target.value) })} placeholder={"example.com\nt.me/modera"} /><small>По одному домену на строку.</small></label> : null}</div>;
}
function TermsRuleFields({ draft, disabled, updateDraft }: ModalFieldsProps) { return <div className="automod-modal-trigger-fields"><label className="automod-field automod-field--full-row"><span>Запрещённые выражения</span><textarea rows={6} value={draft.blockedTerms.join("\n")} disabled={disabled} onChange={(event) => updateDraft({ blockedTerms: splitDraftLines(event.target.value) })} placeholder={"рекламная фраза\nзапрещённое слово"} /><small>Одно слово или фраза на строку. До 200 выражений.</small></label></div>; }
function SpamRuleFields({ draft, disabled, updateDraft }: ModalFieldsProps) { return <div className="automod-modal-trigger-fields automod-modal-trigger-fields--two"><label className="automod-field"><span>Окно, секунд</span><input type="number" min={3} max={120} value={draft.spamWindowSeconds} disabled={disabled} onChange={(event) => updateDraft({ spamWindowSeconds: Number(event.target.value) })} /></label><label className="automod-field"><span>Сообщений разрешено</span><input type="number" min={2} max={50} value={draft.spamMaxMessages} disabled={disabled} onChange={(event) => updateDraft({ spamMaxMessages: Number(event.target.value) })} /></label></div>; }
function DuplicateRuleFields({ draft, disabled, updateDraft }: ModalFieldsProps) { return <div className="automod-modal-trigger-fields automod-modal-trigger-fields--two"><label className="automod-field"><span>Окно, секунд</span><input type="number" min={5} max={3600} value={draft.duplicateWindowSeconds} disabled={disabled} onChange={(event) => updateDraft({ duplicateWindowSeconds: Number(event.target.value) })} /></label><label className="automod-field"><span>Одинаковых разрешено</span><input type="number" min={1} max={20} value={draft.duplicateMaxMessages} disabled={disabled} onChange={(event) => updateDraft({ duplicateMaxMessages: Number(event.target.value) })} /></label></div>; }
function MentionsRuleFields({ draft, disabled, updateDraft }: ModalFieldsProps) { return <div className="automod-modal-trigger-fields"><label className="automod-field"><span>Максимум упоминаний</span><input type="number" min={1} max={50} value={draft.maxMentions} disabled={disabled} onChange={(event) => updateDraft({ maxMentions: Number(event.target.value) })} /></label></div>; }

function RuleOutcomeFields({ rule, draft, disabled, updateAction }: { rule: AutomodActionRule; draft: ModerationSettingsValue; disabled: boolean; updateAction: (rule: AutomodActionRule, patch: Partial<AutomodRuleActionValue>) => void }) {
  const action = actionFor(draft, rule);
  return <div className="automod-outcome-stack"><BinarySetting title="Удалять сообщение" description={action.deleteMessage ? "Нарушение будет удалено из чата." : "Сообщение останется в чате."} checked={action.deleteMessage} disabled={disabled} onChange={(checked) => updateAction(rule, { deleteMessage: checked })} /><div className="automod-conditional-block"><BinarySetting title="Выдать наказание" description={!action.punishmentEnabled ? "Наказание не применяется." : action.punishmentAction === "WARN" ? "Пользователь получит +1 Warn." : `Пользователь получит Mute на ${durationLabel(action.muteDurationMinutes)}.`} checked={action.punishmentEnabled} disabled={disabled} onChange={(checked) => updateAction(rule, { punishmentEnabled: checked })} />{action.punishmentEnabled ? <div className="automod-conditional-grid"><label className="automod-field"><span>Тип наказания</span><select value={action.punishmentAction} disabled={disabled} onChange={(event) => updateAction(rule, { punishmentAction: event.target.value as "WARN" | "MUTE" })}><option value="WARN">Warn</option><option value="MUTE">Mute</option></select></label>{action.punishmentAction === "MUTE" ? <label className="automod-field"><span>Срок наказания</span><select value={action.muteDurationMinutes} disabled={disabled} onChange={(event) => updateAction(rule, { muteDurationMinutes: Number(event.target.value) })}>{MUTE_DURATIONS.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}</select></label> : null}</div> : null}</div><div className="automod-conditional-block"><BinarySetting title="Отправлять сообщение при срабатывании" description={action.notifyEnabled ? "Modera отправит указанный ниже текст." : "Дополнительное сообщение не отправляется."} checked={action.notifyEnabled} disabled={disabled} onChange={(checked) => updateAction(rule, { notifyEnabled: checked })} />{action.notifyEnabled ? <label className="automod-field automod-message-editor"><span>Текст сообщения</span><textarea rows={5} value={action.notifyText} disabled={disabled} onChange={(event) => updateAction(rule, { notifyText: event.target.value })} placeholder="Введите текст сообщения…" /><small>Поле пустое по умолчанию. Доступны переменные %target% и %chat%.</small></label> : null}</div></div>;
}

function EscalationFields({ draft, disabled, updateDraft }: ModalFieldsProps) {
  const updateRule = (index: number, patch: Partial<EscalationRuleValue>) => updateDraft({ escalationRules: draft.escalationRules.map((rule, position) => position === index ? { ...rule, ...patch } : rule) });
  const moveRule = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= draft.escalationRules.length) return; const next = [...draft.escalationRules]; [next[index], next[target]] = [next[target], next[index]]; updateDraft({ escalationRules: renumber(next) }); };
  return <div className="automod-escalation-editor"><p className="automod-modal-note">Warn от правил попадает в общую историю. При достижении порога выполняется указанное действие.</p><div className="automod-escalation-list">{draft.escalationRules.map((rule, index) => <div className="automod-escalation-row" key={`${rule.order}-${index}`}><label className="automod-field"><span>Порог Warn</span><input type="number" min={1} max={999} value={rule.thresholdWarnings} disabled={disabled} onChange={(event) => updateRule(index, { thresholdWarnings: Number(event.target.value) })} /></label><label className="automod-field"><span>Действие</span><select value={rule.action} disabled={disabled} onChange={(event) => { const action = event.target.value as "MUTE" | "BAN"; updateRule(index, { action, durationMinutes: action === "MUTE" ? (rule.durationMinutes ?? 60) : rule.durationMinutes }); }}><option value="MUTE">Mute</option><option value="BAN">Ban</option></select></label><label className="automod-field"><span>Срок, минут</span><input type="number" min={1} max={rule.action === "MUTE" ? 10080 : 527040} value={rule.durationMinutes ?? ""} disabled={disabled} placeholder="Навсегда" onChange={(event) => updateRule(index, { durationMinutes: event.target.value ? Number(event.target.value) : null })} /></label><div className="automod-escalation-actions"><button type="button" className="icon-button" disabled={disabled || index === 0} onClick={() => moveRule(index, -1)} aria-label="Переместить выше"><ArrowUp size={15} /></button><button type="button" className="icon-button" disabled={disabled || index === draft.escalationRules.length - 1} onClick={() => moveRule(index, 1)} aria-label="Переместить ниже"><ArrowDown size={15} /></button><button type="button" className="icon-button icon-button--danger" disabled={disabled} onClick={() => updateDraft({ escalationRules: renumber(draft.escalationRules.filter((_, position) => position !== index)) })} aria-label="Удалить уровень"><Trash2 size={15} /></button></div></div>)}</div><button type="button" className="button button--secondary automod-add-level" disabled={disabled} onClick={() => updateDraft({ escalationRules: renumber([...draft.escalationRules, { order: 0, thresholdWarnings: 3, action: "MUTE", durationMinutes: 60 }]) })}><Plus size={15} />Добавить уровень</button><label className="automod-field automod-field--compact"><span>Срок истории предупреждений, дней</span><input type="number" min={0} max={3650} value={draft.warningExpiryDays} disabled={disabled} onChange={(event) => updateDraft({ warningExpiryDays: Number(event.target.value) })} /><small>0 — хранить без ограничения срока.</small></label><BinarySetting title="Сообщать о срабатывании цепочки" description="Публикует системное сообщение после Mute или Ban по порогу Warn." checked={draft.announceEscalationEnabled} disabled={disabled} onChange={(checked) => updateDraft({ announceEscalationEnabled: checked })} /></div>;
}

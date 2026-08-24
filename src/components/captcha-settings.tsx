"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { FormattedTextarea } from "@/components/formatted-textarea";

export type CaptchaSettingsValue = { enabled: boolean; challengeMessageTemplate: string; challengeButtonText: string; deleteAfterVerification: boolean };
type Props = { chatId: string; initial: CaptchaSettingsValue; canEdit: boolean; botCanRestrictMembers?: boolean; onSaved?: (saved: CaptchaSettingsValue) => void };

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <button type="button" className={`switch ${checked ? "switch--on" : ""}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span className="switch-thumb" /></button>;
}
function BinarySetting({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <div className="automod-binary-setting"><div><strong>{title}</strong><span>{description}</span></div><Toggle checked={checked} disabled={disabled} label={title} onChange={onChange} /></div>;
}

export function CaptchaSettings({ chatId, initial, canEdit, botCanRestrictMembers = true, onSaved }: Props) {
  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState<CaptchaSettingsValue | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const disabled = !canEdit || saving;

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) closeModal(); };
    document.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", close); };
  }, [open, saving]);

  function openModal(next = settings) { setDraft(structuredClone(next)); setOpen(true); setError(null); }
  function closeModal() { setOpen(false); setDraft(null); }
  function toggle(checked: boolean) { const next = { ...settings, enabled: checked }; setSettings(next); if (checked) openModal(next); else void save(next); }
  async function save(next: CaptchaSettingsValue, closeAfter = false) {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/captcha`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки капчи.");
      const saved = payload.data as CaptchaSettingsValue;
      setSettings(saved); setSuccess("Настройки капчи сохранены."); onSaved?.(saved); if (closeAfter) closeModal();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки капчи."); }
    finally { setSaving(false); }
  }

  return <div className="automod-settings new-user-settings">
    {settings.enabled && !botCanRestrictMembers ? <div className="moderation-notice"><ShieldCheck size={16} /><span>Капча включена, но у бота нет права ограничивать участников.</span></div> : null}
    <article className={`automod-rule-card ${settings.enabled ? "" : "automod-rule-card--disabled"}`}><button type="button" className="automod-rule-open" onClick={() => openModal()}><span className="automod-rule-icon"><ShieldCheck size={19} /></span><span className="automod-rule-copy"><strong>Капча при вступлении</strong><small>{settings.enabled ? `Кнопка «${settings.challengeButtonText}»${settings.deleteAfterVerification ? " · удаляется после прохождения" : ""}` : "Выключено"}</small></span><span className="automod-rule-chevron"><ChevronRight size={17} /></span></button><Toggle checked={settings.enabled} disabled={disabled} label="Капча при вступлении" onChange={toggle} /></article>
    {error && !open ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}{success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
    {open && draft ? <div className="automod-modal-backdrop" role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) closeModal(); }}><div className="automod-modal" role="dialog" aria-modal="true" aria-labelledby="captcha-modal-title"><div className="automod-modal-header"><div className="automod-modal-heading"><span><SlidersHorizontal size={19} /></span><div><h3 id="captcha-modal-title">Капча при вступлении</h3><p>Новый участник не сможет писать, пока не нажмёт кнопку.</p></div></div><button className="icon-button" type="button" aria-label="Закрыть" disabled={saving} onClick={closeModal}><X size={18} /></button></div><div className="automod-modal-body"><div className="automod-outcome-stack">
      <BinarySetting title="Включить капчу" description="Проверка применяется к новым участникам супергруппы." checked={draft.enabled} disabled={disabled} onChange={(checked) => setDraft((current) => current ? { ...current, enabled: checked } : current)} />
      <label className="automod-field"><span>Текст капчи</span><FormattedTextarea rows={7} maxLength={1000} value={draft.challengeMessageTemplate} disabled={disabled} onChange={(value) => setDraft((current) => current ? { ...current, challengeMessageTemplate: value } : current)} /></label>
      <label className="automod-field"><span>Текст кнопки</span><input value={draft.challengeButtonText} maxLength={64} disabled={disabled} onChange={(event) => setDraft((current) => current ? { ...current, challengeButtonText: event.target.value } : current)} placeholder="✅ Я не бот" /></label>
      <BinarySetting title="Удалять капчу после прохождения" description={draft.deleteAfterVerification ? "Сообщение исчезнет сразу после успешной проверки." : "Пройденная капча останется видна участнику."} checked={draft.deleteAfterVerification} disabled={disabled} onChange={(checked) => setDraft((current) => current ? { ...current, deleteAfterVerification: checked } : current)} />
      <p className="automod-modal-note">Если участник не пройдёт проверку, Modera исключит его при следующей ежедневной проверке. Он сможет вступить снова.</p>
    </div>{error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}</div><div className="automod-modal-footer"><button type="button" className="button" disabled={saving} onClick={closeModal}>Отмена</button>{canEdit ? <button type="button" className="button button--primary" disabled={saving} onClick={() => void save(draft, true)}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить"}</button> : null}</div></div></div> : null}
  </div>;
}

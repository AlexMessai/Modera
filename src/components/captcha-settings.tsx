"use client";

import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const disabled = !canEdit || saving;

  function toggle(checked: boolean) { const next = { ...settings, enabled: checked }; setSettings(next); void save(next); }
  async function save(next: CaptchaSettingsValue) {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/captcha`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки капчи.");
      const saved = payload.data as CaptchaSettingsValue;
      setSettings(saved); setSuccess("Настройки капчи сохранены."); onSaved?.(saved);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки капчи."); }
    finally { setSaving(false); }
  }

  return <div className="automod-settings new-user-settings">
    {settings.enabled && !botCanRestrictMembers ? <div className="moderation-notice"><ShieldCheck size={16} /><span>Капча включена, но у бота нет права ограничивать участников.</span></div> : null}
    <article className={`automod-rule-card ${settings.enabled ? "" : "automod-rule-card--disabled"}`}><div className="automod-rule-open"><span className="automod-rule-icon"><ShieldCheck size={19} /></span><span className="automod-rule-copy"><strong>Капча при вступлении</strong><small>{settings.enabled ? `Кнопка «${settings.challengeButtonText}»${settings.deleteAfterVerification ? " · удаляется после прохождения" : ""}` : "Выключено"}</small></span></div><Toggle checked={settings.enabled} disabled={disabled} label="Капча при вступлении" onChange={toggle} /></article>
    {settings.enabled ? <div className="new-user-inline-settings"><div className="automod-outcome-stack">
      <label className="automod-field"><span>Текст капчи</span><FormattedTextarea rows={7} maxLength={1000} value={settings.challengeMessageTemplate} disabled={disabled} onChange={(value) => setSettings((current) => ({ ...current, challengeMessageTemplate: value }))} /></label>
      <label className="automod-field"><span>Текст кнопки</span><input value={settings.challengeButtonText} maxLength={64} disabled={disabled} onChange={(event) => setSettings((current) => ({ ...current, challengeButtonText: event.target.value }))} placeholder="✅ Я не бот" /></label>
      <BinarySetting title="Удалять капчу после прохождения" description={settings.deleteAfterVerification ? "Сообщение исчезнет сразу после успешной проверки." : "Пройденная капча останется видна участнику."} checked={settings.deleteAfterVerification} disabled={disabled} onChange={(checked) => setSettings((current) => ({ ...current, deleteAfterVerification: checked }))} />
      <p className="automod-modal-note">Если участник не пройдёт проверку, Modera исключит его при следующей ежедневной проверке. Он сможет вступить снова.</p>
    </div>{canEdit ? <div className="automod-actions"><button type="button" className="button button--primary" disabled={saving} onClick={() => void save(settings)}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить капчу"}</button></div> : null}</div> : null}
    {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}{success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
  </div>;
}

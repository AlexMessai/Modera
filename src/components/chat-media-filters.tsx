"use client";

import { useState } from "react";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { SettingsRow, ConditionalSettingsSection } from "@/components/settings-row";
import {
  MEDIA_FILTER_LABELS,
  MEDIA_FILTER_ORDER,
  type MediaFilterRuleValue,
  type MediaFilterType,
  type ModerationSettingsValue
} from "@/components/chat-moderation-settings";

type Props = {
  chatId: string;
  initial: ModerationSettingsValue;
  canEdit: boolean;
  botCanDeleteMessages?: boolean;
  botCanRestrictMembers?: boolean;
  onSaved?: (saved: ModerationSettingsValue) => void;
};

/**
 * "Фильтры" -- per-content-type rules (all 12 restrictable types), split out
 * of ChatModerationSettings into its own tab. Round-trips the *entire*
 * ModerationSettingsValue through PATCH /api/chats/[id]/moderation (same
 * save mechanics as ChatModerationSettings.save()) so saving here never
 * clobbers the rest of the chat's automod settings.
 */
export function ChatMediaFilters({
  chatId,
  initial,
  canEdit,
  botCanDeleteMessages = true,
  botCanRestrictMembers = true,
  onSaved
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fieldsDisabled = !canEdit || saving;
  const anyFilterEnabled = settings.mediaFilters.some((rule) => rule.enabled);

  function updateMediaFilter(type: MediaFilterType, patch: Partial<MediaFilterRuleValue>) {
    setSettings((current) => ({
      ...current,
      mediaFilters: current.mediaFilters.map((rule) => (rule.type === type ? { ...rule, ...patch } : rule))
    }));
  }

  async function save() {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/moderation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить фильтры.");

      const saved = payload.data as ModerationSettingsValue;
      setSettings(saved);
      setSuccess("Фильтры сохранены и применяются к новым Telegram-событиям.");
      onSaved?.(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить фильтры.");
    } finally { setSaving(false); }
  }

  return (
    <div className="automod-settings">
      {!botCanDeleteMessages && anyFilterEnabled ? <div className="moderation-notice"><TriangleAlert size={16} /><span>По последней проверке у бота нет права удаления сообщений. Telegram будет отклонять автоматические удаления до выдачи права.</span></div> : null}
      {!canEdit ? <div className="moderation-readonly"><ShieldCheck size={18} /><div><strong>Только просмотр</strong><p>Изменять правила чата могут OWNER и ADMIN.</p></div></div> : null}

      <div className="automod-rule-heading"><strong>Фильтры</strong><small>Для каждого типа контента отдельно от общих настроек: можно решить, участвует ли он в предупреждениях/автонаказаниях, и отправлять ли сообщение при срабатывании.</small></div>
      {MEDIA_FILTER_ORDER.map((type) => {
        const rule = settings.mediaFilters.find((item) => item.type === type);
        if (!rule) return null;
        return (
          <div className="automod-rule" key={type}>
            <SettingsRow
              title={MEDIA_FILTER_LABELS[type]}
              description="Удалять сообщения этого типа."
              checked={rule.enabled}
              disabled={fieldsDisabled}
              onChange={(checked) => updateMediaFilter(type, { enabled: checked })}
            />
            <ConditionalSettingsSection visible={rule.enabled}>
              <SettingsRow
                title="Выдавать предупреждение нарушителю"
                description="Засчитывается в общий счётчик предупреждений и автонаказаний чата (нужно также включить «Автоматические наказания» в Automod)."
                checked={rule.warnOnTrigger}
                disabled={fieldsDisabled}
                onChange={(checked) => updateMediaFilter(type, { warnOnTrigger: checked })}
              />
              <SettingsRow
                title="Отправлять сообщение при срабатывании"
                description="Публикует текст ниже в чат сразу при удалении — независимо от предупреждения."
                checked={rule.notifyEnabled}
                disabled={fieldsDisabled}
                onChange={(checked) => updateMediaFilter(type, { notifyEnabled: checked })}
              />
              {rule.notifyEnabled ? <small className="hint-note">Текст сообщения редактируется в Система → Уведомления.</small> : null}
            </ConditionalSettingsSection>
          </div>
        );
      })}

      {settings.autoEscalationEnabled && !botCanRestrictMembers ? <div className="moderation-notice"><TriangleAlert size={16} /><span>Автонаказания включены, но у бота нет права ограничивать участников. Предупреждения сохранятся, а mute/ban будут завершаться ошибкой до выдачи права.</span></div> : null}

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? <div className="automod-actions"><button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить фильтры"}</button></div> : null}
    </div>
  );
}

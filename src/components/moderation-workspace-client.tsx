"use client";

import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { ModuleCard } from "@/components/module-card";
import { ChatModerationSettings, type ModerationSettingsValue } from "@/components/chat-moderation-settings";
import { CaptchaSettings, type CaptchaSettingsValue } from "@/components/captcha-settings";
import { ManualModerationSettings, type ManualModerationSettingsValue, type ManualModerationVisibilitySettingsValue } from "@/components/manual-moderation-settings";
import { AntiRaidSettings, type AntiRaidSettingsValue } from "@/components/anti-raid-settings";
import { ReportSettings, type ReportSettingsValue } from "@/components/report-settings";
import { ContentSettings, type ContentSettingsValue } from "@/components/content-settings";

type Props = {
  automodInitial: ModerationSettingsValue;
  captchaInitial: CaptchaSettingsValue;
  manualModerationInitial: ManualModerationSettingsValue;
  manualModerationVisibilityInitial: ManualModerationVisibilitySettingsValue;
  antiRaidInitial: AntiRaidSettingsValue;
  reportInitial: ReportSettingsValue;
  contentInitial: ContentSettingsValue;
  canEdit: boolean;
};

type ModuleKey = "automod" | "captcha" | "manual" | "antiRaid" | "reports" | "content";

const AUTOMOD_RULE_COUNT = 7;

function countAutomodRulesOn(settings: ModerationSettingsValue) {
  return [
    settings.linkProtectionMode !== "ALLOW_ALL",
    settings.spamEnabled,
    settings.blockedTermsEnabled,
    settings.massMentionsEnabled,
    settings.duplicateEnabled,
    settings.blockedMessageTypes.length > 0,
    settings.autoEscalationEnabled
  ].filter(Boolean).length;
}

export function ModerationWorkspace({ automodInitial, captchaInitial, manualModerationInitial, manualModerationVisibilityInitial, antiRaidInitial, reportInitial, contentInitial, canEdit }: Props) {
  const [automod, setAutomod] = useState(automodInitial);
  const [captcha, setCaptcha] = useState(captchaInitial);
  const [manualModeration, setManualModeration] = useState(manualModerationInitial);
  const [manualModerationVisibility, setManualModerationVisibility] = useState(manualModerationVisibilityInitial);
  const [antiRaid, setAntiRaid] = useState(antiRaidInitial);
  const [reportSettings, setReportSettings] = useState(reportInitial);
  const [content, setContent] = useState(contentInitial);
  const [openModal, setOpenModal] = useState<ModuleKey | null>(null);
  const [togglingCaptcha, setTogglingCaptcha] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  async function toggleCaptcha() {
    setTogglingCaptcha(true);
    setToggleError(null);
    try {
      const response = await fetch("/api/captcha/global", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...captcha, enabled: !captcha.enabled })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось изменить капчу.");
      setCaptcha(payload.data as CaptchaSettingsValue);
    } catch (caught) {
      setToggleError(caught instanceof Error ? caught.message : "Не удалось изменить капчу.");
    } finally {
      setTogglingCaptcha(false);
    }
  }

  const automodRulesOn = countAutomodRulesOn(automod);

  function closeModal() {
    setOpenModal(null);
  }

  return (
    <div className="moderation-workspace">
      <div className="module-card-grid">
        <ModuleCard
          icon={<ShieldCheck size={18} />}
          title="Automod"
          description="Ссылки, запрещённые слова, флуд, повторы, упоминания, медиа и автонаказания за нарушения."
          tag="Модерация_сообщений"
          status={`${automodRulesOn} из ${AUTOMOD_RULE_COUNT} правил активно`}
          onConfigure={() => setOpenModal("automod")}
        />
        <ModuleCard
          icon={<ShieldCheck size={18} />}
          title="Капча"
          description="Новый участник подтверждает, что не бот, прежде чем сможет писать в чат."
          tag="Модерация_участников"
          status={captcha.enabled ? "Включена" : "Выключена"}
          onConfigure={() => setOpenModal("captcha")}
          toggle={canEdit ? { enabled: captcha.enabled, busy: togglingCaptcha, onToggle: () => void toggleCaptcha() } : undefined}
        />
        <ModuleCard
          icon={<ShieldCheck size={18} />}
          title="Ручная модерация"
          description="Тексты ответов бота и удаление сообщений для команд /warn /mute /ban /unban в чатах."
          tag="Команды_модерации"
          status="Настраивается"
          onConfigure={() => setOpenModal("manual")}
        />
        <ModuleCard
          icon={<ShieldCheck size={18} />}
          title="Anti-Raid"
          description="Защита от массового вступления ботов: усиливает капчу, пока наплыв новых участников не прекратится."
          tag="Модерация_участников"
          status={antiRaid.enabled ? "Включена" : "Выключена"}
          onConfigure={() => setOpenModal("antiRaid")}
        />
        <ModuleCard
          icon={<ShieldCheck size={18} />}
          title="Жалобы"
          description="Команда /report: участники жалуются на сообщение, администраторы получают приватную карточку с кнопками действий."
          tag="Модерация_сообщений"
          status={reportSettings.enabled ? "Включены" : "Выключены"}
          onConfigure={() => setOpenModal("reports")}
        />
        <ModuleCard
          icon={<ShieldCheck size={18} />}
          title="Приветствие и правила"
          description="Текст приветствия новым участникам и правила чата по команде /rules."
          tag="Чат"
          status={content.welcomeEnabled ? "Приветствие включено" : "Приветствие выключено"}
          onConfigure={() => setOpenModal("content")}
        />
      </div>

      {toggleError ? <div className="moderation-feedback moderation-feedback--error">{toggleError}</div> : null}

      {openModal ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeModal(); }}>
          <div className="dialog-card module-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="module-settings-title">
            <div className="dialog-header">
              <div>
                <span className="eyebrow">Глобальная политика</span>
                <h2 id="module-settings-title">
                  {openModal === "automod" ? "Automod" : openModal === "captcha" ? "Капча при вступлении" : openModal === "manual" ? "Ручная модерация" : openModal === "antiRaid" ? "Anti-Raid" : openModal === "reports" ? "Жалобы" : "Приветствие и правила"}
                </h2>
              </div>
              <button className="icon-button" type="button" aria-label="Закрыть" onClick={closeModal}><X size={18} /></button>
            </div>
            <div className="module-settings-dialog-body">
              {openModal === "automod" ? <ChatModerationSettings scope="global" initial={automod} canEdit={canEdit} onSaved={setAutomod} /> : null}
              {openModal === "captcha" ? <CaptchaSettings scope="global" initial={captcha} canEdit={canEdit} onSaved={setCaptcha} /> : null}
              {openModal === "manual" ? (
                <ManualModerationSettings
                  scope="global"
                  initial={manualModeration}
                  visibility={manualModerationVisibility}
                  canEdit={canEdit}
                  onSaved={setManualModeration}
                  onVisibilitySaved={setManualModerationVisibility}
                />
              ) : null}
              {openModal === "antiRaid" ? <AntiRaidSettings scope="global" initial={antiRaid} canEdit={canEdit} onSaved={setAntiRaid} /> : null}
              {openModal === "reports" ? <ReportSettings scope="global" initial={reportSettings} canEdit={canEdit} onSaved={setReportSettings} /> : null}
              {openModal === "content" ? <ContentSettings scope="global" initial={content} canEdit={canEdit} onSaved={setContent} /> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

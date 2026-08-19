"use client";

import { useState } from "react";
import { ShieldAlert, ShieldCheck, X } from "lucide-react";
import { ModuleCard } from "@/components/module-card";
import { ChatModerationSettings, type ModerationSettingsValue } from "@/components/chat-moderation-settings";
import { CaptchaSettings, type CaptchaSettingsValue } from "@/components/captcha-settings";
import { AntiRaidSettings, type AntiRaidSettingsValue } from "@/components/anti-raid-settings";

type Props = {
  automodInitial: ModerationSettingsValue;
  captchaInitial: CaptchaSettingsValue;
  antiRaidInitial: AntiRaidSettingsValue;
  canEdit: boolean;
};

type ModuleKey = "automod" | "captcha" | "antiRaid";

const AUTOMOD_RULE_COUNT = 7;

function countAutomodRulesOn(settings: ModerationSettingsValue) {
  return [
    settings.blockLinks,
    settings.spamEnabled,
    settings.blockedTermsEnabled,
    settings.massMentionsEnabled,
    settings.duplicateEnabled,
    settings.blockedMessageTypes.length > 0,
    settings.autoEscalationEnabled
  ].filter(Boolean).length;
}

export function ModerationWorkspace({ automodInitial, captchaInitial, antiRaidInitial, canEdit }: Props) {
  const [automod, setAutomod] = useState(automodInitial);
  const [captcha, setCaptcha] = useState(captchaInitial);
  const [antiRaid, setAntiRaid] = useState(antiRaidInitial);
  const [openModal, setOpenModal] = useState<ModuleKey | null>(null);
  const [togglingCaptcha, setTogglingCaptcha] = useState(false);
  const [togglingAntiRaid, setTogglingAntiRaid] = useState(false);
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

  async function toggleAntiRaid() {
    setTogglingAntiRaid(true);
    setToggleError(null);
    try {
      const response = await fetch("/api/anti-raid/global", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...antiRaid, enabled: !antiRaid.enabled })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось изменить Anti-Raid.");
      setAntiRaid(payload.data as AntiRaidSettingsValue);
    } catch (caught) {
      setToggleError(caught instanceof Error ? caught.message : "Не удалось изменить Anti-Raid.");
    } finally {
      setTogglingAntiRaid(false);
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
          icon={<ShieldAlert size={18} />}
          title="Anti-Raid"
          description="Защита от массовых вступлений и заявок с автоматической реакцией."
          tag="Модерация_участников"
          status={antiRaid.enabled ? "Включён" : "Выключен"}
          onConfigure={() => setOpenModal("antiRaid")}
          toggle={canEdit ? { enabled: antiRaid.enabled, busy: togglingAntiRaid, onToggle: () => void toggleAntiRaid() } : undefined}
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
                  {openModal === "automod" ? "Automod" : openModal === "captcha" ? "Капча при вступлении" : "Anti-Raid"}
                </h2>
              </div>
              <button className="icon-button" type="button" aria-label="Закрыть" onClick={closeModal}><X size={18} /></button>
            </div>
            <div className="module-settings-dialog-body">
              {openModal === "automod" ? <ChatModerationSettings scope="global" initial={automod} canEdit={canEdit} onSaved={setAutomod} /> : null}
              {openModal === "captcha" ? <CaptchaSettings scope="global" initial={captcha} canEdit={canEdit} onSaved={setCaptcha} /> : null}
              {openModal === "antiRaid" ? <AntiRaidSettings scope="global" initial={antiRaid} canEdit={canEdit} onSaved={setAntiRaid} /> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

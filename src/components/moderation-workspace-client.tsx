"use client";

import { useState } from "react";
import { Globe2, ShieldAlert, ShieldCheck } from "lucide-react";
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

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ModerationWorkspace({ automodInitial, captchaInitial, antiRaidInitial, canEdit }: Props) {
  const [automod, setAutomod] = useState(automodInitial);
  const [captcha, setCaptcha] = useState(captchaInitial);
  const [antiRaid, setAntiRaid] = useState(antiRaidInitial);
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [antiRaidVersion, setAntiRaidVersion] = useState(0);
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
      setCaptchaVersion((v) => v + 1);
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
      setAntiRaidVersion((v) => v + 1);
    } catch (caught) {
      setToggleError(caught instanceof Error ? caught.message : "Не удалось изменить Anti-Raid.");
    } finally {
      setTogglingAntiRaid(false);
    }
  }

  const automodRulesOn = countAutomodRulesOn(automod);

  return (
    <div className="moderation-workspace">
      <div className="module-card-grid">
        <ModuleCard
          icon={<ShieldCheck size={18} />}
          title="Automod"
          description="Ссылки, запрещённые слова, флуд, повторы, упоминания, медиа и автонаказания за нарушения."
          tag="Модерация_сообщений"
          status={`${automodRulesOn} из ${AUTOMOD_RULE_COUNT} правил активно`}
          onConfigure={() => scrollToSection("automod-section")}
        />
        <ModuleCard
          icon={<ShieldCheck size={18} />}
          title="Капча"
          description="Новый участник подтверждает, что не бот, прежде чем сможет писать в чат."
          tag="Модерация_участников"
          status={captcha.enabled ? "Включена" : "Выключена"}
          onConfigure={() => scrollToSection("captcha-section")}
          toggle={canEdit ? { enabled: captcha.enabled, busy: togglingCaptcha, onToggle: () => void toggleCaptcha() } : undefined}
        />
        <ModuleCard
          icon={<ShieldAlert size={18} />}
          title="Anti-Raid"
          description="Защита от массовых вступлений и заявок с автоматической реакцией."
          tag="Модерация_участников"
          status={antiRaid.enabled ? "Включён" : "Выключен"}
          onConfigure={() => scrollToSection("anti-raid-section")}
          toggle={canEdit ? { enabled: antiRaid.enabled, busy: togglingAntiRaid, onToggle: () => void toggleAntiRaid() } : undefined}
        />
      </div>

      {toggleError ? <div className="moderation-feedback moderation-feedback--error">{toggleError}</div> : null}

      <section className="panel profile-section" id="automod-section">
        <div className="panel-header"><div><h2>Глобальная политика</h2><p>Единый набор правил для чатов, которые явно включили наследование. Автонаказания и destructive-правила по умолчанию выключены.</p></div><Globe2 size={19} /></div>
        <ChatModerationSettings scope="global" initial={automod} canEdit={canEdit} onSaved={setAutomod} />
      </section>

      <section className="panel profile-section" id="captcha-section">
        <div className="panel-header"><div><h2>Капча при вступлении</h2><p>Значение по умолчанию для чатов, которые включили наследование глобальной политики.</p></div><ShieldCheck size={19} /></div>
        <CaptchaSettings key={captchaVersion} scope="global" initial={captcha} canEdit={canEdit} onSaved={setCaptcha} />
      </section>

      <section className="panel profile-section" id="anti-raid-section">
        <div className="panel-header"><div><h2>Anti-Raid: глобальная политика</h2><p>Защита от массовых вступлений и заявок. Не применяется к чату, пока он явно не включит наследование.</p></div><ShieldAlert size={19} /></div>
        <AntiRaidSettings key={antiRaidVersion} scope="global" initial={antiRaid} canEdit={canEdit} onSaved={setAntiRaid} />
      </section>
    </div>
  );
}

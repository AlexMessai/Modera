"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Ban, Check, DoorOpen, LockKeyhole, RotateCcw, ShieldAlert, ShieldOff, TriangleAlert, UnlockKeyhole } from "lucide-react";

type ActionName = "warning" | "unwarn" | "mute" | "unmute" | "ban" | "unban" | "kick";
type Props = {
  membershipId: string;
  userDisplayName: string;
  status: string;
  punishmentState: string | null;
  userIsBot: boolean;
  chatType: string;
  adminCanModerate: boolean;
  botStatus: string;
  storedBotCanRestrict: boolean;
  warningCount: number;
};

const ACTIONS: Record<ActionName, { label: string; confirmLabel: string; description: string; requiresReason: boolean; tone: "default" | "danger" }> = {
  warning: { label: "Предупредить", confirmLabel: "Выдать предупреждение", description: "Добавит предупреждение в профиль и журнал модерации.", requiresReason: false, tone: "default" },
  mute: { label: "Mute", confirmLabel: "Ограничить отправку сообщений", description: "Telegram ограничит отправку сообщений на выбранный срок или до ручного снятия mute.", requiresReason: false, tone: "default" },
  unmute: { label: "Снять mute", confirmLabel: "Снять ограничения", description: "Telegram снимет индивидуальные ограничения участника.", requiresReason: false, tone: "default" },
  ban: { label: "Заблокировать", confirmLabel: "Заблокировать участника", description: "Участник будет удалён из чата и не сможет вернуться до разблокировки.", requiresReason: false, tone: "danger" },
  unban: { label: "Разблокировать", confirmLabel: "Разблокировать участника", description: "Пользователь сможет снова вступить в чат, но Telegram не добавит его обратно автоматически.", requiresReason: false, tone: "default" },
  kick: { label: "Кикнуть", confirmLabel: "Исключить из чата", description: "Участник будет удалён из чата без блокировки — сможет вернуться по ссылке-приглашению.", requiresReason: false, tone: "danger" },
  unwarn: { label: "Снять предупреждение", confirmLabel: "Снять предупреждение", description: "Уменьшит счётчик предупреждений участника на одно.", requiresReason: false, tone: "default" }
};

const MUTE_DURATIONS = [
  ["", "Без срока"],
  ["10", "10 минут"],
  ["30", "30 минут"],
  ["60", "1 час"],
  ["360", "6 часов"],
  ["1440", "24 часа"],
  ["10080", "7 дней"]
] as const;

const BAN_DURATIONS = [
  ["", "Навсегда"],
  ["60", "1 час"],
  ["1440", "24 часа"],
  ["10080", "7 дней"],
  ["43200", "30 дней"],
  ["129600", "90 дней"]
] as const;

export function ModerationActions(props: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [muteDuration, setMuteDuration] = useState("");
  const [banDuration, setBanDuration] = useState("");
  const [confirming, setConfirming] = useState<ActionName | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const protectedTarget = props.status === "CREATOR" || props.status === "ADMINISTRATOR";
  const muted = props.status === "RESTRICTED" || props.punishmentState === "MUTED";
  const banned = props.status === "BANNED" || props.punishmentState === "BANNED";
  const visibleActions = useMemo(() => {
    const actions: ActionName[] = ["warning"];
    if (props.warningCount > 0) actions.push("unwarn");
    if (!protectedTarget && !props.userIsBot) {
      if (props.chatType === "supergroup" && !banned) actions.push(muted ? "unmute" : "mute");
      actions.push(banned ? "unban" : "ban");
      if (!banned && props.status !== "LEFT") actions.push("kick");
    }
    return actions;
  }, [banned, muted, protectedTarget, props.chatType, props.status, props.userIsBot, props.warningCount]);

  if (!props.adminCanModerate) return <div className="moderation-readonly"><ShieldAlert size={18} /><div><strong>Только просмотр</strong><p>Ваша роль не позволяет выполнять действия модерации.</p></div></div>;
  if (props.userIsBot) return <div className="moderation-readonly"><ShieldAlert size={18} /><div><strong>Telegram-бот</strong><p>Ручные действия модерации для аккаунтов ботов отключены.</p></div></div>;

  function prepare(action: ActionName) {
    setError(null); setSuccess(null);
    setConfirming(action);
  }

  async function submit(action: ActionName) {
    setSubmitting(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/members/${props.membershipId}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          reason: reason.trim() || undefined,
          ...(action === "mute" ? { muteDurationMinutes: muteDuration ? Number(muteDuration) : null } : {}),
          ...(action === "ban" ? { banDurationMinutes: banDuration ? Number(banDuration) : null } : {})
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось выполнить действие.");
      setSuccess(`${ACTIONS[action].label}: выполнено.`);
      setReason(""); setConfirming(null); router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось выполнить действие.");
    } finally { setSubmitting(false); }
  }

  return (
    <div className="moderation-controls">
      {(!props.storedBotCanRestrict || props.botStatus !== "ACTIVE") && !protectedTarget ? <div className="moderation-notice"><TriangleAlert size={16} /><span>По последней проверке права бота могут быть недостаточны. Перед каждым Telegram-действием Modera проверит их заново.</span></div> : null}
      {protectedTarget ? <div className="moderation-notice"><ShieldAlert size={16} /><span>Telegram-владелец или администратор защищён от mute и ban. Доступно только внутреннее предупреждение.</span></div> : null}

      <label className="moderation-reason"><span>Причина</span><textarea value={reason} onChange={(event) => setReason(event.target.value.slice(0, 500))} placeholder="Например: повторная публикация рекламной ссылки" rows={3} disabled={submitting} /><small>{reason.length} / 500</small></label>

      {visibleActions.includes("mute") ? (
        <label className="automod-field automod-field--short">
          <span>Срок mute</span>
          <select value={muteDuration} onChange={(event) => setMuteDuration(event.target.value)} disabled={submitting}>
            {MUTE_DURATIONS.map(([value, label]) => <option key={value || "forever"} value={value}>{label}</option>)}
          </select>
          <small>Для временного mute Telegram сам снимет restriction по истечении срока.</small>
        </label>
      ) : null}

      {visibleActions.includes("ban") ? (
        <label className="automod-field automod-field--short">
          <span>Срок бана</span>
          <select value={banDuration} onChange={(event) => setBanDuration(event.target.value)} disabled={submitting}>
            {BAN_DURATIONS.map(([value, label]) => <option key={value || "forever"} value={value}>{label}</option>)}
          </select>
          <small>Для временного бана Telegram сам снимет блокировку по истечении срока.</small>
        </label>
      ) : null}

      <div className="moderation-buttons">{visibleActions.map((action) => <button key={action} type="button" className={`button ${ACTIONS[action].tone === "danger" ? "button--danger" : "button--secondary"}`} onClick={() => prepare(action)} disabled={submitting}><ActionIcon action={action} />{ACTIONS[action].label}</button>)}</div>

      {confirming ? (
        <div className={`moderation-confirm ${ACTIONS[confirming].tone === "danger" ? "moderation-confirm--danger" : ""}`}>
          <div><strong>{ACTIONS[confirming].confirmLabel}?</strong><p>{ACTIONS[confirming].description}</p><span>Участник: {props.userDisplayName}{confirming === "mute" && muteDuration ? ` · ${MUTE_DURATIONS.find(([value]) => value === muteDuration)?.[1] ?? "временно"}` : ""}{confirming === "ban" && banDuration ? ` · ${BAN_DURATIONS.find(([value]) => value === banDuration)?.[1] ?? "временно"}` : ""}</span></div>
          <div className="moderation-confirm-actions">
            <button type="button" className="button button--secondary" onClick={() => setConfirming(null)} disabled={submitting}>Отмена</button>
            <button type="button" className={`button ${ACTIONS[confirming].tone === "danger" ? "button--danger" : "button--primary"}`} onClick={() => void submit(confirming)} disabled={submitting}><Check size={16} />{submitting ? "Выполняю…" : "Подтвердить"}</button>
          </div>
        </div>
      ) : null}

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
    </div>
  );
}

function ActionIcon({ action }: { action: ActionName }) {
  switch (action) {
    case "warning": return <TriangleAlert size={16} />;
    case "unwarn": return <ShieldOff size={16} />;
    case "mute": return <LockKeyhole size={16} />;
    case "unmute": return <UnlockKeyhole size={16} />;
    case "ban": return <Ban size={16} />;
    case "unban": return <RotateCcw size={16} />;
    case "kick": return <DoorOpen size={16} />;
  }
}
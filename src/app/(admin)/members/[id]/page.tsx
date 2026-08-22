import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert, UserRound } from "lucide-react";
import { ModerationActions } from "@/components/moderation-actions";
import { CollapsibleList } from "@/components/collapsible-list";
import { MemberTagControl } from "@/components/member-tag-control";
import { MemberMessageHistory } from "@/components/member-message-history";
import { TelegramAvatar } from "@/components/telegram-avatar";
import { memberStatusBadgeClass, memberStatusLabel } from "@/lib/member-status";
import { canModerate } from "@/server/auth/permissions";
import { requireAdminPage } from "@/server/auth/guards";
import { getMemberProfile } from "@/server/services/member-service";
import { getMemberRisk } from "@/server/services/member-risk-service";
import { getModerationContext } from "@/server/services/moderation-context";

export const dynamic = "force-dynamic";

const auditLabels: Record<string, string> = {
  MEMBER_STATUS_CHANGED: "Изменён статус участника",
  MEMBER_JOIN_REQUESTED: "Запрос на вступление",
  MODERATION_WARNING: "Выдано предупреждение",
  MODERATION_UNWARN: "Предупреждение снято",
  MODERATION_MUTE: "Выдан mute",
  MODERATION_UNMUTE: "Mute снят",
  MODERATION_BAN: "Участник заблокирован",
  MODERATION_UNBAN: "Участник разблокирован",
  MODERATION_KICK: "Участник исключён из чата",
  MODERATION_ACTION_FAILED: "Действие модерации не выполнено",
  AUTOMOD_WARNING: "Автоматическое предупреждение",
  AUTOMOD_AUTO_MUTE: "Автоматический mute",
  AUTOMOD_AUTO_BAN: "Автоматическая блокировка",
  AUTOMOD_ESCALATION_FAILED: "Ошибка автоматического наказания",
  TRUSTED_MEMBER_ADDED: "Добавлен в исключения",
  TRUSTED_MEMBER_REMOVED: "Удалён из исключений",
  TELEGRAM_MEMBER_TAG_CHANGED: "Telegram-тег синхронизирован из Telegram",
  TELEGRAM_MEMBER_TAG_REMOVED: "Telegram-тег удалён в Telegram",
  MEMBER_TAG_UPDATED: "Telegram-тег изменён владельцем",
  MEMBER_TAG_REMOVED: "Telegram-тег удалён владельцем",
  MEMBER_TAG_UPDATE_FAILED: "Не удалось изменить Telegram-тег",
  PUNISHMENT_STATE_CONFIRMED: "Состояние наказания подтверждено Telegram",
  PUNISHMENT_STATE_CLEARED: "Telegram снял наказание"
};

const actionLabels: Record<string, string> = {
  WARNING: "Предупреждение",
  MUTE: "Mute",
  UNMUTE: "Снятие mute",
  BAN: "Блокировка",
  UNBAN: "Разблокировка",
  KICK: "Исключение из чата"
};

const actionStatusLabels: Record<string, string> = {
  PENDING: "Требует сверки",
  SUCCEEDED: "Выполнено",
  FAILED: "Ошибка"
};

function actionStatusClass(status: string) {
  if (status === "SUCCEEDED") return "badge--active";
  if (status === "FAILED") return "badge--danger";
  return "badge--warning";
}

export default async function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage();
  const { id } = await params;
  const [member, moderation] = await Promise.all([getMemberProfile(id), getModerationContext(id)]);
  if (!member || !moderation) notFound();
  const risk = await getMemberRisk(id, moderation.activeWarningCount);
  if (!risk) notFound();

  return (
    <main className="page">
      <header className="page-header member-profile-header">
        <div>
          <Link className="back-link" href={`/chats/${member.chat.id}?tab=members`}><ArrowLeft size={15} /> Участники</Link>
          <div className="profile-title-row">
            <TelegramAvatar
              userId={member.user.id}
              displayName={member.user.displayName}
              size={52}
              className="profile-avatar"
            />
            <div>
              <div className="profile-heading-line"><h1>{member.user.displayName}</h1><span className={`badge ${memberStatusBadgeClass(member.status)}`}>{memberStatusLabel(member.status)}</span>{member.user.isPremium ? <span className="badge badge--premium">Telegram Premium</span> : null}</div>
              <p>{member.user.username ? `@${member.user.username}` : member.user.isBot ? "Telegram-бот" : "Username не указан"}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="profile-grid">
        <div className="profile-grid-col">
          <article className="panel profile-panel">
            <div className="panel-header"><div><h2>Профиль Telegram</h2><p>Данные, реально полученные через Telegram Bot API.</p></div></div>
            <dl className="detail-list">
              <Detail label="Telegram ID" value={member.user.telegramUserId} mono />
              <Detail label="Имя" value={member.user.firstName} />
              <Detail label="Фамилия" value={member.user.lastName ?? "—"} />
              <Detail label="Username" value={member.user.username ? `@${member.user.username}` : "—"} />
              <Detail label="Язык" value={member.user.languageCode ?? "—"} />
              <Detail label="Telegram Premium" value={member.user.isPremium ? "Да" : "Нет"} />
              <Detail label="Attachment menu" value={member.user.addedToAttachmentMenu ? "Бот добавлен" : "Нет"} />
              <Detail label="Тип" value={member.user.isBot ? "Бот" : "Пользователь"} />
              <Detail label="Впервые замечен" value={formatDate(member.user.firstSeenAt)} />
              <Detail label="Последняя активность" value={formatDate(member.user.lastSeenAt)} />
              <Detail label="Профиль синхронизирован" value={formatDate(member.user.updatedAt)} />
            </dl>
          </article>

          <MemberMessageHistory
            telegramUserId={member.user.telegramUserId}
            chatId={member.chat.id}
          />
        </div>

        <article className="panel profile-panel">
          <div className="panel-header"><div><h2>В этом чате</h2><p>{member.chat.title}</p></div></div>
          <div className="profile-stat-grid">
            <div><span>Сообщения</span><strong>{member.messageCount.toLocaleString("ru-RU")}</strong></div>
            <div><span>Предупреждения всего</span><strong>{member.warningCount.toLocaleString("ru-RU")}</strong></div>
            <div><span>Активные предупреждения</span><strong>{moderation.activeWarningCount.toLocaleString("ru-RU")}</strong></div>
            <div><span>Нарушения</span><strong>{member.activity.violationCount.toLocaleString("ru-RU")}</strong></div>
            <div><span>Удалённые сообщения</span><strong>{member.activity.deletedMessageCount.toLocaleString("ru-RU")}</strong></div>
          </div>
          <MemberTagControl
            membershipId={member.id}
            initialTag={member.tag}
            initialStatus={member.status}
            telegramCustomTitle={member.telegramCustomTitle}
          />
          <dl className="detail-list detail-list--compact">
            <Detail label="Статус" value={memberStatusLabel(member.status)} />
            <Detail label="Telegram-роль" value={telegramRoleLabel(member.status, member.telegramCustomTitle)} />
            <Detail label="Тег участника" value={member.tag ?? "—"} />
            <Detail label="Telegram ID чата" value={member.chat.telegramChatId} mono />
            <Detail label="Вступил / замечен" value={member.joinedAt ? formatDate(member.joinedAt) : "—"} />
            <Detail label="Последняя активность" value={formatDate(member.lastSeenAt)} />
            <Detail label="Вышел / заблокирован" value={member.leftAt ? formatDate(member.leftAt) : "—"} />
            <Detail label="Ограничение" value={member.punishmentState ?? "Нет"} />
            <Detail label="Срок ограничения" value={moderation.punishmentExpiresAt ? formatDate(moderation.punishmentExpiresAt) : "—"} />
            <Detail label="Срок предупреждений" value={moderation.warningExpiryDays > 0 ? `${moderation.warningExpiryDays} дн.` : "Не сгорают"} />
          </dl>
        </article>
      </section>

      <section className="panel profile-section risk-panel">
        <div className="panel-header">
          <div><h2>Оценка риска</h2><p>Информационная оценка по активности в этом чате. Она сама по себе не запускает наказания.</p></div>
          <div className="risk-score-summary">
            <ShieldAlert size={20} />
            <strong>{risk.score}<span>/100</span></strong>
            <span className={`badge ${riskBadgeClass(risk.level)}`}>{riskLevelLabel(risk.level)}</span>
          </div>
        </div>
        {risk.reasons.length === 0 ? (
          <div className="state-box state-box--compact"><strong>Сигналов риска нет</strong><p>Недавних нарушений, наказаний и рейдовых событий не обнаружено.</p></div>
        ) : (
          <div className="risk-reason-list">
            {risk.reasons.map((reason) => (
              <div className="risk-reason-row" key={reason.code}>
                <div><strong>{reason.label}</strong><span>{reason.detail}</span></div>
                <b>{reason.points > 0 ? `+${reason.points}` : "—"}</b>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel profile-section moderation-panel">
        <div className="panel-header"><div><h2>Действия модерации</h2><p>Перед mute, ban и обратными действиями права бота проверяются в Telegram заново.</p></div></div>
        <ModerationActions
          membershipId={moderation.membershipId}
          userDisplayName={moderation.userDisplayName}
          status={moderation.status}
          punishmentState={moderation.punishmentState}
          userIsBot={moderation.userIsBot}
          chatType={moderation.chatType}
          adminCanModerate={canModerate(admin.role)}
          botStatus={moderation.botStatus}
          storedBotCanRestrict={moderation.storedBotCanRestrict}
        />
      </section>

      <section className="panel profile-section">
        <div className="panel-header"><div><h2>Журнал модерации</h2><p>Ручные и автоматические предупреждения, ограничения, блокировки, ошибки Telegram и PENDING-записи.</p></div></div>
        {moderation.actions.length === 0 ? (
          <div className="state-box state-box--compact"><strong>Действий пока не было</strong><p>Здесь появятся только реальные действия Modera и автомодерации.</p></div>
        ) : (
          <div className="moderation-history">
            <CollapsibleList>
              {moderation.actions.map((action) => (
                <div className="moderation-history-row" key={action.id}>
                  <div>
                    <strong>{actionLabels[action.type] ?? action.type}</strong>
                    <span>{action.actingAdmin?.displayName ?? (action.source === "SYSTEM" ? "Автомодерация" : "Система")} · {formatDate(action.createdAt)}</span>
                  </div>
                  <span className={`badge ${actionStatusClass(action.status)}`}>{actionStatusLabels[action.status] ?? action.status}</span>
                  <div className="moderation-history-reason">
                    <span>{action.reason ?? "Без причины"}{action.expiresAt ? ` · до ${formatDate(action.expiresAt)}` : ""}</span>
                    {action.telegramError ? <small>{action.telegramError}</small> : null}
                  </div>
                </div>
              ))}
            </CollapsibleList>
          </div>
        )}
      </section>

      <section className="panel profile-section">
        <div className="panel-header"><div><h2>Чаты пользователя</h2><p>Все чаты, в которых Modera уже видела этого Telegram-пользователя.</p></div></div>
        <div className="membership-list">
          <CollapsibleList>
            {member.user.memberships.map((membership) => (
              <Link href={`/members/${membership.id}`} className="membership-row" key={membership.id}>
                <span className="membership-icon"><UserRound size={17} /></span>
                <div><strong>{membership.chat.title}</strong><span className="mono">{membership.chat.telegramChatId}{membership.tag ? ` · ${membership.tag}` : ""}</span></div>
                <span className={`badge ${memberStatusBadgeClass(membership.status)}`}>{memberStatusLabel(membership.status)}</span>
                <span>{membership.messageCount.toLocaleString("ru-RU")} сообщений</span>
                <span>{formatDate(membership.lastSeenAt)}</span>
              </Link>
            ))}
          </CollapsibleList>
        </div>
      </section>

      <section className="panel profile-section">
        <div className="panel-header"><div><h2>Журнал событий</h2><p>События Telegram и административные изменения, связанные с пользователем.</p></div></div>
        {member.auditLogs.length === 0 ? (
          <div className="state-box state-box--compact"><strong>Событий пока нет</strong><p>Здесь появятся реальные изменения статуса и действия модерации.</p></div>
        ) : (
          <div className="audit-list">
            <CollapsibleList>
              {member.auditLogs.map((log) => (
                <div className="audit-row" key={log.id}>
                  <span className="audit-dot" />
                  <div><strong>{auditLabels[log.action] ?? log.action}</strong><span>{log.chat?.title ?? "Telegram"}{log.actingAdmin ? ` · ${log.actingAdmin.displayName}` : log.source === "SYSTEM" ? " · Автомодерация" : ""}{log.reason ? ` · ${log.reason}` : ""}</span></div>
                  <time>{formatDate(log.createdAt)}</time>
                </div>
              ))}
            </CollapsibleList>
          </div>
        )}
      </section>
    </main>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><dt>{label}</dt><dd className={mono ? "mono" : undefined}>{value}</dd></div>;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function riskLevelLabel(level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") {
  return ({ LOW: "Низкий", MEDIUM: "Средний", HIGH: "Высокий", CRITICAL: "Критический" })[level];
}

function riskBadgeClass(level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") {
  if (level === "LOW") return "badge--active";
  if (level === "MEDIUM") return "badge--warning";
  return "badge--danger";
}

function telegramRoleLabel(status: string, customTitle: string | null) {
  if (status === "CREATOR") return customTitle ? `Владелец · ${customTitle}` : "Владелец";
  if (status === "ADMINISTRATOR") return customTitle ? `Администратор · ${customTitle}` : "Администратор";
  if (status === "RESTRICTED") return "Ограниченный участник";
  if (status === "BANNED") return "Заблокирован";
  if (status === "LEFT") return "Покинул чат";
  if (status === "PENDING") return "Ожидает вступления";
  return "Участник";
}

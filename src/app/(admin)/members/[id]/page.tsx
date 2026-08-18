import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, UserRound } from "lucide-react";
import {
  memberStatusBadgeClass,
  memberStatusLabel
} from "@/lib/member-status";
import { getMemberProfile } from "@/server/services/member-service";

export const dynamic = "force-dynamic";

const auditLabels: Record<string, string> = {
  MEMBER_STATUS_CHANGED: "Изменён статус участника",
  MEMBER_JOIN_REQUESTED: "Запрос на вступление"
};

export default async function MemberProfilePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const member = await getMemberProfile(id);
  if (!member) notFound();

  return (
    <main className="page">
      <header className="page-header member-profile-header">
        <div>
          <Link className="back-link" href="/members">
            <ArrowLeft size={15} /> Участники
          </Link>
          <div className="profile-title-row">
            <span className="profile-avatar">
              {member.user.isBot ? (
                <Bot size={24} />
              ) : (
                member.user.displayName.slice(0, 1).toUpperCase()
              )}
            </span>
            <div>
              <div className="profile-heading-line">
                <h1>{member.user.displayName}</h1>
                <span className={`badge ${memberStatusBadgeClass(member.status)}`}>
                  {memberStatusLabel(member.status)}
                </span>
              </div>
              <p>
                {member.user.username
                  ? `@${member.user.username}`
                  : member.user.isBot
                    ? "Telegram-бот"
                    : "Username не указан"}
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="profile-grid">
        <article className="panel profile-panel">
          <div className="panel-header">
            <div>
              <h2>Профиль Telegram</h2>
              <p>Данные, реально полученные через Telegram Bot API.</p>
            </div>
          </div>
          <dl className="detail-list">
            <Detail label="Telegram ID" value={member.user.telegramUserId} mono />
            <Detail label="Имя" value={member.user.firstName} />
            <Detail label="Фамилия" value={member.user.lastName ?? "—"} />
            <Detail
              label="Username"
              value={member.user.username ? `@${member.user.username}` : "—"}
            />
            <Detail label="Язык" value={member.user.languageCode ?? "—"} />
            <Detail label="Тип" value={member.user.isBot ? "Бот" : "Пользователь"} />
            <Detail label="Впервые замечен" value={formatDate(member.user.firstSeenAt)} />
            <Detail label="Последняя активность" value={formatDate(member.user.lastSeenAt)} />
          </dl>
        </article>

        <article className="panel profile-panel">
          <div className="panel-header">
            <div>
              <h2>В этом чате</h2>
              <p>{member.chat.title}</p>
            </div>
          </div>
          <div className="profile-stat-grid">
            <div>
              <span>Сообщения</span>
              <strong>{member.messageCount.toLocaleString("ru-RU")}</strong>
            </div>
            <div>
              <span>Предупреждения</span>
              <strong>{member.warningCount.toLocaleString("ru-RU")}</strong>
            </div>
          </div>
          <dl className="detail-list detail-list--compact">
            <Detail label="Статус" value={memberStatusLabel(member.status)} />
            <Detail label="Telegram ID чата" value={member.chat.telegramChatId} mono />
            <Detail label="Вступил / замечен" value={member.joinedAt ? formatDate(member.joinedAt) : "—"} />
            <Detail label="Последняя активность" value={formatDate(member.lastSeenAt)} />
            <Detail label="Вышел / заблокирован" value={member.leftAt ? formatDate(member.leftAt) : "—"} />
            <Detail label="Ограничение" value={member.punishmentState ?? "Нет"} />
          </dl>
        </article>
      </section>

      <section className="panel profile-section">
        <div className="panel-header">
          <div>
            <h2>Чаты пользователя</h2>
            <p>Все чаты, в которых Modera уже видела этого Telegram-пользователя.</p>
          </div>
        </div>
        <div className="membership-list">
          {member.user.memberships.map((membership) => (
            <Link
              href={`/members/${membership.id}`}
              className="membership-row"
              key={membership.id}
            >
              <span className="membership-icon"><UserRound size={17} /></span>
              <div>
                <strong>{membership.chat.title}</strong>
                <span className="mono">{membership.chat.telegramChatId}</span>
              </div>
              <span className={`badge ${memberStatusBadgeClass(membership.status)}`}>
                {memberStatusLabel(membership.status)}
              </span>
              <span>{membership.messageCount.toLocaleString("ru-RU")} сообщений</span>
              <span>{formatDate(membership.lastSeenAt)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel profile-section">
        <div className="panel-header">
          <div>
            <h2>Журнал событий</h2>
            <p>Последние события Telegram, связанные с этим пользователем.</p>
          </div>
        </div>
        {member.auditLogs.length === 0 ? (
          <div className="state-box state-box--compact">
            <strong>Событий пока нет</strong>
            <p>Здесь появятся реальные изменения статуса и действия модерации.</p>
          </div>
        ) : (
          <div className="audit-list">
            {member.auditLogs.map((log) => (
              <div className="audit-row" key={log.id}>
                <span className="audit-dot" />
                <div>
                  <strong>{auditLabels[log.action] ?? log.action}</strong>
                  <span>
                    {log.chat?.title ?? "Telegram"}
                    {log.actingAdmin ? ` · ${log.actingAdmin.displayName}` : ""}
                    {log.reason ? ` · ${log.reason}` : ""}
                  </span>
                </div>
                <time>{formatDate(log.createdAt)}</time>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Detail({
  label,
  value,
  mono = false
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
}

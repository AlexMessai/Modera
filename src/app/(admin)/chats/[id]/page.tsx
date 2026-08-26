import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CaptchaSettings } from "@/components/captcha-settings";
import { ChatAppealSettings } from "@/components/chat-appeal-settings";
import { ChatModerationSettings } from "@/components/chat-moderation-settings";
import { ChatMediaFilters } from "@/components/chat-media-filters";
import { ManualModerationSettings } from "@/components/manual-moderation-settings";
import { AntiRaidSettings } from "@/components/anti-raid-settings";
import { ReportSettings } from "@/components/report-settings";
import { LogChannelSettings } from "@/components/log-channel-settings";
import { ContentSettings } from "@/components/content-settings";
import { ChatStatistics } from "@/components/chat-statistics-client";
import { MembersClient } from "@/components/members-client";
import { JoinRequestsClient } from "@/components/join-requests-client";
import { AppealsClient } from "@/components/appeals-client";
import { MessagesClient } from "@/components/messages-client";
import { canModerate, canManageChatSettings } from "@/server/auth/permissions";
import { requireAdminPage, requireChatAccess, canManageChatTeam, resolveEffectiveChatRole } from "@/server/auth/guards";
import { ChatTeamSettings } from "@/components/chat-team-settings";
import { ChatSettingsCopy } from "@/components/chat-settings-copy";
import { listChatTeam } from "@/server/services/chat-admin-access-service";
import { getChatCaptchaProfile } from "@/server/services/captcha-settings-service";
import { getChatModerationProfile } from "@/server/services/chat-moderation-settings-service";
import { getChatManualModerationProfile, getManualModerationVisibility } from "@/server/services/manual-moderation-settings-service";
import { getChatAppealProfile } from "@/server/services/chat-appeal-settings-service";
import { getChatAntiRaidProfile } from "@/server/services/anti-raid-settings-service";
import { getChatReportProfile } from "@/server/services/report-settings-service";
import { getChatLogChannelProfile } from "@/server/services/log-channel-service";
import { getChatContentProfile } from "@/server/services/content-settings-service";
import { getActiveSilence } from "@/server/services/silence-service";
import { AutoResponseSettings } from "@/components/auto-response-settings";
import { listAutoResponseRules } from "@/server/services/auto-response-service";
import { CustomCommandSettings } from "@/components/custom-command-settings";
import { listCustomCommands } from "@/server/services/custom-command-service";
import { getChatStatistics } from "@/server/services/chat-statistics-service";

export const dynamic = "force-dynamic";

const eventLabels: Record<string, string> = {
  AUTOMOD_LINK_DELETED: "Удалена запрещённая ссылка",
  AUTOMOD_TERM_DELETED: "Удалено запрещённое слово или фраза",
  AUTOMOD_MEDIA_DELETED: "Удалён запрещённый тип контента",
  AUTOMOD_MEDIA_TRIGGERED: "Обнаружен запрещённый тип контента",
  AUTOMOD_MENTIONS_DELETED: "Удалено за массовые упоминания",
  AUTOMOD_DUPLICATE_DELETED: "Удалено повторяющееся сообщение",
  AUTOMOD_SPAM_DELETED: "Удалено сообщение за флуд",
  AUTOMOD_WARNING: "Автоматическое предупреждение",
  AUTOMOD_AUTO_MUTE: "Автоматический mute",
  AUTOMOD_AUTO_BAN: "Автоматический ban",
  AUTOMOD_ESCALATION_FAILED: "Ошибка автоматического наказания",
  AUTOMOD_DELETE_FAILED: "Telegram не удалил сообщение",
  AUTOMOD_SETTINGS_UPDATED: "Настройки автомодерации изменены",
  CAPTCHA_CHALLENGE_SENT: "Отправлена капча новому участнику",
  CAPTCHA_PASSED: "Капча пройдена",
  CAPTCHA_TIMEOUT_KICK: "Исключён за непройденную капчу",
  CAPTCHA_SETTINGS_UPDATED: "Настройки капчи изменены",
  NEW_MEMBER_BLOCKED: "Новый участник временно заблокирован",
  NEW_MEMBER_MUTED: "Новый участник временно заглушён",
  EXISTING_MEMBER_BLOCKED: "Существующий участник заблокирован проверкой"
};

const botStatusLabels: Record<string, string> = {
  ACTIVE: "Активен", CONNECTED: "Подключён", NOT_ADMIN: "Не администратор", INSUFFICIENT_PERMISSIONS: "Недостаточно прав", REMOVED: "Удалён из чата", DISABLED: "Отключён", TELEGRAM_ERROR: "Ошибка Telegram"
};

const SETTINGS_SECTIONS = [
  { key: "automod", label: "Automod" },
  { key: "filters", label: "Фильтры" },
  { key: "newusers", label: "Новые пользователи" },
  { key: "antiraid", label: "Anti-Raid" },
  { key: "manual", label: "Ручная модерация" },
  { key: "appeals", label: "Апелляции" },
  { key: "team", label: "Команда" },
  { key: "reports", label: "Жалобы" },
  { key: "logchannel", label: "Канал логов" },
  { key: "autoresponses", label: "Автоответы" },
  { key: "customcommands", label: "Свои команды" }
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default async function ChatDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [admin, { id }, query] = await Promise.all([requireAdminPage(), params, searchParams]);
  const access = await requireChatAccess(admin, id);
  if (!access.ok) notFound();
  const effectiveRole = await resolveEffectiveChatRole(admin, id);
  const tab = typeof query.tab === "string" ? query.tab : "overview";
  const section = SETTINGS_SECTIONS.some((item) => item.key === query.section) ? (query.section as string) : "automod";

  const [profile, captchaProfile, manualModerationProfile, manualModerationVisibility, appealProfile, antiRaidProfile, reportProfile, logChannelProfile, contentProfile, silence, autoResponses, customCommands, statistics, team, canEditTeam] = await Promise.all([
    getChatModerationProfile(id),
    getChatCaptchaProfile(id),
    getChatManualModerationProfile(id),
    getManualModerationVisibility(),
    getChatAppealProfile(id),
    getChatAntiRaidProfile(id),
    getChatReportProfile(id),
    getChatLogChannelProfile(id),
    getChatContentProfile(id),
    getActiveSilence(id),
    listAutoResponseRules(id),
    listCustomCommands(id),
    getChatStatistics(id, "7D"),
    listChatTeam(id),
    canManageChatTeam(admin, id)
  ]);
  if (!profile) notFound();

  const canEdit = canManageChatSettings(effectiveRole);
  const canModerateChat = canModerate(effectiveRole);

  return (
    <main className="page">
      <header className="page-header chat-detail-header">
        <div><Link className="back-link" href="/chats"><ArrowLeft size={15} /> Группы</Link><span className="eyebrow">Telegram · Автомодерация</span><h1>{profile.chat.title}</h1><p>{profile.chat.username ? `@${profile.chat.username} · ` : ""}{profile.chat.type === "supergroup" ? "Супергруппа" : "Группа"} · ID {profile.chat.telegramChatId}</p></div>
        <div className="chat-detail-status"><span className={`badge badge--${profile.bot.status.toLowerCase()}`}>{botStatusLabels[profile.bot.status] ?? profile.bot.status}</span><small>Удаление сообщений: {profile.bot.canDeleteMessages ? "разрешено" : "нет права"}</small><small>Ограничение участников: {profile.bot.canRestrictMembers ? "разрешено" : "нет права"}</small></div>
      </header>

      {tab === "settings" ? (
        <>
          <nav className="page-tabs" aria-label="Вкладки настроек">
            {SETTINGS_SECTIONS.map((item) => (
              <Link key={item.key} href={`/chats/${id}?tab=settings&section=${item.key}`} className={`page-tab ${section === item.key ? "page-tab--active" : ""}`}>{item.label}</Link>
            ))}
          </nav>

          {canEdit ? <ChatSettingsCopy chatId={id} /> : null}

          {section === "automod" ? (
            <ChatModerationSettings chatId={profile.chat.id} initial={profile.settings} canEdit={canEdit} botCanDeleteMessages={profile.bot.canDeleteMessages} botCanRestrictMembers={profile.bot.canRestrictMembers} />
          ) : null}

          {section === "filters" ? (
            <ChatMediaFilters chatId={profile.chat.id} initial={profile.settings} canEdit={canEdit} botCanDeleteMessages={profile.bot.canDeleteMessages} botCanRestrictMembers={profile.bot.canRestrictMembers} />
          ) : null}

          {section === "newusers" && captchaProfile && contentProfile ? (
            <section className="panel profile-section">
              <div className="panel-header"><div><h2>Новые пользователи</h2><p>Приветствие, капча и защита участников при вступлении.</p></div></div>
              <ContentSettings chatId={contentProfile.chat.id} initial={contentProfile.settings} canEdit={canEdit} />
              <CaptchaSettings chatId={captchaProfile.chat.id} initial={captchaProfile.settings} canEdit={canEdit} botCanRestrictMembers={captchaProfile.bot.canRestrictMembers} />
            </section>
          ) : null}

          {section === "antiraid" && antiRaidProfile ? (
            <section className="panel profile-section">
              <div className="panel-header"><div><h2>Anti-Raid</h2><p>Защита от массового вступления: усиливает капчу, пока наплыв новых участников не прекратится.</p></div></div>
              <AntiRaidSettings chatId={antiRaidProfile.chat.id} initial={antiRaidProfile.settings} canEdit={canEdit} />
            </section>
          ) : null}

          {section === "manual" && manualModerationProfile ? (
            <section className="panel profile-section">
              <div className="panel-header"><div><h2>Ручная модерация</h2><p>Тексты ответов бота и удаление сообщений для команд /warn /mute /ban /unban в этом чате.</p></div></div>
              <ManualModerationSettings chatId={manualModerationProfile.chat.id} initial={manualModerationProfile.settings} visibility={manualModerationVisibility} canEdit={canEdit} />
            </section>
          ) : null}

          {section === "appeals" && appealProfile ? (
            <section className="panel profile-section">
              <div className="panel-header"><div><h2>Апелляции</h2><p>Команда /appeal боту в личные сообщения: включение для этого чата и уведомления вокруг апелляций.</p></div></div>
              <ChatAppealSettings chatId={appealProfile.chat.id} initial={appealProfile.settings} canEdit={canEdit} />
            </section>
          ) : null}

          {section === "team" ? (
            <section className="panel profile-section">
              <div className="panel-header"><div><h2>Команда</h2><p>Реальные администраторы Telegram (только просмотр) и доступ к веб-панели по @username для этого чата.</p></div></div>
              <ChatTeamSettings chatId={id} initial={team} canEdit={canEditTeam} currentAdminId={admin.id} />
            </section>
          ) : null}

          {section === "reports" && reportProfile ? (
            <section className="panel profile-section">
              <div className="panel-header"><div><h2>Жалобы</h2><p>Команда /report: участники жалуются на сообщение, администраторы получают приватную карточку с кнопками действий.</p></div></div>
              <ReportSettings chatId={reportProfile.chat.id} initial={reportProfile.settings} canEdit={canEdit} />
            </section>
          ) : null}

          {section === "logchannel" && logChannelProfile ? (
            <section className="panel profile-section">
              <div className="panel-header"><div><h2>Канал логов</h2><p>Пересылка событий модерации в отдельный канал или группу. Подключается в Telegram через /settings.</p></div></div>
              <LogChannelSettings chatId={logChannelProfile.chat.id} initial={logChannelProfile.settings} canEdit={canEdit} />
            </section>
          ) : null}

          {section === "autoresponses" ? (
            <section className="panel profile-section">
              <div className="panel-header"><div><h2>Автоответы</h2><p>Бот автоматически отвечает, когда сообщение содержит заданную фразу.</p></div></div>
              <AutoResponseSettings chatId={id} initial={autoResponses} canEdit={canEdit} />
            </section>
          ) : null}

          {section === "customcommands" ? (
            <section className="panel profile-section">
              <div className="panel-header"><div><h2>Свои команды</h2><p>Команды вида /price, /faq, /contacts с готовым текстовым ответом.</p></div></div>
              <CustomCommandSettings chatId={id} initial={customCommands} canEdit={canEdit} />
            </section>
          ) : null}
        </>
      ) : null}

      {tab === "members" ? <MembersClient chatId={id} canManageTrust={canEdit} /> : null}
      {tab === "requests" ? <JoinRequestsClient initialChatId={id} lockChat canModerate={canModerateChat} /> : null}
      {tab === "appeals" ? <AppealsClient initialChatId={id} lockChat canModerate={canModerateChat} /> : null}
      {tab === "messages" ? <MessagesClient initialChatId={id} lockChat canModerate={canModerateChat} /> : null}

      {tab === "journal" ? (
        <section className="panel profile-section">
          <div className="panel-header"><div><h2>Журнал чата</h2><p>Удаления, предупреждения, автоматические наказания, ошибки Telegram и изменения правил.</p></div></div>
          {profile.events.length === 0 ? <div className="state-box state-box--compact"><strong>Событий пока нет</strong><p>После срабатывания правил здесь появится запись с пользователем и причиной.</p></div> : (
            <div className="audit-list automod-audit-list">{profile.events.map((event) => <div className="audit-row" key={event.id}><span className="audit-dot" /><div><strong>{eventLabels[event.action] ?? "Системное событие"}</strong><span>{event.affectedUser?.displayName ?? event.actingAdmin?.displayName ?? "Система"}{event.reason ? ` · ${event.reason}` : ""}</span></div><time>{formatDate(event.createdAt)}</time></div>)}</div>
          )}
        </section>
      ) : null}

      {tab === "overview" || !tab ? (
        <>
          {statistics ? (
            <section className="profile-section">
              <div className="panel-header"><div><h2>Статистика</h2><p>Активность, топ участников и срабатывания automod в этом чате.</p></div></div>
              <ChatStatistics chatId={id} initial={statistics} />
            </section>
          ) : null}

          <section className="panel profile-section">
            <div className="panel-header"><div><h2>Режим тишины</h2><p>Включается и снимается командами /silence и /unsilence прямо в чате.</p></div></div>
            {silence ? (
              <div className="moderation-readonly"><span className="badge badge--danger">Включён</span><p>До {silence.expiresAt ? formatDate(silence.expiresAt.toISOString()) : "—"}{silence.startedByDisplayName ? ` · включил(а) ${silence.startedByDisplayName}` : ""}</p></div>
            ) : (
              <div className="moderation-readonly"><span className="badge">Выключен</span><p>Обычные участники пишут как обычно.</p></div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

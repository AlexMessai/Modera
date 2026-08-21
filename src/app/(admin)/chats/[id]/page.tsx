import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CaptchaSettings } from "@/components/captcha-settings";
import { ChatModerationSettings } from "@/components/chat-moderation-settings";
import { ManualModerationSettings } from "@/components/manual-moderation-settings";
import { AntiRaidSettings } from "@/components/anti-raid-settings";
import { ReportSettings } from "@/components/report-settings";
import { LogChannelSettings } from "@/components/log-channel-settings";
import { ChatRolesSettings } from "@/components/chat-roles-settings";
import { ContentSettings } from "@/components/content-settings";
import { ChatStatistics } from "@/components/chat-statistics-client";
import { canManageChatSettings } from "@/server/auth/permissions";
import { requireAdminPage } from "@/server/auth/guards";
import { getChatCaptchaProfile } from "@/server/services/captcha-settings-service";
import { getChatModerationProfile } from "@/server/services/chat-moderation-settings-service";
import { getChatManualModerationProfile } from "@/server/services/manual-moderation-settings-service";
import { getChatAntiRaidProfile } from "@/server/services/anti-raid-settings-service";
import { getChatReportProfile } from "@/server/services/report-settings-service";
import { getChatLogChannelProfile } from "@/server/services/log-channel-service";
import { listChatRoles } from "@/server/services/chat-role-service";
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
  CAPTCHA_TIMEOUT_BAN: "Заблокирован за непройденную капчу",
  CAPTCHA_SETTINGS_UPDATED: "Настройки капчи изменены"
};

const botStatusLabels: Record<string, string> = {
  ACTIVE: "Активен", CONNECTED: "Подключён", NOT_ADMIN: "Не администратор", INSUFFICIENT_PERMISSIONS: "Недостаточно прав", REMOVED: "Удалён из чата", DISABLED: "Отключён", TELEGRAM_ERROR: "Ошибка Telegram"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default async function ChatModerationPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage();
  const { id } = await params;
  const [profile, captchaProfile, manualModerationProfile, antiRaidProfile, reportProfile, logChannelProfile, roles, contentProfile, silence, autoResponses, customCommands, statistics] = await Promise.all([
    getChatModerationProfile(id),
    getChatCaptchaProfile(id),
    getChatManualModerationProfile(id),
    getChatAntiRaidProfile(id),
    getChatReportProfile(id),
    getChatLogChannelProfile(id),
    listChatRoles(id),
    getChatContentProfile(id),
    getActiveSilence(id),
    listAutoResponseRules(id),
    listCustomCommands(id),
    getChatStatistics(id, "7D")
  ]);
  if (!profile) notFound();

  return (
    <main className="page">
      <header className="page-header chat-detail-header">
        <div><Link className="back-link" href="/chats"><ArrowLeft size={15} /> Чаты</Link><span className="eyebrow">Telegram · Автомодерация</span><h1>{profile.chat.title}</h1><p>{profile.chat.username ? `@${profile.chat.username} · ` : ""}{profile.chat.type === "supergroup" ? "Супергруппа" : "Группа"} · ID {profile.chat.telegramChatId}</p></div>
        <div className="chat-detail-status"><span className={`badge badge--${profile.bot.status.toLowerCase()}`}>{botStatusLabels[profile.bot.status] ?? profile.bot.status}</span><small>Удаление сообщений: {profile.bot.canDeleteMessages ? "разрешено" : "нет права"}</small><small>Ограничение участников: {profile.bot.canRestrictMembers ? "разрешено" : "нет права"}</small><small>Политика: {profile.policy.effectiveSource === "GLOBAL" ? "глобальная" : "индивидуальная"}</small></div>
      </header>

      {statistics ? (
        <section className="profile-section">
          <div className="panel-header"><div><h2>Статистика</h2><p>Активность, топ участников и срабатывания automod в этом чате.</p></div></div>
          <ChatStatistics chatId={id} initial={statistics} />
        </section>
      ) : null}

      <section className="panel profile-section">
        <div className="panel-header"><div><h2>Правила чата</h2><p>Используйте глобальную политику или храните индивидуальные правила только для этого чата.</p></div></div>
        <ChatModerationSettings chatId={profile.chat.id} initial={profile.settings} initialUseGlobalProfile={profile.policy.useGlobalProfile} globalSettings={profile.globalSettings} canEdit={canManageChatSettings(admin.role)} botCanDeleteMessages={profile.bot.canDeleteMessages} botCanRestrictMembers={profile.bot.canRestrictMembers} />
      </section>

      {captchaProfile ? (
        <section className="panel profile-section">
          <div className="panel-header"><div><h2>Капча при вступлении</h2><p>Новый участник должен подтвердить, что не бот, прежде чем сможет писать в чат.</p></div></div>
          <CaptchaSettings chatId={captchaProfile.chat.id} initial={captchaProfile.settings} initialUseGlobalProfile={captchaProfile.policy.useGlobalProfile} globalSettings={captchaProfile.globalSettings} canEdit={canManageChatSettings(admin.role)} botCanRestrictMembers={captchaProfile.bot.canRestrictMembers} />
        </section>
      ) : null}

      {manualModerationProfile ? (
        <section className="panel profile-section">
          <div className="panel-header"><div><h2>Ручная модерация</h2><p>Тексты ответов бота и удаление сообщений для команд /warn /mute /ban /unban в этом чате.</p></div></div>
          <ManualModerationSettings chatId={manualModerationProfile.chat.id} initial={manualModerationProfile.settings} initialUseGlobalProfile={manualModerationProfile.policy.useGlobalProfile} globalSettings={manualModerationProfile.globalSettings} canEdit={canManageChatSettings(admin.role)} />
        </section>
      ) : null}

      {antiRaidProfile ? (
        <section className="panel profile-section">
          <div className="panel-header"><div><h2>Anti-Raid</h2><p>Защита от массового вступления: усиливает капчу, пока наплыв новых участников не прекратится.</p></div></div>
          <AntiRaidSettings chatId={antiRaidProfile.chat.id} initial={antiRaidProfile.settings} initialUseGlobalProfile={antiRaidProfile.policy.useGlobalProfile} globalSettings={antiRaidProfile.globalSettings} canEdit={canManageChatSettings(admin.role)} />
        </section>
      ) : null}

      {reportProfile ? (
        <section className="panel profile-section">
          <div className="panel-header"><div><h2>Жалобы</h2><p>Команда /report: участники жалуются на сообщение, администраторы получают приватную карточку с кнопками действий.</p></div></div>
          <ReportSettings chatId={reportProfile.chat.id} initial={reportProfile.settings} initialUseGlobalProfile={reportProfile.policy.useGlobalProfile} globalSettings={reportProfile.globalSettings} canEdit={canManageChatSettings(admin.role)} />
        </section>
      ) : null}

      {logChannelProfile ? (
        <section className="panel profile-section">
          <div className="panel-header"><div><h2>Канал логов</h2><p>Пересылка событий модерации в отдельный канал или группу. Подключается в Telegram через /settings.</p></div></div>
          <LogChannelSettings chatId={logChannelProfile.chat.id} initial={logChannelProfile.settings} canEdit={canManageChatSettings(admin.role)} />
        </section>
      ) : null}

      {roles.length > 0 ? (
        <section className="panel profile-section">
          <div className="panel-header"><div><h2>Роли</h2><p>Права каждой роли этого чата. Роль назначается автоматически по статусу в Telegram (владелец/администратор) или вручную доверенным участникам.</p></div></div>
          <ChatRolesSettings chatId={id} initial={roles} canEdit={canManageChatSettings(admin.role)} />
        </section>
      ) : null}

      {contentProfile ? (
        <section className="panel profile-section">
          <div className="panel-header"><div><h2>Приветствие и правила</h2><p>Текст приветствия новым участникам и правила чата по команде /rules.</p></div></div>
          <ContentSettings chatId={contentProfile.chat.id} initial={contentProfile.settings} initialUseGlobalProfile={contentProfile.policy.useGlobalProfile} globalSettings={contentProfile.globalSettings} canEdit={canManageChatSettings(admin.role)} />
        </section>
      ) : null}

      <section className="panel profile-section">
        <div className="panel-header"><div><h2>Режим тишины</h2><p>Включается и снимается командами /silence и /unsilence прямо в чате.</p></div></div>
        {silence ? (
          <div className="moderation-readonly"><span className={`badge badge--danger`}>Включён</span><p>До {silence.expiresAt ? formatDate(silence.expiresAt.toISOString()) : "—"}{silence.startedByDisplayName ? ` · включил(а) ${silence.startedByDisplayName}` : ""}</p></div>
        ) : (
          <div className="moderation-readonly"><span className="badge">Выключен</span><p>Обычные участники пишут как обычно.</p></div>
        )}
      </section>

      <section className="panel profile-section">
        <div className="panel-header"><div><h2>Автоответы</h2><p>Бот автоматически отвечает, когда сообщение содержит заданную фразу.</p></div></div>
        <AutoResponseSettings chatId={id} initial={autoResponses} canEdit={canManageChatSettings(admin.role)} />
      </section>

      <section className="panel profile-section">
        <div className="panel-header"><div><h2>Свои команды</h2><p>Команды вида /price, /faq, /contacts с готовым текстовым ответом.</p></div></div>
        <CustomCommandSettings chatId={id} initial={customCommands} canEdit={canManageChatSettings(admin.role)} />
      </section>

      <section className="panel profile-section">
        <div className="panel-header"><div><h2>Журнал автомодерации</h2><p>Удаления, предупреждения, автоматические наказания, ошибки Telegram и изменения правил.</p></div></div>
        {profile.events.length === 0 ? <div className="state-box state-box--compact"><strong>Событий пока нет</strong><p>После срабатывания правил здесь появится запись с пользователем и причиной.</p></div> : (
          <div className="audit-list automod-audit-list">{profile.events.map((event) => <div className="audit-row" key={event.id}><span className="audit-dot" /><div><strong>{eventLabels[event.action] ?? "Системное событие"}</strong><span>{event.affectedUser?.displayName ?? event.actingAdmin?.displayName ?? "Система"}{event.reason ? ` · ${event.reason}` : ""}</span></div><time>{formatDate(event.createdAt)}</time></div>)}</div>
        )}
      </section>
    </main>
  );
}
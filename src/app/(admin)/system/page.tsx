import Link from "next/link";
import { redirect } from "next/navigation";
import { SystemClient } from "@/components/system-client";
import { AdminSettingsClient } from "@/components/admin-settings-client";
import { ModerationNotificationCenter } from "@/components/moderation-notification-center";
import { SystemMessagesSettings } from "@/components/system-messages-settings";
import { requireAdminPage } from "@/server/auth/guards";
import { canManageAdmins, canManageChatSettings, canViewSystem } from "@/server/auth/permissions";
import { getTelegramBotProfile } from "@/server/telegram/client";
import { getModerationNotificationProfiles } from "@/server/services/moderation-notification-settings-service";
import { getSystemMessages } from "@/server/services/system-messages-service";

export const dynamic = "force-dynamic";

async function getTelegramBotUsername() {
  try {
    const profile = await getTelegramBotProfile();
    return profile.username ?? null;
  } catch {
    return null;
  }
}

export default async function SystemPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [admin, query] = await Promise.all([requireAdminPage(), searchParams]);
  if (admin.scope !== "GLOBAL" || !canViewSystem(admin.role)) redirect("/overview");

  const canSeeAccounts = canManageAdmins(admin.role);
  const canEditNotifications = canManageChatSettings(admin.role);
  const tab = query.tab === "accounts" && canSeeAccounts
    ? "accounts"
    : query.tab === "notifications" && canEditNotifications
      ? "notifications"
      : "diagnostics";
  const telegramBotUsername = tab === "accounts" ? await getTelegramBotUsername() : null;
  const [notificationProfiles, systemMessages] = tab === "notifications"
    ? await Promise.all([getModerationNotificationProfiles(), getSystemMessages()])
    : [null, null];

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Production · Диагностика и доступ</span>
          <h1>Система</h1>
          <p>PostgreSQL, Telegram Bot API, webhook, очереди, ошибки, администраторы панели и общие уведомления в одном месте.</p>
        </div>
      </header>
      <nav className="page-tabs" aria-label="Вкладки системы">
        <Link href="/system" className={`page-tab ${tab === "diagnostics" ? "page-tab--active" : ""}`}>Диагностика</Link>
        {canSeeAccounts ? <Link href="/system?tab=accounts" className={`page-tab ${tab === "accounts" ? "page-tab--active" : ""}`}>Аккаунты</Link> : null}
        {canEditNotifications ? <Link href="/system?tab=notifications" className={`page-tab ${tab === "notifications" ? "page-tab--active" : ""}`}>Уведомления</Link> : null}
      </nav>
      {tab === "accounts" ? (
        <AdminSettingsClient currentAdminId={admin.id} telegramBotUsername={telegramBotUsername} />
      ) : tab === "notifications" && notificationProfiles && systemMessages ? (
        <>
          <ModerationNotificationCenter initial={notificationProfiles} canEdit={canEditNotifications} />
          <SystemMessagesSettings initial={systemMessages} canEdit={canEditNotifications} />
        </>
      ) : (
        <SystemClient />
      )}
    </main>
  );
}

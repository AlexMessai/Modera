import Link from "next/link";
import { redirect } from "next/navigation";
import { SystemClient } from "@/components/system-client";
import { AdminSettingsClient } from "@/components/admin-settings-client";
import { ModerationWorkspace } from "@/components/moderation-workspace-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canManageAdmins, canManageChatSettings, canViewSystem } from "@/server/auth/permissions";
import { getTelegramBotProfile } from "@/server/telegram/client";
import { getModerationDashboard } from "@/server/services/moderation-dashboard-service";
import { getGlobalCaptchaProfile } from "@/server/services/captcha-settings-service";
import { getGlobalManualModerationProfile } from "@/server/services/manual-moderation-settings-service";
import { getGlobalAntiRaidProfile } from "@/server/services/anti-raid-settings-service";
import { getGlobalReportProfile } from "@/server/services/report-settings-service";
import { getGlobalContentProfile } from "@/server/services/content-settings-service";

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
  if (!canViewSystem(admin.role)) redirect("/overview");

  const canSeeAccounts = canManageAdmins(admin.role);
  const canEditDefaults = canManageChatSettings(admin.role);
  const tab = query.tab === "accounts" && canSeeAccounts
    ? "accounts"
    : query.tab === "moderation" && canEditDefaults
      ? "moderation"
      : "diagnostics";
  const telegramBotUsername = tab === "accounts" ? await getTelegramBotUsername() : null;
  const moderationDefaults = tab === "moderation"
    ? await Promise.all([
        getModerationDashboard(),
        getGlobalCaptchaProfile(),
        getGlobalManualModerationProfile(),
        getGlobalAntiRaidProfile(),
        getGlobalReportProfile(),
        getGlobalContentProfile()
      ])
    : null;

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Production · Диагностика и доступ</span>
          <h1>Система</h1>
          <p>PostgreSQL, Telegram Bot API, webhook, очереди, ошибки, администраторы панели и глобальные значения по умолчанию в одном месте.</p>
        </div>
      </header>
      <nav className="page-tabs" aria-label="Вкладки системы">
        <Link href="/system" className={`page-tab ${tab === "diagnostics" ? "page-tab--active" : ""}`}>Диагностика</Link>
        {canSeeAccounts ? <Link href="/system?tab=accounts" className={`page-tab ${tab === "accounts" ? "page-tab--active" : ""}`}>Аккаунты</Link> : null}
        {canEditDefaults ? <Link href="/system?tab=moderation" className={`page-tab ${tab === "moderation" ? "page-tab--active" : ""}`}>Модерация по умолчанию</Link> : null}
      </nav>
      {tab === "accounts" ? (
        <AdminSettingsClient currentAdminId={admin.id} telegramBotUsername={telegramBotUsername} />
      ) : tab === "moderation" && moderationDefaults ? (
        <ModerationWorkspace
          automodInitial={moderationDefaults[0].globalProfile.settings}
          captchaInitial={moderationDefaults[1].settings}
          manualModerationInitial={moderationDefaults[2].settings}
          manualModerationVisibilityInitial={moderationDefaults[2].visibility}
          antiRaidInitial={moderationDefaults[3].settings}
          reportInitial={moderationDefaults[4].settings}
          contentInitial={moderationDefaults[5].settings}
          canEdit={canEditDefaults}
        />
      ) : (
        <SystemClient />
      )}
    </main>
  );
}

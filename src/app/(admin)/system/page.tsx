import Link from "next/link";
import { redirect } from "next/navigation";
import { SystemClient } from "@/components/system-client";
import { AdminSettingsClient } from "@/components/admin-settings-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canManageAdmins, canViewSystem } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function SystemPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [admin, query] = await Promise.all([requireAdminPage(), searchParams]);
  if (!canViewSystem(admin.role)) redirect("/overview");

  const canSeeAccounts = canManageAdmins(admin.role);
  const tab = query.tab === "accounts" && canSeeAccounts ? "accounts" : "diagnostics";

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Production · Диагностика и доступ</span>
          <h1>Система</h1>
          <p>PostgreSQL, Telegram Bot API, webhook, очереди, ошибки и администраторы панели в одном месте.</p>
        </div>
      </header>
      {canSeeAccounts ? (
        <nav className="page-tabs" aria-label="Вкладки системы">
          <Link href="/system" className={`page-tab ${tab === "diagnostics" ? "page-tab--active" : ""}`}>Диагностика</Link>
          <Link href="/system?tab=accounts" className={`page-tab ${tab === "accounts" ? "page-tab--active" : ""}`}>Аккаунты</Link>
        </nav>
      ) : null}
      {tab === "accounts" ? (
        <AdminSettingsClient currentAdminId={admin.id} />
      ) : (
        <SystemClient />
      )}
    </main>
  );
}

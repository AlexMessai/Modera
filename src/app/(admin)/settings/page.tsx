import { redirect } from "next/navigation";
import { AdminSettingsClient } from "@/components/admin-settings-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canManageAdmins } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const admin = await requireAdminPage();
  if (!canManageAdmins(admin.role)) redirect("/overview");

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Доступ и безопасность</span>
          <h1>Настройки</h1>
          <p>Администраторы Modera, роли, пароли и серверные сессии.</p>
        </div>
      </header>
      <AdminSettingsClient currentAdminId={admin.id} />
    </main>
  );
}

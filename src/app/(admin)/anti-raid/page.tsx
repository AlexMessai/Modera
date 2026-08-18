import { AntiRaidClient } from "@/components/anti-raid-client";
import { canManageChatSettings } from "@/server/auth/permissions";
import { requireAdminPage } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function AntiRaidPage() {
  const admin = await requireAdminPage();
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Защита от массовых атак</span>
          <h1>Anti-Raid</h1>
          <p>Контроль всплесков вступлений и заявок с безопасной автоматической реакцией.</p>
        </div>
      </header>
      <AntiRaidClient canManage={canManageChatSettings(admin.role)} />
    </main>
  );
}
import { DashboardClient } from "@/components/dashboard-client";
import { requireAdminPage } from "@/server/auth/guards";
import { getDashboardData } from "@/server/services/dashboard-service";
import { listChatsForAdmin } from "@/server/services/chat-admin-access-service";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  // Cross-chat aggregate page. GLOBAL admins see every chat (visibleChatIds
  // null = no filter); CHAT-scoped admins are scoped to only the chats they
  // have ChatAdminAccess for -- never a redirect, never unscoped data.
  const admin = await requireAdminPage();
  const visibleChatIds = await listChatsForAdmin(admin.id);

  const initial = await getDashboardData("7D", visibleChatIds);

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Управление Telegram</span>
          <h1>Обзор</h1>
          <p>Активность, модерация, очереди и состояние подключённых чатов на реальных данных.</p>
        </div>
      </header>
      <DashboardClient initial={initial} />
    </main>
  );
}
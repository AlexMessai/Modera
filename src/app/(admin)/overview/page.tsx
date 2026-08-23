import { redirect } from "next/navigation";
import { DashboardClient } from "@/components/dashboard-client";
import { requireAdminPage } from "@/server/auth/guards";
import { getDashboardData } from "@/server/services/dashboard-service";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  // Cross-chat aggregate page -- deliberately not scoped in this phase (see
  // plan follow-ups). A CHAT-scoped admin never sees it in the sidebar, but
  // it must also not just render unscoped data if reached directly by URL.
  const admin = await requireAdminPage();
  if (admin.scope !== "GLOBAL") redirect("/chats");

  const initial = await getDashboardData("7D");

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
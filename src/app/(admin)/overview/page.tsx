import { DashboardClient } from "@/components/dashboard-client";
import { getDashboardData } from "@/server/services/dashboard-service";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
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
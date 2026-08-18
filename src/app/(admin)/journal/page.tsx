import { JournalClient } from "@/components/journal-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canReconcileModeration } from "@/server/auth/permissions";

export default async function JournalPage() {
  const admin = await requireAdminPage();

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Контроль и аудит</span>
          <h1>Журнал модерации</h1>
          <p>Ручные действия, автомодерация, ошибки Telegram и изменения правил в одном месте.</p>
        </div>
      </header>
      <JournalClient canReconcile={canReconcileModeration(admin.role)} />
    </main>
  );
}
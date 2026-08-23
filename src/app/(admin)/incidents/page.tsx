import { JournalClient } from "@/components/journal-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canReconcileModeration } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  // Cross-chat aggregate page. Unlike /overview this page has no direct
  // service call to scope -- the client fetches through /api/journal, which
  // resolves listChatsForAdmin(admin.id) and enforces the same scoping (plus
  // an honest 404 on the ?chatId= filter dropdown) itself.
  const admin = await requireAdminPage();

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Контроль и аудит</span>
          <h1>Журнал</h1>
          <p>Ручные действия (включая команды в чате), автомодерация, ошибки Telegram и изменения правил в одном месте.</p>
        </div>
      </header>
      <JournalClient canReconcile={canReconcileModeration(admin.role)} />
    </main>
  );
}

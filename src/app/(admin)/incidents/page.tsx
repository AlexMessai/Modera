import Link from "next/link";
import { ModerationCenterClient } from "@/components/moderation-center-client";
import { JournalClient } from "@/components/journal-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canModerate, canReconcileModeration } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

const TABS = [
  { value: "queue", label: "Очередь" },
  { value: "journal", label: "Журнал" }
] as const;

export default async function IncidentsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [admin, query] = await Promise.all([requireAdminPage(), searchParams]);
  const tab = query.tab === "journal" ? "journal" : "queue";

  return (
    <main className="page incidents-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Единая очередь решений</span>
          <h1>Центр модерации</h1>
          <p>Проверяйте срабатывания automod в контексте, принимайте решения и смотрите историю всех событий — без переходов между разделами.</p>
        </div>
      </header>
      <nav className="page-tabs" aria-label="Вкладки центра модерации">
        {TABS.map((item) => (
          <Link
            key={item.value}
            href={item.value === "queue" ? "/incidents" : `/incidents?tab=${item.value}`}
            className={`page-tab ${tab === item.value ? "page-tab--active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "journal" ? (
        <JournalClient canReconcile={canReconcileModeration(admin.role)} />
      ) : (
        <ModerationCenterClient canModerate={canModerate(admin.role)} />
      )}
    </main>
  );
}

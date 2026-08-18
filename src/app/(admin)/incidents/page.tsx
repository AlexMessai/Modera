import { ModerationCenterClient } from "@/components/moderation-center-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canModerate } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const admin = await requireAdminPage();
  return (
    <main className="page incidents-page">
      <header className="page-header">
        <div><span className="eyebrow">Единая очередь решений</span><h1>Центр модерации</h1><p>Проверяйте срабатывания automod в контексте и принимайте решения без переходов между разделами.</p></div>
      </header>
      <ModerationCenterClient canModerate={canModerate(admin.role)} />
    </main>
  );
}

import { JoinRequestsClient } from "@/components/join-requests-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canModerate } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function JoinRequestsPage() {
  const admin = await requireAdminPage();
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Доступ в чаты</span>
          <h1>Заявки на вступление</h1>
          <p>Очередь реальных Telegram chat_join_request с approve/decline и историей решений.</p>
        </div>
      </header>
      <JoinRequestsClient canModerate={canModerate(admin.role)} />
    </main>
  );
}
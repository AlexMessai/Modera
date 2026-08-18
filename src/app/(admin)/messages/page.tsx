import { MessagesClient } from "@/components/messages-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canModerate } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const admin = await requireAdminPage();

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Telegram · Реальные данные</span>
          <h1>Сообщения</h1>
          <p>Поиск и модерация сообщений, которые бот фактически получил из подключённых чатов.</p>
        </div>
      </header>
      <MessagesClient canModerate={canModerate(admin.role)} />
    </main>
  );
}

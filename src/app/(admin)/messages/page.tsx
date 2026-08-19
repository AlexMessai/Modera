import { MessagesClient } from "@/components/messages-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canModerate } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [admin, query] = await Promise.all([requireAdminPage(), searchParams]);
  const sender = typeof query.sender === "string" ? query.sender : "";
  const chatId = typeof query.chatId === "string" ? query.chatId : "";

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Telegram · Реальные данные</span>
          <h1>Сообщения</h1>
          <p>Поиск и модерация сообщений, которые бот фактически получил из подключённых чатов.</p>
        </div>
      </header>
      <MessagesClient
        canModerate={canModerate(admin.role)}
        initialSender={sender}
        initialChatId={chatId}
      />
    </main>
  );
}

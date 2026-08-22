import { ChatsClient } from "@/components/chats-client";

export default function ChatsPage() {
  return (
    <main className="page">
      <header className="page-header"><div><span className="eyebrow">Telegram</span><h1>Группы</h1><p>Все чаты, которые бот реально обнаружил через Telegram. Откройте карточку, чтобы перейти к настройкам, участникам и журналу.</p></div></header>
      <ChatsClient />
    </main>
  );
}

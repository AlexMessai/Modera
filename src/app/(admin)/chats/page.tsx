import { ChatsClient } from "@/components/chats-client";

export default function ChatsPage() {
  return (
    <main className="page">
      <header className="page-header"><div><span className="eyebrow">Telegram</span><h1>Чаты</h1><p>Все группы и супергруппы, которые бот реально обнаружил через Telegram.</p></div></header>
      <ChatsClient />
    </main>
  );
}

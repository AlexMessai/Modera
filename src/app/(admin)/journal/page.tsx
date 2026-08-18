import { JournalClient } from "@/components/journal-client";

export default function JournalPage() {
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Контроль и аудит</span>
          <h1>Журнал модерации</h1>
          <p>Ручные действия, автомодерация, ошибки Telegram и изменения правил в одном месте.</p>
        </div>
      </header>
      <JournalClient />
    </main>
  );
}
